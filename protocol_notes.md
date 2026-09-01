# Redmi Buds 6 Active Bluetooth Low Energy Telemetry Protocol Specification

## Protocol Taxonomy and Architectural Overview

The Xiaomi Redmi Buds 6 Active hardware broadcasts real-time acoustic transducer state, charging case power reserves, and charging state flags over Bluetooth Low Energy (BLE) non-connectable undirected advertisements adhering to the Google Fast Pair Service (GFPS) standard.

### Service Identification

* **Fast Pair Service UUID (16-bit)**: `0xFE2C`
* **Fast Pair Service UUID (128-bit Expanded)**: `0000fe2c-0000-1000-8000-00805f9b34fb`

---

## Packet Payload Structure

When the charging case is opened or battery status is modified, the device emits advertisement frames containing a 15-byte service data payload mapped under UUID `0xFE2C`.

### Byte Mapping

| Offset (Byte Index) | Type | Semantics | Valid Values / Constraints |
|---|---|---|---|
| `0x00` - `0x02` | `uint24` | Model Identifier | Fast Pair Model ID (Redmi Buds 6 Active profile) |
| `0x03` - `0x11` | `bytes` | Salt / Encryption / State Block | Dynamic cryptographic payload and device state |
| `0x0C` (Byte 12) | `uint8` | Left Earbud Telemetry | Bit 7: Charging flag; Bits 0-6: State of Charge (0-100%) |
| `0x0D` (Byte 13) | `uint8` | Right Earbud Telemetry | Bit 7: Charging flag; Bits 0-6: State of Charge (0-100%) |
| `0x0E` (Byte 14) | `uint8` | Charging Case Telemetry | Bit 7: Charging flag; Bits 0-6: State of Charge (0-100%) |

---

## Bitwise Telemetry Decoding Algorithm

For each telemetry octet $B \in \{B_{12}, B_{13}, B_{14}\}$:

$$\text{IsPresent}(B) = \begin{cases} \text{False}, & \text{if } B = \text{0xFF} \\ \text{True}, & \text{otherwise} \end{cases}$$

$$\text{StateOfCharge}(B) = B \ \& \ \text{0x7F} \quad [0 \le \text{SoC} \le 100]$$

$$\text{IsCharging}(B) = (B \ \& \ \text{0x80}) \neq 0$$

If $B = \text{0xFF}$, the corresponding component (earbud or case) is disconnected, powered off, or absent from the charging cradle, yielding an uninitialized metric ($-1$).
