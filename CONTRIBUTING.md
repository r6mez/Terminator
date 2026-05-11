## Building from Source

### 1. Clone the repository

```bash
git clone https://github.com/r6mez/Terminator.git
cd Terminator
```

### 2. Install dependencies

You'll need `meson`, `gjs`, and a few GNOME libraries installed before building.

#### Arch Linux

```bash
sudo pacman -S meson gjs gtk4 libadwaita packagekit
```

#### Fedora

```bash
sudo dnf install meson gjs gtk4 libadwaita PackageKit
```

#### Ubuntu / Debian

```bash
sudo apt install meson gjs libgtk-4-1 libadwaita-1-0 packagekit
```

### 3. Build and run

```bash
meson setup build
meson compile -C build

# either install the application on your system
sudo meson install -C build

# or run directly from the build directory without installing
./build/data/org.ramez.terminator
```

### Dependencies reference

**Build:**
- meson (>= 1.0.0)
- gjs

**Runtime:**
- gjs
- gtk4
- libadwaita
- packagekit (for uninstalling system packages)

The authentication dialog shown when PackageKit prompts for privileges
is provided by your desktop environment's polkit agent (built into
gnome-shell on GNOME, polkit-kde-agent on KDE, etc.) — no extra package
needed.
