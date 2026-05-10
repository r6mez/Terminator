import Gio from 'gi://Gio';

// currently only deletes the desktop file, but we could expand this in the future to also
// remove associated files in ~/.local/share/applications and ~/.local/share/icons
export async function uninstallUserLocal(desktopFilePath) {
    const file = Gio.File.new_for_path(desktopFilePath);
    try {
        file.delete(null);
        return true;
    } catch (e) {
        throw new Error(`Failed to delete desktop file: ${e.message}`);
    }
}
