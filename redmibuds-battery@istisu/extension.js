import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const DBUS_XML = `
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
</node>`;

const DBUS_SERVICE = 'org.redmibuds.Battery';
const DBUS_PATH    = '/org/redmibuds/Battery';

const RedmiBudsIndicator = GObject.registerClass(
class RedmiBudsIndicator extends PanelMenu.Button {

    _init(extension) {
        super._init(0.0, 'Redmi Buds Battery');

        this._extension = extension;
        this._proxy     = null;
        this._signalId  = null;
        this._retryId   = null;

        // ── Panel layout ───────────────────────────────────────────────
        const box = new St.BoxLayout({ vertical: false });
        this.add_child(box);

        this._leftLabel  = new St.Label({
            text: 'L:--',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._rightLabel = new St.Label({
            text: 'R:--',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._caseLabel  = new St.Label({
            text: 'C:--',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const sep1 = new St.Label({
            text: ' · ',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const sep2 = new St.Label({
            text: ' · ',
            y_align: Clutter.ActorAlign.CENTER,
        });

        box.add_child(this._leftLabel);
        box.add_child(sep1);
        box.add_child(this._rightLabel);
        box.add_child(sep2);
        box.add_child(this._caseLabel);

        // ── Dropdown menu ──────────────────────────────────────────────
        this.menu.addMenuItem(
            new PopupMenu.PopupMenuItem('Redmi Buds 6 Active', {reactive: false})
        );
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._menuLeft  = new PopupMenu.PopupMenuItem('Left:  --', {reactive: false});
        this._menuRight = new PopupMenu.PopupMenuItem('Right: --', {reactive: false});
        this._menuCase  = new PopupMenu.PopupMenuItem('Case:  --', {reactive: false});

        this.menu.addMenuItem(this._menuLeft);
        this.menu.addMenuItem(this._menuRight);
        this.menu.addMenuItem(this._menuCase);

        // ── D-Bus ──────────────────────────────────────────────────────
        this._connectDbus();
    }

    _connectDbus() {
        const ProxyClass = Gio.DBusProxy.makeProxyWrapper(DBUS_XML);

        try {
            this._proxy = new ProxyClass(
                Gio.DBus.session,
                DBUS_SERVICE,
                DBUS_PATH,
                (proxy, error) => {
                    if (error) {
                        console.error(`[RedmiBuds] D-Bus error: ${error.message}`);
                        this._scheduleRetry();
                        return;
                    }
                    console.log('[RedmiBuds] D-Bus connected.');
                    this._refresh();
                    this._signalId = this._proxy.connectSignal(
                        'BatteryChanged',
                        () => this._refresh()
                    );

                    // Watch for the daemon disappearing from the bus entirely
                    this._nameWatchId = Gio.DBus.session.watch_name(
                        DBUS_SERVICE,
                        Gio.BusNameWatcherFlags.NONE,
                        // name appeared — refresh immediately
                        () => {
                            console.log('[RedmiBuds] Daemon appeared on bus.');
                            this._refresh();
                        },
                        // name vanished — daemon died or device disconnected
                        () => {
                            console.log('[RedmiBuds] Daemon vanished — scheduling reconnect.');
                            if (this._proxy && this._signalId) {
                                this._proxy.disconnectSignal(this._signalId);
                                this._signalId = null;
                            }
                            this._proxy = null;
                            // Show dashes immediately so stale values don't linger
                            this._clearLabels();
                            this._scheduleRetry();
                        }
                    );
                }
            );
        } catch (e) {
            console.error(`[RedmiBuds] Proxy creation failed: ${e.message}`);
            this._scheduleRetry();
        }
    },

    // Reset all labels to '--' without waiting for a D-Bus reply
    _clearLabels() {
        this._leftLabel.set_text('L:--');
        this._rightLabel.set_text('R:--');
        this._caseLabel.set_text('C:--');
        this._menuLeft.label.set_text('Left:   --');
        this._menuRight.label.set_text('Right:  --');
        this._menuCase.label.set_text('Case:   --');
    },

    _scheduleRetry() {
        if (this._retryId)
            return;
        this._retryId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 10, () => {
                this._retryId = null;
                this._connectDbus();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _refresh() {
            if (!this._proxy)
            return;

        // Force the proxy to re-read all properties from D-Bus
        // rather than serving stale cached values
        this._proxy.g_connection.call(
            DBUS_SERVICE,
            DBUS_PATH,
            'org.freedesktop.DBus.Properties',
            'GetAll',
            new GLib.Variant('(s)', [DBUS_SERVICE]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                try {
                    const reply = conn.call_finish(res);
                    // reply is ((a{sv}),) — unwrap the outer tuple
                    const props = reply.deepUnpack()[0];

                    const left  = props['Left']?.deepUnpack()  ?? -1;
                    const right = props['Right']?.deepUnpack() ?? -1;
                    const cas   = props['Case']?.deepUnpack()  ?? -1;
                    const lc    = props['LeftCharging']?.deepUnpack()  ?? false;
                    const rc    = props['RightCharging']?.deepUnpack() ?? false;
                    const cc    = props['CaseCharging']?.deepUnpack()  ?? false;

                    this._leftLabel.set_text(this._short('L', left, lc));
                    this._rightLabel.set_text(this._short('R', right, rc));
                    this._caseLabel.set_text(this._short('C', cas, cc));

                    this._menuLeft.label.set_text(`Left:   ${this._long(left, lc)}`);
                    this._menuRight.label.set_text(`Right:  ${this._long(right, rc)}`);
                    this._menuCase.label.set_text(`Case:   ${this._long(cas, cc)}`);

                    this.visible = (left !== -1 || right !== -1 || cas !== -1);
                } catch (e) {
                    console.error(`[RedmiBuds] Property read failed: ${e.message}`);
                }
            }
        );
    }

    _short(prefix, level, charging) {
        if (level === -1) return `${prefix}:--`;
        return `${prefix}:${level}%${charging ? '⚡' : ''}`;
    }

    _long(level, charging) {
        if (level === -1) return 'absent';
        return `${level}%${charging ? ' (charging)' : ''}`;
    }

    destroy() {
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = null;
        }
        if (this._nameWatchId) {
            Gio.DBus.session.unwatch_name(this._nameWatchId);
            this._nameWatchId = null;
        }
        if (this._proxy && this._signalId) {
            this._proxy.disconnectSignal(this._signalId);
            this._signalId = null;
        }
        this._proxy = null;
        super.destroy();
    }
});

export default class RedmiBudsBatteryExtension extends Extension {

    enable() {
        console.log('[RedmiBuds] Extension enabling...');
        this._indicator = new RedmiBudsIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');
        console.log('[RedmiBuds] Indicator added to panel.');
    }

    disable() {
        console.log('[RedmiBuds] Extension disabling...');
        this._indicator?.destroy();
        this._indicator = null;
    }
}
