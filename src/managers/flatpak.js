import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// /var/lib/flatpak/exports/share/applications/org.gnome.Calculator.desktop
// -> org.gnome.Calculator
function getFlatpakAppId(desktopFilePath) {
    const basename = GLib.path_get_basename(desktopFilePath);
    return basename.replace('.desktop', '');
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

export async function uninstallFlatpak(desktopFilePath) {
    const appId = getFlatpakAppId(desktopFilePath);

    // Try user installation first
    const userSuccess = await runSubprocess(['flatpak', 'uninstall', '--user', '-y', appId]);
    if (userSuccess) return true;

    // Try system installation
    const systemSuccess = await runSubprocess(['pkexec', 'flatpak', 'uninstall', '--system', '-y', appId]);
    if (systemSuccess) return true;

    throw new Error('Flatpak uninstall failed. The app may not be installed.');
}
