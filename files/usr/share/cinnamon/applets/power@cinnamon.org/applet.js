const Applet = imports.ui.applet;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Interfaces = imports.misc.interfaces
const Lang = imports.lang;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;
const Pango = imports.gi.Pango;
const Main = imports.ui.main;
const Settings = imports.ui.settings;
const GnomeSession = imports.misc.gnomeSession;

const DimSettingsSchema = "org.cinnamon.settings-daemon.plugins.power";
const DimSettingsAc = "idle-dim-ac";
const DimSettingsBattery = "idle-dim-battery";
const BrightnessBusName = "org.cinnamon.SettingsDaemon.Power.Screen";
const KeyboardBusName = "org.cinnamon.SettingsDaemon.Power.Keyboard";

const UPDeviceType = {
    UNKNOWN: 0,
    AC_POWER: 1,
    BATTERY: 2,
    UPS: 3,
    MONITOR: 4,
    MOUSE: 5,
    KEYBOARD: 6,
    PDA: 7,
    PHONE: 8,
    MEDIA_PLAYER: 9,
    TABLET: 10,
    COMPUTER: 11
};

const UPDeviceState = {
    UNKNOWN: 0,
    CHARGING: 1,
    DISCHARGING: 2,
    EMPTY: 3,
    FULLY_CHARGED: 4,
    PENDING_CHARGE: 5,
    PENDING_DISCHARGE: 6
};

function DeviceItem() {
    this._init.apply(this, arguments);
}

DeviceItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(device, status) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, { reactive: false });

        let [device_id, device_type, icon, percentage, state, time, timepercentage] = device;

        this._box = new St.BoxLayout({ style_class: 'popup-device-menu-item' });
        this._vbox = new St.BoxLayout({ style_class: 'popup-device-menu-item', vertical: true});
        this._label = new St.Label({ text: this._deviceTypeToString(device_type) });
        let statusLabel = new St.Label({ text: status, style_class: 'popup-inactive-menu-item' });
        let percentLabel = new St.Label({ text: "%d%%".format(Math.round(percentage))});

        this._icon = new St.Icon({ gicon: Gio.icon_new_for_string(icon),
                                   icon_type: St.IconType.SYMBOLIC,
                                   style_class: 'popup-menu-icon' });

        this._box.add_actor(this._icon);
        this._box.add_actor(this._label);
        this._box.add_actor(percentLabel);

        this._vbox.add_actor(this._box);
        this._vbox.add_actor(statusLabel);
        
        this.addActor(this._vbox);

    },

    _deviceTypeToString: function(type) {
        switch (type) {
            case UPDeviceType.AC_POWER:
                return _("AC adapter");
            case UPDeviceType.BATTERY:
                return _("Laptop battery");
            case UPDeviceType.UPS:
                return _("UPS");
            case UPDeviceType.MONITOR:
                return _("Monitor");
            case UPDeviceType.MOUSE:
                return _("Mouse");
            case UPDeviceType.KEYBOARD:
                return _("Keyboard");
            case UPDeviceType.PDA:
                return _("PDA");
            case UPDeviceType.PHONE:
                return _("Cell phone");
            case UPDeviceType.MEDIA_PLAYER:
                return _("Media player");
            case UPDeviceType.TABLET:
                return _("Tablet");
            case UPDeviceType.COMPUTER:
                return _("Computer");
            default:
                return _("Unknown");
        }
    }
}

function BrightnessSlider(applet, label, icon, busName){
    this._init(applet, label, icon, busName);
}

BrightnessSlider.prototype = {
    __proto__: PopupMenu.PopupSliderMenuItem.prototype,

    _init: function(applet, label, icon, busName){
        PopupMenu.PopupSliderMenuItem.prototype._init.call(this, 0);
        this.actor.hide();

        this._applet = applet;
        this._seeking = false;

        this.connect("drag-begin", Lang.bind(this, function(){
            this._seeking = true;
        }));
        this.connect("drag-end", Lang.bind(this, function(){
            this._seeking = false;
        }));

        this.icon = new St.Icon({icon_name: icon, icon_type: St.IconType.SYMBOLIC, icon_size: 16});
        this.removeActor(this._slider);
        this.addActor(this.icon, {span: 0});
        this.addActor(this._slider, {span: -1, expand: true});

        this.label = label;
        this.toolTipText = label;
        this.tooltip = new Tooltips.Tooltip(this.actor, this.tooltipText);

        Interfaces.getDBusProxyAsync(busName, Lang.bind(this, function(proxy, error) {
            this._proxy = proxy;
            this._proxy.GetPercentageRemote(Lang.bind(this, this._dbusAcquired));
        }));
    },

    _dbusAcquired: function(b, error){
        if(error)
            return;

        this._updateBrightnessLabel(b);
        this.setValue(b / 100);
        this.connect("value-changed", Lang.bind(this, this._sliderChanged));

        this.actor.show();

        //get notified
        this._proxy.connectSignal('Changed', Lang.bind(this, this._getBrightness));
        this._applet.menu.connect("open-state-changed", Lang.bind(this, this._getBrightnessForcedUpdate));
    },

    _sliderChanged: function(slider, value) {
        this._setBrightness(Math.round(value * 100));
    },

    _getBrightness: function() {
        //This func is called when dbus signal is received.
        //Only update items value when slider is not used
        if (!this._seeking)
            this._getBrightnessForcedUpdate();
    },

    _getBrightnessForcedUpdate: function() {
        this._proxy.GetPercentageRemote(Lang.bind(this, function(b) {
            this._updateBrightnessLabel(b);
            this.setValue(b / 100);
        }));
    },

    _setBrightness: function(value) {
        this._proxy.SetPercentageRemote(value, Lang.bind(this, function(b) {
            this._updateBrightnessLabel(b);
        }));
    },

    _updateBrightnessLabel: function(value) {
        this.tooltipText = this.label;
        if(value)
            this.tooltipText += ": " + value + "%";

        this.tooltip.set_text(this.tooltipText);
    }
};

const INHIBIT_IDLE_FLAG = 8; /* idle inhibit only */

function InhibitSwitch() {
    this._init.apply(this);
}

InhibitSwitch.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        this.label = new St.Label({ text: _("Prevent system idling") });

        this._statusIcon = new St.Icon({ style_class: 'popup-menu-icon',
                                           icon_type: St.IconType.SYMBOLIC,
                                           icon_name: "dialog-warning-symbolic",
                                          reactive: true});

        this._switch = new PopupMenu.Switch(false);

        this.addActor(this.label);
        this.addActor(this._statusIcon);

        this._statusBin = new St.Bin({ x_align: St.Align.END });
        this.addActor(this._statusBin, { expand: true, span: -1, align: St.Align.END });
        this._statusBin.child = this._switch.actor;

        this.actor.hide();
        this.tooltip = new Tooltips.Tooltip(this._statusIcon, "");

        this.sessionProxy = null;
        this.sessionCookie = null;
        this.sigAddedId = 0
        this.sigRemovedId = 0

        GnomeSession.SessionManager(Lang.bind(this, function(proxy, error) {
            if (error)
                return;

            this.sessionProxy = proxy;
            this.actor.show();
            this.updateStatus();
            this.propId = this.sessionProxy.connect("g-properties-changed",
                                                    Lang.bind(this, this.updateStatus));
        }));
    },

    activate: function(event) {
        if (this._switch.actor.mapped) {
            this._switch.toggle();
        }

        this.toggled(this._switch.state);

        PopupMenu.PopupBaseMenuItem.prototype.activate.call(this, event, true);
    },

    updateStatus: function(o) {
        this.sessionProxy.IsInhibitedRemote(INHIBIT_IDLE_FLAG, Lang.bind(this, function(is_inhibited) {
            if (is_inhibited[0] && !this.sessionCookie) {
                this.tooltip.set_text(_("Another program is already inhibiting idle"));
                this._statusIcon.show();
            } else {
                this.tooltip.set_text("");
                this._statusIcon.hide();
            }
        }));
    },

    toggled: function(active) {
        if (active && !this.sessionCookie) {
            this.sessionProxy.InhibitRemote("power@cinnamon.org",
                                            0,
                                            "prevent idle functions like screen blanking and dimming",
                                            INHIBIT_IDLE_FLAG,
                                            Lang.bind(this, function(cookie) {
                                                this.sessionCookie = cookie;
                                                this.updateStatus();
                                            }));
        } else if (!active && this.sessionCookie) {
            this.sessionProxy.UninhibitRemote(this.sessionCookie);
            this.sessionCookie = null;
            this.updateStatus();
        }
    },

    kill: function() {
        if (!this.sessionProxy)
            return;

        if (this.sessionCookie) {
            this.sessionProxy.UninhibitRemote(this.sessionCookie);
            this.sessionCookie = null;
        }

        this.sessionProxy.disconnect(this.propId);
    }
};

function MyApplet(metadata, orientation, panel_height, instanceId) {
    this._init(metadata, orientation, panel_height, instanceId);
}


MyApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instanceId) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instanceId);

        try {
            this.metadata = metadata;

            this.settings = new Settings.AppletSettings(this, metadata.uuid, instanceId);
            this.settings.bindProperty(Settings.BindingDirection.IN, "showpercentage", "showpercentage", Lang.bind(this, this._devicesChanged), null);

            Main.systrayManager.registerRole("power", metadata.uuid);
            Main.systrayManager.registerRole("battery", metadata.uuid);

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

            this._deviceItems = [ ];
            this._primaryDeviceId = null;

            this._otherDevicePosition = 0;

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this.brightness = new BrightnessSlider(this, _("Brightness"), "display-brightness", BrightnessBusName);
            this.keyboard = new BrightnessSlider(this, _("Keyboard backlight"), "keyboard-brightness", KeyboardBusName);
            this.menu.addMenuItem(this.brightness);
            this.menu.addMenuItem(this.keyboard);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this.inhibitSwitch = new InhibitSwitch();
            this.menu.addMenuItem(this.inhibitSwitch);

            this.menu.addSettingsAction(_("Power Settings"), 'power');

            this.actor.connect("scroll-event", Lang.bind(this, this._onScrollEvent));

            Interfaces.getDBusProxyAsync("org.cinnamon.SettingsDaemon.Power", Lang.bind(this, function(proxy, error) {
                this._proxy = proxy;
                this._proxy.connect("g-properties-changed", Lang.bind(this, this._devicesChanged));
                this._devicesChanged();
            }));
        }
        catch (e) {
            global.logError(e);
        }
    },

    _onButtonPressEvent: function(actor, event){
        //toggle keyboard brightness on middle click
        if(event.get_button() === 2){
            this.keyboard._proxy.ToggleRemote(function(){});
        }
        return Applet.Applet.prototype._onButtonPressEvent.call(this, actor, event);
    },

    on_applet_clicked: function(event) {
        this.menu.toggle();
    },

    _onScrollEvent: function(actor, event) {
        //adjust screen brightness on scroll
        let direction = event.get_scroll_direction();
        if (direction == Clutter.ScrollDirection.UP) {
            this.brightness._proxy.StepUpRemote(function(){});
        } else if (direction == Clutter.ScrollDirection.DOWN) {
            this.brightness._proxy.StepDownRemote(function(){});
        }
        this.brightness._getBrightnessForcedUpdate();
    },

    _getDeviceStatus: function(device) {
        status = ""
        let [device_id, device_type, icon, percentage, state, seconds] = device;
        if (device_type == UPDeviceType.BATTERY) {
            let time = Math.round(seconds / 60);
            
            let minutes = time % 60;
            let hours = Math.floor(time / 60);
         
            if (state == UPDeviceState.CHARGING) {
                if (time > 60) {
                    if (minutes == 0) {
                        status = ngettext("Charging - %d hour until fully charged", "Charging - %d hours until fully charged", hours).format(hours);
                    } 
                    else {
                        /* TRANSLATORS: this is a time string, as in "%d hours %d minutes remaining" */
                        let template = _("Charging - %d %s %d %s until fully charged");
                        status = template.format (hours, ngettext("hour", "hours", hours), minutes, ngettext("minute", "minutes", minutes));
                    }
                } 
                else {
                    status = ngettext("Charging - %d minute until fully charged", "Charging - %d minutes until fully charged", minutes).format(minutes);
                }
            }
            else if (state == UPDeviceState.FULLY_CHARGED) {
                status = _("Fully charged");
            }
            else {
                if (time == 0) {
                    // 0 is reported when UPower does not have enough data to estimate battery life
                    status = _("Estimating...");
                }
                else if (time > 60) {
                    if (minutes == 0) {
                        status = ngettext("Using battery power - %d hour remaining", "Using battery power - %d hours remaining", hours).format(hours);
                    } 
                    else {
                        /* TRANSLATORS: this is a time string, as in "%d hours %d minutes remaining" */
                        let template = _("Using battery power - %d %s %d %s remaining");
                        status = template.format (hours, ngettext("hour", "hours", hours), minutes, ngettext("minute", "minutes", minutes));
                    }
                } 
                else {
                    status = ngettext("Using battery power - %d minute remaining", "Using battery power - %d minutes remaining", minutes).format(minutes);
                }
            }
        }

        return status;
    },

    on_panel_height_changed: function() {
        if (this._proxy)
            this._devicesChanged();
    },

    _devicesChanged: function() {

        // Identify the primary battery device
        this._proxy.GetPrimaryDeviceRemote(Lang.bind(this, function(device, error) {
            if (error) {
                this._primaryDeviceId = null;
            }
            else {
                if (device.length == 1) {
                    // Primary Device can be an array of primary devices rather than a single device, in that case, take the first one.
                    device = device[0];
                }
                let [device_id, device_type, icon, percentage, state, seconds] = device
                this._primaryDeviceId = device_id;
            }
        }));

        // Scan battery devices
        this._proxy.GetDevicesRemote(Lang.bind(this, function(result, error) {
            this._deviceItems.forEach(function(i) { i.destroy(); });
            this._deviceItems = [];

            if (!error) {
                let devices = result[0];
                let position = 0;
                for (let i = 0; i < devices.length; i++) {
                    let [device_id, device_type, icon, percentage, state, seconds] = devices[i];

                    if (device_type == UPDeviceType.AC_POWER)
                        continue;

                    let status = this._getDeviceStatus(devices[i]);

                    if (this._primaryDeviceId == null || this._primaryDeviceId == device_id) {
                        // Info for the primary battery (either the primary device, or any battery device if there is no primary device)
                        if (device_type == UPDeviceType.BATTERY) {
                            this.set_applet_tooltip(status);
                            if (this.showpercentage) {
                                this.set_applet_label("%d%%".format(Math.round(percentage)));
                            }
                            else {
                                this.set_applet_label("");
                            }
                        }
                    }

                    let item = new DeviceItem (devices[i], status);
                    this._deviceItems.push(item);
                    this.menu.addMenuItem(item, this._otherDevicePosition + position);
                    position++;
                }
            }
        }));
        
        // Update the panel icon
        let icon = this._proxy.Icon;
        if(icon){
            this.set_applet_icon_symbolic_name('battery-missing');
            let gicon = Gio.icon_new_for_string(icon);
            this._applet_icon.gicon = gicon;
        }
    },

    on_applet_removed_from_panel: function() {
        Main.systrayManager.unregisterId(this.metadata.uuid);
        this.inhibitSwitch.kill();
    }
};

function main(metadata, orientation, panel_height, instanceId) {
    let myApplet = new MyApplet(metadata, orientation, panel_height, instanceId);
    return myApplet;
}
