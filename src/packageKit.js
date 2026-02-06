import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';

const PACKAGEKIT_BUS_NAME = 'org.freedesktop.PackageKit';
const PACKAGEKIT_OBJECT_PATH = '/org/freedesktop/PackageKit';
const PACKAGEKIT_INTERFACE = 'org.freedesktop.PackageKit';
const TRANSACTION_INTERFACE = 'org.freedesktop.PackageKit.Transaction';

const DEFAULT_TIMEOUT = -1; // 25 seconds
const DEFAULT_CANCELLABLE = null; // not cancellable

const AppType = {
    SYSTEM_PACKAGE: 'system-package',   // /usr/share/applications
    FLATPAK: 'flatpak',                 // contains flatpak in path
    SNAP: 'snap',                       // /var/lib/snapd/
    USER_LOCAL: 'user-local',           // ~/.local/share/applications/
    UNKNOWN: 'unknown'
};

function detectAppType(desktopFilePath) {
    if (desktopFilePath.includes('flatpak')) {
        return AppType.FLATPAK;
    }
    if (desktopFilePath.includes('snap')) {
        return AppType.SNAP;
    }
    if (desktopFilePath.includes('usr/share/applications')) {
        return AppType.SYSTEM_PACKAGE;
    }
    if (desktopFilePath.includes('.local/share/applications')) {
        return AppType.USER_LOCAL;
    }

    return AppType.UNKNOWN;
}

// /var/lib/flatpak/exports/share/applications/org.gnome.Calculator.desktop 
// -> org.gnome.Calculator
function getFlatpakAppId(desktopFilePath) {
    const basename = GLib.path_get_basename(desktopFilePath);
    return basename.replace('.desktop', '');
}

function getSnapName(desktopFilePath) {
    try {
        const file = Gio.File.new_for_path(desktopFilePath);
        const [success, contents] = file.load_contents(null);
        
        if (!success) {
            return null;
        }
        
        const text = new TextDecoder().decode(contents);
        const lines = text.split('\n');
        
        for (const line of lines) {
            if (line.startsWith('X-SnapInstanceName=')) {
                return line.split('=')[1].trim();
            }
        }

        throw new Error('X-SnapInstanceName not found');
    } catch (e) {
        console.error('Failed to parse snap desktop file:', e);
    }
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

// Uninstall a Snap app
async function uninstallSnap(appName) {
    const success = await runSubprocess(['pkexec', 'snap', 'remove', appName]);
    if (!success) {
        throw new Error('Snap removal failed');
    }
    return true;
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

    const appType = detectAppType(desktopFilePath);
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
