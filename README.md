![Banner](assets/banner.png)

A simple but powerful tool for managing installed applications on your linux machine. Whether you installed an app through your system's package manager, Flatpak, or Snap, Terminator provides a unified interface to view and remove them all from one place.

## Features

- Browse installed applications with their icons and identifiers
- Remove system packages, Flatpaks, and Snaps from the same interface
- Confirmation and authentication dialogs prevent accidental uninstallations

## Installation

### Building from Source

```bash
meson setup build
meson compile -C build

# either install the application on your system
meson install -C build

# or run directly from the build directory without installing
./build/data/org.ramez.terminator
```

### Dependencies

You'll need these installed before building:

**Build Dependencies**
- meson (>= 1.0.0)
- gjs

**Runtime Dependencies**
- gjs
- gtk4
- libadwaita
- packagekit (for uninstalling system packages)
- polkit-gnome (for authentication dialogs)

#### Arch Linux

```bash
sudo pacman -S gjs gtk4 libadwaita packagekit polkit-gnome
```

#### Fedora

```bash
sudo dnf install gjs gtk4 libadwaita PackageKit polkit-gnome
```

#### Ubuntu/Debian

```bash
sudo apt install gjs libgtk-4-1 libadwaita-1-0 packagekit policykit-1-gnome
```

## License

Terminator is free software released under the [GNU General Public License v3.0](COPYING) or later.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.
