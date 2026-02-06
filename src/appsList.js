import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { uninstallApp } from './packageKit.js';

export function populateAppList(listBox) {
    const apps = Gio.AppInfo.get_all();
    apps.forEach(app => {
        if (!app.should_show()) return;

        const row = new Adw.ActionRow({
            title: app.get_display_name(),
            subtitle: app.get_id()
        });

        const icon = new Gtk.Image({
            gicon: app.get_icon(),
            pixel_size: 32
        });

        row.add_prefix(icon);

        const uninstallButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });

        uninstallButton.connect('clicked', () => {
            uninstallApp(
                listBox.get_root(),
                app.get_display_name(),
                app.get_id(),
                app.get_filename(),
                () => listBox.remove(row)
            );
        });

        row.add_suffix(uninstallButton);
        listBox.append(row);
    });
}
