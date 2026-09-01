#!/usr/bin/env python3
"""
Redmi Buds 6 Active Background Telemetry Daemon
Listens for Google Fast Pair BLE advertisements and exports telemetry via D-Bus.
"""

import argparse
import asyncio
import logging
import os
import signal
import subprocess
from threading import Thread

from dasbus.connection import SessionMessageBus
from dasbus.server.interface import dbus_interface, dbus_signal
from dasbus.typing import Int, Bool
from dasbus.loop import EventLoop
from gi.repository import GLib

from bleak import BleakScanner

DEFAULT_ADDRESS = "14:6C:27:2C:CF:8D"
FP_UUID = "0000fe2c-0000-1000-8000-00805f9b34fb"
DBUS_SERVICE = "org.redmibuds.Battery"
DBUS_PATH = "/org/redmibuds/Battery"
SILENCE_TIMEOUT = 10

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s"
)
log = logging.getLogger("redmibuds")


@dbus_interface(DBUS_SERVICE)
class BatteryInterface:

    def __init__(self):
        self._left = -1
        self._right = -1
        self._case = -1
        self._left_charging = False
        self._right_charging = False
        self._case_charging = False
        self.last_seen = 0.0

    @property
    def Left(self) -> Int:
        return self._left

    @property
    def Right(self) -> Int:
        return self._right

    @property
    def Case(self) -> Int:
        return self._case

    @property
    def LeftCharging(self) -> Bool:
        return self._left_charging

    @property
    def RightCharging(self) -> Bool:
        return self._right_charging

    @property
    def CaseCharging(self) -> Bool:
        return self._case_charging

    @dbus_signal
    def BatteryChanged(self):
        pass

    def update(self, left, right, case,
               left_charging, right_charging, case_charging):
        try:
            loop = asyncio.get_event_loop()
            self.last_seen = loop.time()
        except RuntimeError:
            pass

        changed = (
            self._left != left or
            self._right != right or
            self._case != case or
            self._left_charging != left_charging or
            self._right_charging != right_charging or
            self._case_charging != case_charging
        )

        if not changed:
            return

        self._left = left
        self._right = right
        self._case = case
        self._left_charging = left_charging
        self._right_charging = right_charging
        self._case_charging = case_charging

        log.info(
            f"L:{left}%{' (charging)' if left_charging else ''}  "
            f"R:{right}%{' (charging)' if right_charging else ''}  "
            f"Case:{case}%{' (charging)' if case_charging else ''}"
        )

        GLib.idle_add(self.BatteryChanged)


def parse_advertisement(data: bytes):
    if len(data) < 15:
        return None

    def decode(byte: int):
        if byte == 0xFF:
            return -1, False
        return byte & 0x7F, bool(byte & 0x80)

    left, lc = decode(data[12])
    right, rc = decode(data[13])
    case, cc = decode(data[14])
    return left, right, case, lc, rc, cc


async def silence_watchdog(battery_interface: BatteryInterface, seen_at: float):
    try:
        await asyncio.sleep(SILENCE_TIMEOUT)
        if battery_interface.last_seen == seen_at:
            log.info("Device signal timeout - resetting telemetry to disconnected state")
            battery_interface.update(-1, -1, -1, False, False, False)
    except asyncio.CancelledError:
        pass


async def wait_for_adapter(timeout: int = 30):
    log.info("Verifying Bluetooth controller readiness...")
    for _ in range(timeout):
        try:
            result = subprocess.run(
                ["bluetoothctl", "show"],
                capture_output=True, text=True, timeout=3
            )
            if "Powered: yes" in result.stdout:
                log.info("Bluetooth controller online and operational.")
                return
        except Exception:
            pass
        await asyncio.sleep(1)
    log.warning("Bluetooth controller verification timed out - proceeding.")


async def scanner_loop(battery_interface: BatteryInterface, target_suffix: str):
    log.info(f"BLE scanner initialized - filtering by target suffix: {target_suffix}")
    watchdog_task = None

    while True:
        try:
            await wait_for_adapter()

            async with BleakScanner() as scanner:
                async for device, adv in scanner.advertisement_data():
                    if not device.address.lower().endswith(target_suffix):
                        continue
                    if FP_UUID not in (adv.service_data or {}):
                        continue

                    result = parse_advertisement(
                        bytes(adv.service_data[FP_UUID])
                    )
                    if result is None:
                        continue

                    battery_interface.update(*result)

                    if watchdog_task and not watchdog_task.done():
                        watchdog_task.cancel()

                    watchdog_task = asyncio.create_task(
                        silence_watchdog(
                            battery_interface,
                            battery_interface.last_seen
                        )
                    )

        except asyncio.CancelledError:
            if watchdog_task and not watchdog_task.done():
                watchdog_task.cancel()
            break
        except Exception as e:
            log.warning(f"Scanner exception encountered ({e}) - retrying in 5 seconds...")
            battery_interface.update(-1, -1, -1, False, False, False)
            if watchdog_task and not watchdog_task.done():
                watchdog_task.cancel()
            await asyncio.sleep(5)


def start_scanner(battery_interface: BatteryInterface, target_suffix: str):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(scanner_loop(battery_interface, target_suffix))
    finally:
        loop.close()


def main():
    parser = argparse.ArgumentParser(
        description="Redmi Buds 6 Active Telemetry and D-Bus Daemon"
    )
    parser.add_argument(
        "--mac",
        default=os.environ.get("REDMI_BUDS_MAC", DEFAULT_ADDRESS),
        help=f"Target Bluetooth MAC address (default: {DEFAULT_ADDRESS})"
    )
    args = parser.parse_args()

    target_suffix = ":".join(args.mac.split(":")[-4:]).lower()
    log.info(f"Configured target MAC: {args.mac} (suffix match: {target_suffix})")

    bus = SessionMessageBus()
    interface = BatteryInterface()
    bus.publish_object(DBUS_PATH, interface)
    bus.register_service(DBUS_SERVICE)
    log.info(f"D-Bus interface published at {DBUS_SERVICE} ({DBUS_PATH})")

    scanner_thread = Thread(
        target=start_scanner,
        args=(interface, target_suffix),
        daemon=True
    )
    scanner_thread.start()

    loop = EventLoop()

    def on_shutdown(*_):
        log.info("Shutdown signal received. Terminating daemon.")
        loop.quit()

    signal.signal(signal.SIGTERM, on_shutdown)
    signal.signal(signal.SIGINT, on_shutdown)

    try:
        loop.run()
    finally:
        bus.disconnect()


if __name__ == "__main__":
    main()
