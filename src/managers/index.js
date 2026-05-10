import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';

import { uninstallSnap } from './snap.js';
import { uninstallFlatpak } from './flatpak.js';
import { uninstallSystemPackage } from './systemPackage.js';
import { uninstallUserLocal } from './userLocal.js';

const AppType = {
    SYSTEM_PACKAGE: 'system-package',
    FLATPAK: 'flatpak',
    SNAP: 'snap',
    USER_LOCAL: 'user-local',
    UNKNOWN: 'unknown'
};

const UNINSTALLERS = {
    [AppType.SYSTEM_PACKAGE]: uninstallSystemPackage,
    [AppType.FLATPAK]: uninstallFlatpak,
    [AppType.SNAP]: uninstallSnap,
    [AppType.USER_LOCAL]: uninstallUserLocal,
};

function classifyAppType(desktopFilePath) {
    const info = Gio.DesktopAppInfo.new_from_filename(desktopFilePath);
    if (!info) return AppType.UNKNOWN;

    if (info.has_key('X-Flatpak')) return AppType.FLATPAK;
    if (info.has_key('X-SnapInstanceName')) return AppType.SNAP;

    const userDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);
    if (desktopFilePath.startsWith(userDir)) return AppType.USER_LOCAL;

    return AppType.SYSTEM_PACKAGE;
}

export function uninstallApp(parentWindow, appName, desktopId, desktopFilePath, onSuccess = null) {
    console.log(`Requesting uninstall for: ${desktopId} (${desktopFilePath})`);

    const appType = classifyAppType(desktopFilePath);
    console.log(`Detected app type: ${appType}`);

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
        if (response !== 'remove') return;

        try {
            await UNINSTALLERS[appType](desktopFilePath);
            console.log(`Successfully uninstalled ${appName}`);

            if (onSuccess) onSuccess();

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
    });

    dialog.present();
}
