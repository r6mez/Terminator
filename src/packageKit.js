import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';

import { getSnapName, uninstallSnap } from './snap.js';

const PACKAGEKIT_BUS_NAME = 'org.freedesktop.PackageKit';
const PACKAGEKIT_OBJECT_PATH = '/org/freedesktop/PackageKit';
const PACKAGEKIT_INTERFACE = 'org.freedesktop.PackageKit';
const TRANSACTION_INTERFACE = 'org.freedesktop.PackageKit.Transaction';

const DEFAULT_TIMEOUT = -1; // 25 seconds
const DEFAULT_CANCELLABLE = null; // not cancellable

const AppType = {
    SYSTEM_PACKAGE: 'system-package',
    FLATPAK: 'flatpak',
    SNAP: 'snap',
    USER_LOCAL: 'user-local',
    UNKNOWN: 'unknown'
};

function classifyAppType(desktopFilePath) {
    const info = Gio.DesktopAppInfo.new_from_filename(desktopFilePath);
    if(!info) return AppType.UNKNOWN;

    if (info.has_key('X-Flatpak')) return AppType.FLATPAK;
    
    if (info.has_key('X-SnapInstanceName')) return AppType.SNAP;

    const userDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);
    if (desktopFilePath.startsWith(userDir)) return AppType.USER_LOCAL;

    return AppType.SYSTEM_PACKAGE;
}

// /var/lib/flatpak/exports/share/applications/org.gnome.Calculator.desktop 
// -> org.gnome.Calculator
function getFlatpakAppId(desktopFilePath) {
    const basename = GLib.path_get_basename(desktopFilePath);
    return basename.replace('.desktop', '');
}

function dbusCallAsync(connection, busName, objectPath, iface, method, params, replyType) {
    return new Promise((resolve, reject) => {
        connection.call(
            busName,
            objectPath,
            iface,
            method,
            params,
            replyType,
            Gio.DBusCallFlags.NONE,
            DEFAULT_TIMEOUT,
            DEFAULT_CANCELLABLE,
            (conn, result) => {
                try {
                    const reply = conn.call_finish(result);
                    resolve(reply);
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

function runSubprocess(args) {
    return new Promise((resolve, reject) => {
        try {
            const subprocess = Gio.Subprocess.new(
                args,
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
            );

            subprocess.wait_async(null, (proc, result) => {
                try {
                    proc.wait_finish(result);
                    resolve(proc.get_successful());
                } catch (e) {
                    reject(e);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function isPackageKitAvailable() {
    try {
        const connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);

        const startReply = await dbusCallAsync(
            connection,
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'StartServiceByName',
            new GLib.Variant('(su)', [PACKAGEKIT_BUS_NAME, 0]),
            new GLib.VariantType('(u)')
        );

        // 1 = DBUS_START_REPLY_SUCCESS, 2 = DBUS_START_REPLY_ALREADY_RUNNING
        const code = startReply.get_child_value(0).get_uint32();
        return code === 1 || code === 2;
    } catch (e) {
        console.warn('PackageKit availability check failed:', e.message);
        return false;
    }
}

async function createTransaction() {
    const connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);

    const result = await dbusCallAsync(
        connection,
        PACKAGEKIT_BUS_NAME,
        PACKAGEKIT_OBJECT_PATH,
        PACKAGEKIT_INTERFACE,
        'CreateTransaction',
        null,
        new GLib.VariantType('(o)')
    );

    const transactionPath = result.get_child_value(0).get_string()[0];

    // this allows interactive authentication
    await dbusCallAsync(
        connection,
        PACKAGEKIT_BUS_NAME,
        transactionPath,
        TRANSACTION_INTERFACE,
        'SetHints',
        new GLib.Variant('(as)', [['interactive=true']]),
        null
    );

    return transactionPath;
}

async function resolvePackageFromDesktop(desktopFilePath) {
    const connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
    const transactionPath = await createTransaction();

    return new Promise((resolve, reject) => {
        let packageId = null;

        const packageSignalId = connection.signal_subscribe(
            PACKAGEKIT_BUS_NAME,
            TRANSACTION_INTERFACE,
            'Package',
            transactionPath,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                packageId = params.get_child_value(1).get_string()[0];
            }
        );

        const finishedSignalId = connection.signal_subscribe(
            PACKAGEKIT_BUS_NAME,
            TRANSACTION_INTERFACE,
            'Finished',
            transactionPath,
            null,
            Gio.DBusSignalFlags.NONE,
            () => {
                connection.signal_unsubscribe(packageSignalId);
                connection.signal_unsubscribe(finishedSignalId);

                if (packageId) {
                    resolve(packageId);
                } else {
                    reject(new Error('Could not resolve package from desktop file'));
                }
            }
        );

        const errorSignalId = connection.signal_subscribe(
            PACKAGEKIT_BUS_NAME,
            TRANSACTION_INTERFACE,
            'ErrorCode',
            transactionPath,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                connection.signal_unsubscribe(packageSignalId);
                connection.signal_unsubscribe(finishedSignalId);
                connection.signal_unsubscribe(errorSignalId);
                const errorDetails = params.get_child_value(1).get_string()[0];
                reject(new Error(errorDetails));
            }
        );

        dbusCallAsync(
            connection,
            PACKAGEKIT_BUS_NAME,
            transactionPath,
            TRANSACTION_INTERFACE,
            'SearchFiles',
            new GLib.Variant('(tas)', [0, [desktopFilePath]]),
            null
        ).catch(reject);
    });
}

async function removePackageById(packageId) {
    const connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
    const transactionPath = await createTransaction();

    return new Promise((resolve, reject) => {
        const finishedSignalId = connection.signal_subscribe(
            PACKAGEKIT_BUS_NAME,
            TRANSACTION_INTERFACE,
            'Finished',
            transactionPath,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                connection.signal_unsubscribe(finishedSignalId);
                const exitCode = params.get_child_value(0).get_uint32();
                if (exitCode === 1) { // PK_EXIT_ENUM_SUCCESS
                    resolve(true);
                } else {
                    reject(new Error(`Package removal failed with exit code: ${exitCode}`));
                }
            }
        );

        const errorSignalId = connection.signal_subscribe(
            PACKAGEKIT_BUS_NAME,
            TRANSACTION_INTERFACE,
            'ErrorCode',
            transactionPath,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                connection.signal_unsubscribe(finishedSignalId);
                connection.signal_unsubscribe(errorSignalId);
                const errorDetails = params.get_child_value(1).get_string()[0];
                reject(new Error(errorDetails));
            }
        );

        dbusCallAsync(
            connection,
            PACKAGEKIT_BUS_NAME,
            transactionPath,
            TRANSACTION_INTERFACE,
            'RemovePackages',
            new GLib.Variant('(tasbb)', [0, [packageId], true, true]),
            null
        ).catch(reject);
    });
}

async function uninstallFlatpak(appId) {
    // Try user installation first
    const userSuccess = await runSubprocess(['flatpak', 'uninstall', '--user', '-y', appId]);
    if (userSuccess) {
        return true;
    }

    // Try system installation
    const systemSuccess = await runSubprocess(['pkexec', 'flatpak', 'uninstall', '--system', '-y', appId]);
    if (systemSuccess) {
        return true;
    }

    throw new Error('Flatpak uninstall failed. The app may not be installed.');
}

// currently only deletes the desktop file, but we could expand this in the future to also
// remove associated files in ~/.local/share/applications and ~/.local/share/icons
async function uninstallUserLocal(desktopFilePath) {
    const file = Gio.File.new_for_path(desktopFilePath);
    try {
        file.delete(null);
        return true;
    } catch (e) {
        throw new Error(`Failed to delete desktop file: ${e.message}`);
    }
}

export function uninstallApp(parentWindow, appName, desktopId, desktopFilePath, onSuccess = null) {
    console.log(`Requesting uninstall for: ${desktopId}`);
    console.log(`Desktop file path: ${desktopFilePath}`);

    const appType = classifyAppType(desktopFilePath);
    console.log(`Detected app type: ${appType}`);

    // Check if we can uninstall this app type
    if (appType === AppType.UNKNOWN || !desktopFilePath) {
        const dialog = new Adw.MessageDialog({
            transient_for: parentWindow,
            heading: "Cannot Uninstall",
            body: `Cannot determine how to uninstall ${appName}.`,
        });
        dialog.add_response("ok", "OK");
        dialog.present();
        return;
    }

    try {
        const dialogBody = appType === AppType.USER_LOCAL
            ? `Are you sure you want to uninstall ${appName}? This will remove the launcher, but associated files may remain in your home directory.`
            : `Are you sure you want to uninstall ${appName}?`;

        const dialog = new Adw.MessageDialog({
            transient_for: parentWindow,
            heading: "Uninstall Request",
            body: dialogBody,
        });

        dialog.add_response("cancel", "Cancel");
        dialog.add_response("remove", "Remove");
        dialog.set_response_appearance("remove", Adw.ResponseAppearance.DESTRUCTIVE);

        dialog.connect('response', async (self, response) => {
            if (response === 'remove') {
                try {
                    switch (appType) {
                        case AppType.SYSTEM_PACKAGE:
                            if (!(await isPackageKitAvailable())) {
                                throw new Error('PackageKit is not available on this system. Install and enable the "packagekit" service to uninstall system packages.');
                            }
                            console.log("Resolving package from desktop file...");
                            const packageId = await resolvePackageFromDesktop(desktopFilePath);
                            console.log(`Resolved package ID: ${packageId}`);
                            console.log("Calling D-Bus RemovePackages...");
                            await removePackageById(packageId);
                            break;

                        case AppType.FLATPAK:
                            console.log("Uninstalling Flatpak...");
                            const flatpakId = getFlatpakAppId(desktopFilePath);
                            await uninstallFlatpak(flatpakId);
                            break;

                        case AppType.SNAP:
                            console.log("Uninstalling Snap...");
                            const snapName = getSnapName(desktopFilePath);
                            await uninstallSnap(snapName);
                            break;

                        case AppType.USER_LOCAL:
                            console.log("Uninstalling user-local app...");
                            await uninstallUserLocal(desktopFilePath);
                            break;
                    }

                    console.log(`Successfully uninstalled ${appName}`);

                    // Call the success callback to refresh the list
                    if (onSuccess) {
                        onSuccess();
                    }

                    const successDialog = new Adw.MessageDialog({
                        transient_for: parentWindow,
                        heading: "Uninstall Complete",
                        body: `${appName} has been successfully uninstalled.`,
                    });
                    successDialog.add_response("ok", "OK");
                    successDialog.present();

                } catch (e) {
                    console.error("Uninstall failed:", e);

                    const errorDialog = new Adw.MessageDialog({
                        transient_for: parentWindow,
                        heading: "Uninstall Failed",
                        body: `Could not uninstall ${appName}: ${e.message}`,
                    });
                    errorDialog.add_response("ok", "OK");
                    errorDialog.present();
                }
            }
        });

        dialog.present();
    } catch (e) {
        console.error("Error:", e);
    }
}
