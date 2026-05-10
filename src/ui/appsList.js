import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { uninstallApp, classifyAppType, getAppTypeLabel } from '../managers/index.js';
import { preserveScrollDuring } from './scroll.js';

export function populateAppList(listBox) {
    const apps = Gio.AppInfo.get_all()
        .filter(app => app.should_show())
        .sort((a, b) => {
            const an = (a.get_display_name() ?? '').toLowerCase();
            const bn = (b.get_display_name() ?? '').toLowerCase();
            return an.localeCompare(bn);
        });
    apps.forEach(app => {

        const displayName = app.get_display_name();
        const appId = app.get_id();
        const desktopPath = app.get_filename();
        const appType = classifyAppType(desktopPath);

        const row = new Adw.ActionRow({
            title: GLib.markup_escape_text(displayName ?? '', -1),
            subtitle: GLib.markup_escape_text(appId ?? '', -1)
        });

        row.appType = appType;
        row.searchText = `${displayName ?? ''} ${appId ?? ''}`.toLowerCase();

        const icon = new Gtk.Image({
            gicon: app.get_icon(),
            pixel_size: 32
        });

        row.add_prefix(icon);

        const badge = new Gtk.Label({
            label: getAppTypeLabel(appType),
            valign: Gtk.Align.CENTER,
            css_classes: ['app-type-badge', `type-${appType}`]
        });
        row.add_suffix(badge);

        const uninstallButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });

        uninstallButton.connect('clicked', () => {
            uninstallApp(
                listBox.get_root(),
                displayName,
                appId,
                desktopPath,
                () => preserveScrollDuring(listBox, () => listBox.remove(row))
            );
        });

        row.add_suffix(uninstallButton);
        listBox.append(row);
    });
}
