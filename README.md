# Redmi Buds 6 Active Linux Telemetry Suite

```
  [LEFT EARBUD]          [CHARGING CRADLE]         [RIGHT EARBUD]
     ( L: 85% )             ( C: 100% )               ( R: 90% )
         |                       |                        |
         +-----------------------+------------------------+
                                 |
              BLE GAP Advertisements (UUID: 0xFE2C)
                                 v
                     [Linux Desktop Panel UI]
```

[![GNOME Version](https://img.shields.io/badge/GNOME%20Shell-45%20--%2050-blue.svg?style=flat-square)](#)
[![Protocol](https://img.shields.io/badge/Protocol-Google%20Fast%20Pair%20(GFPS)-cyan.svg?style=flat-square)](#)
[![D-Bus Interface](https://img.shields.io/badge/IPC-org.redmibuds.Battery-yellow.svg?style=flat-square)](#)
[![Backend](https://img.shields.io/badge/Daemon-Python%20Bleak%20%2F%20dasbus-blueviolet.svg?style=flat-square)](#)
[![License](https://img.shields.io/badge/License-GPL--3.0-green.svg?style=flat-square)](#)

---

## 1. Protocol Architecture & Reverse-Engineered Packet Specification

The Xiaomi Redmi Buds 6 Active hardware transmits transducer power reserves and charging circuit telemetry across Bluetooth Low Energy (BLE) non-connectable undirected advertisements adhering to the Google Fast Pair Service (GFPS) specification (`0xFE2C`).

### 1.1 15-Byte Binary Service Payload Wire Format

```
  Byte Index:
  0x00      0x01      0x02      0x03               0x0B      0x0C      0x0D      0x0E
 +---------+---------+---------+------------------+---------+---------+---------+---------+
 |       Model ID (3B)         |      Salt / Encrypted State |  LEFT   |  RIGHT  |  CASE   |
 |       [ 0x00FE2C ]          |         [ 9 Bytes ]         | BATTERY | BATTERY | BATTERY |
 +---------+---------+---------+------------------+---------+---------+---------+---------+
                                                             |         |         |
                                                             |         |         +-- Byte 14
                                                             |         +------------ Byte 13
                                                             +---------------------- Byte 12
```

### 1.2 Bitfield Decomposition Logic

Each individual battery byte $B \in \{\text{Byte 12}, \text{Byte 13}, \text{Byte 14}\}$ encodes both the charging connection state and the battery level:

```
  Bit 7 (MSB)                                               Bit 0 (LSB)
 +-----------------------+---------------------------------------------+
 |   CHARGING FLAG (1b)  |          STATE OF CHARGE (0 - 100%) (7b)    |
 |  0: Discharging       |           Bitmask: 0x7F                     |
 |  1: Active Charging   |                                             |
 +-----------------------+---------------------------------------------+
```

* **Presence Detection**: If $B = \text{0xFF}$, the peripheral is absent from the cradle or turned off $\rightarrow$ decoded as metric `-1` (`absent`).
* **Level Extraction**: $\text{Level} = B \ \& \ \text{0x7F}$.
* **Charging Extraction**: $\text{IsCharging} = (B \ \& \ \text{0x80}) \neq 0$.

---

## 2. Multi-Tiered Process & IPC Architecture

```
+-------------------------------------------------------------+
|               Hardware Bluetooth Controller                 |
|               (hci0 / BlueZ Linux Subsystem)                |
+------------------------------+------------------------------+
                               |
                               | HCI BLE LeScan Events
                               v
+-------------------------------------------------------------+
|             Python Asynchronous Background Daemon           |
|                     (redmibuds-daemon.py)                   |
|                                                             |
|  +------------------------+    +-------------------------+  |
|  | BleakScanner Loop      |    | Cancellable Watchdog    |  |
|  | Suffix Filtering       |    | 10s Silence Auto-Decay  |  |
|  +------------------------+    +-------------------------+  |
|                               |                             |
|  +-------------------------------------------------------+  |
|  | dasbus GObject Interface (org.redmibuds.Battery)      |  |
|  +-------------------------------------------------------+  |
+------------------------------+------------------------------+
                               |
                               | D-Bus Signal (BatteryChanged) & Property Reads
                               v
+-------------------------------------------------------------+
|               GNOME Shell Desktop Extension                 |
|                 (redmibuds-battery@istisu)                  |
|                                                             |
|  - St.BoxLayout Panel Widget (L:XX% * R:XX% * C:XX%)        |
|  - Automatic Panel Visibility Toggling                      |
|  - Dropdown Details Menu with Real-time Status              |
+-------------------------------------------------------------+
```

---

## 3. D-Bus Service and Introspection Specification

The service registers on the D-Bus session bus with the following properties:

```xml
<node>
  <interface name="org.redmibuds.Battery">
    <property name="Left"          type="i" access="read"/>
    <property name="Right"         type="i" access="read"/>
    <property name="Case"          type="i" access="read"/>
    <property name="LeftCharging"  type="b" access="read"/>
    <property name="RightCharging" type="b" access="read"/>
    <property name="CaseCharging"  type="b" access="read"/>
    <signal name="BatteryChanged"/>
  </interface>
</node>
```

---

## 4. Software Deployment and Configuration

### 4.1 System Prerequisites

```bash
# Arch Linux
sudo pacman -S python-bleak python-dasbus bluez bluez-utils

# Debian / Ubuntu / Mint
sudo apt install python3-bleak python3-dasbus bluez
```

### 4.2 Extension Installation

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/redmibuds-battery@istisu
cp -r redmibuds-battery@istisu/* ~/.local/share/gnome-shell/extensions/redmibuds-battery@istisu/
cp redmibuds-daemon.py ~/.local/share/gnome-shell/extensions/redmibuds-battery@istisu/

gnome-extensions enable redmibuds-battery@istisu
```

### 4.3 systemd User Service Deployment

Enable the background service to start automatically on login:

```bash
mkdir -p ~/.config/systemd/user
cp redmibuds-battery.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now redmibuds-battery.service
```

---

## 5. Command-Line Reference

The daemon supports optional target MAC address configuration:

```bash
python3 redmibuds-daemon.py --mac "14:6C:27:2C:CF:8D"
```

Or via environment variable:

```bash
export REDMI_BUDS_MAC="14:6C:27:2C:CF:8D"
python3 redmibuds-daemon.py
```

---

## 6. License

Distributed under the terms of the GNU General Public License v3.0 (GPL-3.0).
