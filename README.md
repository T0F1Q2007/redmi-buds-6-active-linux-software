# Redmi Buds 6 Active Telemetry and Control Suite for Linux and GNOME Shell

A native GNOME Shell extension and companion asynchronous D-Bus daemon engineered to intercept, decode, and render real-time battery telemetry and charging metrics for Xiaomi Redmi Buds 6 Active hardware on Linux systems.

---

## Abstract and System Architecture

While traditional desktop Bluetooth audio stacks (BlueZ, PulseAudio, and PipeWire) manage A2DP audio streaming and AVRCP media controls, they frequently lack support for proprietary or vendor-extended battery telemetry frames emitted by budget and mid-tier True Wireless Stereo (TWS) headsets.

The Xiaomi Redmi Buds 6 Active hardware broadcasts battery state indicators over non-connectable Bluetooth Low Energy (BLE) advertisement packets structured according to the Google Fast Pair Service (GFPS) specification (`0xFE2C`).

This software suite provides an end-to-end integration stack:

```
+-----------------------------------------------------------------------+
|                    Redmi Buds 6 Active Hardware                       |
|               (Left Earbud, Right Earbud, Charging Case)              |
+-----------------------------------^-----------------------------------+
                                    |
            BLE GAP Non-Connectable Advertisements (UUID 0xFE2C)
                                    |
+-----------------------------------v-----------------------------------+
|               Asynchronous Python Telemetry Service                   |
|                        (redmibuds-daemon.py)                          |
|  - Bleak asynchronous BLE advertisement scanner                       |
|  - Single-task cancellable silence watchdog (10s auto-decay)          |
|  - Bitwise payload parsing (0x80 charging bit, 0x7F level mask)       |
+-----------------------------------^-----------------------------------+
                                    |
                D-Bus IPC Session Bus (org.redmibuds.Battery)
                                    |
+-----------------------------------v-----------------------------------+
|                    GNOME Shell Top Panel Extension                    |
|                      (redmibuds-battery@istisu)                       |
|  - PanelMenu.Button status display (L, R, C telemetry)               |
|  - Asynchronous property query and BatteryChanged signal subscription |
|  - Dynamic panel item visibility based on device presence             |
+-----------------------------------------------------------------------+
```

---

## Protocol Specification and Payload Parsing

Battery status packets are encapsulated within the Service Data field of BLE GAP advertisement frames corresponding to UUID `0000fe2c-0000-1000-8000-00805f9b34fb`.

### Binary Frame Decomposition

The payload spans 15 octets. Octets 12, 13, and 14 represent the discrete battery readings:

| Octet Index | Target Component | Bitmask Logic | Representation |
|---|---|---|---|
| `12` | Left Transducer | `data[12] & 0x7F` / `data[12] & 0x80` | Integer level (0-100%) and boolean charging state |
| `13` | Right Transducer | `data[13] & 0x7F` / `data[13] & 0x80` | Integer level (0-100%) and boolean charging state |
| `14` | Charging Cradle | `data[14] & 0x7F` / `data[14] & 0x80` | Integer level (0-100%) and boolean charging state |

When an element possesses the value `0xFF`, it indicates the component is absent, uncoupled, or powered down, in which case the daemon maps the state to `-1` (`absent`).

---

## D-Bus IPC Interface Specification

The daemon exports the following interface across the session bus:

* **Service Name**: `org.redmibuds.Battery`
* **Object Path**: `/org/redmibuds/Battery`
* **Interface**: `org.redmibuds.Battery`

### Properties

| Property Identifier | D-Bus Type | Description |
|---|---|---|
| `Left` | `i` (Int32) | Left earbud state of charge percentage (-1 if absent) |
| `Right` | `i` (Int32) | Right earbud state of charge percentage (-1 if absent) |
| `Case` | `i` (Int32) | Charging case state of charge percentage (-1 if absent) |
| `LeftCharging` | `b` (Boolean) | Active charging state of left earbud |
| `RightCharging` | `b` (Boolean) | Active charging state of right earbud |
| `CaseCharging` | `b` (Boolean) | Active charging state of charging case |

### Signals

* **`BatteryChanged()`**: Emitted when any state-of-charge metric or charging state flag transitions.

---

## Prerequisites and Installation

### 1. Dependencies

Ensure Python 3, BlueZ, Bleak, and dasbus are installed:

```bash
# Arch Linux
sudo pacman -S python-bleak python-dasbus bluez bluez-utils

# Debian / Ubuntu
sudo apt install python3-bleak python3-dasbus bluez
```

### 2. Extension Installation

Deploy the GNOME Shell extension module:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/redmibuds-battery@istisu
cp -r redmibuds-battery@istisu/* ~/.local/share/gnome-shell/extensions/redmibuds-battery@istisu/
cp redmibuds-daemon.py ~/.local/share/gnome-shell/extensions/redmibuds-battery@istisu/
```

### 3. systemd User Service Deployment

Configure the background daemon to launch automatically upon user login:

```bash
mkdir -p ~/.config/systemd/user/
cp redmibuds-battery.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now redmibuds-battery.service
```

### 4. Enable Extension

Activate the extension in GNOME Shell:

```bash
gnome-extensions enable redmibuds-battery@istisu
```

---

## Manual Execution and Configuration

The daemon can also be invoked directly from the command line with custom MAC filtering:

```bash
python3 redmibuds-daemon.py --mac "14:6C:27:2C:CF:8D"
```

---

## License

This software is distributed under the terms of the GNU General Public License v3.0 (GPL-3.0).
