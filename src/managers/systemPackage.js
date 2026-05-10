import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PACKAGEKIT_BUS_NAME = 'org.freedesktop.PackageKit';
const PACKAGEKIT_OBJECT_PATH = '/org/freedesktop/PackageKit';
const PACKAGEKIT_INTERFACE = 'org.freedesktop.PackageKit';
const TRANSACTION_INTERFACE = 'org.freedesktop.PackageKit.Transaction';

const DEFAULT_TIMEOUT = -1;
const DEFAULT_CANCELLABLE = null;

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
                    resolve(conn.call_finish(result));
                } catch (e) {
                    reject(e);
                }
            }
        );
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

    // allows interactive authentication
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

export async function uninstallSystemPackage(desktopFilePath) {
    if (!(await isPackageKitAvailable())) {
        throw new Error('PackageKit is not available on this system. Install and enable the "packagekit" service to uninstall system packages.');
    }
    const packageId = await resolvePackageFromDesktop(desktopFilePath);
    await removePackageById(packageId);
}
