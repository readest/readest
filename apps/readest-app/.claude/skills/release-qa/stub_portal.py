#!/usr/bin/python3
# Minimal xdg-desktop-portal stub for a private D-Bus session: FileChooser answers
# from $QA_DIR/answer.json ({"open": [absolute paths], "saveDir": dir, "cancel": bool}), OpenURI/OpenFile
# log the request. Every call goes to $QA_DIR/portal.log.
import json, os, sys, time
from pathlib import Path
from gi.repository import Gio, GLib
D = os.environ.get('QA_DIR') or os.path.dirname(os.path.abspath(__file__))
LOG = open(os.path.join(D, 'portal.log'), 'a', buffering=1)
def log(*a): LOG.write(time.strftime('%H:%M:%S ') + ' '.join(str(x) for x in a) + '\n')
XML = '''<node>
<interface name="org.freedesktop.portal.FileChooser">
 <method name="OpenFile"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
 <method name="SaveFile"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
 <method name="SaveFiles"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
 <property name="version" type="u" access="read"/>
</interface>
<interface name="org.freedesktop.portal.OpenURI">
 <method name="OpenURI"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
 <method name="OpenFile"><arg type="s" direction="in"/><arg type="h" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
 <method name="OpenDirectory"><arg type="s" direction="in"/><arg type="h" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
 <property name="version" type="u" access="read"/>
</interface>
<interface name="org.freedesktop.portal.Settings">
 <method name="ReadAll"><arg type="as" direction="in"/><arg type="a{sa{sv}}" direction="out"/></method>
 <method name="Read"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
 <method name="ReadOne"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
 <property name="version" type="u" access="read"/>
</interface>
</node>'''
node = Gio.DBusNodeInfo.new_for_xml(XML)
conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
def answer():
    try: return json.load(open(os.path.join(D, 'answer.json')))
    except Exception: return {}
def respond(sender, opts, results, code=0):
    tok = opts.get('handle_token', 'stub%d' % int(time.time()*1000))
    path = '/org/freedesktop/portal/desktop/request/%s/%s' % (sender[1:].replace('.', '_'), tok)
    def emit():
        conn.emit_signal(sender, path, 'org.freedesktop.portal.Request', 'Response', GLib.Variant('(ua{sv})', (code, results)))
        return False
    GLib.timeout_add(150, emit)
    return path
def on_call(c, sender, objpath, iface, method, params, inv):
    p = params.unpack()
    opts = p[2] if len(p) > 2 and isinstance(p[2], dict) else {}
    a = answer()
    if iface == 'org.freedesktop.portal.FileChooser':
        log(method, 'title=%r' % p[1], 'opts=%s' % {k: v for k, v in opts.items() if k in ('current_name', 'multiple', 'directory', 'filters', 'current_folder')})
        if a.get('cancel'):
            path = respond(sender, opts, {}, 1)
            log('  -> cancel')
        elif method == 'OpenFile':
            uris = a.get('open', [])
            path = respond(sender, opts, {'uris': GLib.Variant('as', [Path(u).as_uri() for u in uris])})
            log('  -> open', uris)
        else:
            name = opts.get('current_name', 'out.bin')
            out = os.path.join(a.get('saveDir', D), name)
            path = respond(sender, opts, {'uris': GLib.Variant('as', [Path(out).as_uri()])})
            log('  -> save', out)
        inv.return_value(GLib.Variant('(o)', (path,)))
    elif iface == 'org.freedesktop.portal.OpenURI':
        log(method, p[1] if method == 'OpenURI' else '(fd)')
        inv.return_value(GLib.Variant('(o)', (respond(sender, opts, {}),)))
    elif iface == 'org.freedesktop.portal.Settings':
        inv.return_dbus_error('org.freedesktop.portal.Error.NotFound', 'stub')
def get_prop(c, sender, objpath, iface, prop):
    return GLib.Variant('u', 4 if iface != 'org.freedesktop.portal.Settings' else 2)
for itf in node.interfaces:
    conn.register_object('/org/freedesktop/portal/desktop', itf, on_call, get_prop, None)
Gio.bus_own_name_on_connection(conn, 'org.freedesktop.portal.Desktop', Gio.BusNameOwnerFlags.REPLACE, lambda *a: log('owned name'), lambda *a: log('LOST name'))
log('stub portal started')
GLib.MainLoop().run()
