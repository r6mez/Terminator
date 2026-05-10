import GLib from 'gi://GLib';

export function preserveScrollDuring(listBox, mutate) {
    const scrolled = listBox.get_parent();
    const vadj = scrolled?.get_vadjustment?.() ?? null;
    const saved = vadj ? vadj.get_value() : 0;

    const root = listBox.get_root();
    if (root && typeof root.set_focus === 'function') {
        root.set_focus(null);
    }

    mutate();

    if (!vadj) return;

    let frames = 0;
    GLib.idle_add(GLib.PRIORITY_HIGH, () => {
        vadj.set_value(saved);
        frames++;
        return frames < 4 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
    });
}
