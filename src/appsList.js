import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

export function populateAppList(listBox) {
    const apps = Gio.AppInfo.get_all();
    apps.forEach(app => {
        if(!app.should_show()) return;

        const row = new Adw.ActionRow({
            title: app.get_display_name(),
            subtitle: app.get_filename()
        });

        const icon = new Gtk.Image({
            gicon: app.get_icon(),
            pixel_size: 32
        });

        row.add_prefix(icon);

        const uninstall_btn = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });

        row.add_suffix(uninstall_btn);
        listBox.append(row);
    });
}
