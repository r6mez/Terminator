import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'wait_async', 'wait_finish');

// /var/lib/flatpak/exports/share/applications/org.gnome.Calculator.desktop
// -> org.gnome.Calculator
function getFlatpakAppId(desktopFilePath) {
    const basename = GLib.path_get_basename(desktopFilePath);
    return basename.replace('.desktop', '');
}

async function runSubprocess(args) {
    const flags = Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE;
    const subprocess = Gio.Subprocess.new(args, flags);
    await subprocess.wait_async(null);
    return subprocess.get_successful();
}

function getFlatpakScope(desktopFilePath) {
    const userPrefix = GLib.build_filenamev([GLib.get_home_dir(), '.local/share/flatpak/']);
    return desktopFilePath.startsWith(userPrefix) ? '--user' : '--system';
}

export async function uninstallFlatpak(desktopFilePath) {
    const appId = getFlatpakAppId(desktopFilePath);
    const scope = getFlatpakScope(desktopFilePath);

    const success = await runSubprocess(['flatpak', 'uninstall', scope, '-y', appId]);
    if (success) return true;

    throw new Error('Flatpak uninstall failed. The app may not be installed.');
}
