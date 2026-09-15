#!/usr/bin/env python3
"""Exercise the actual Tauri/WebKit UI in an isolated temporary vault.
Requires tauri-driver, WebKitWebDriver and a graphical display (or xvfb-run).
Usage: TAURI_DRIVER=/path/to/tauri-driver python3 scripts/smoke-gui.py /path/to/pablock
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

binary = str(Path(sys.argv[1]).resolve())
base = 'http://127.0.0.1:4455'
def http(method, route, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + route, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = json.load(response)
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode()) from e
    value = body.get('value')
    if isinstance(value, dict) and 'error' in value:
        raise RuntimeError(value)
    return value

with tempfile.TemporaryDirectory(prefix='pablock-gui-') as directory:
    root = Path(directory)
    project = root / 'project'
    project.mkdir()
    (project / '.env').write_text('TOKEN=smoke-secret\n')
    env = dict(os.environ, XDG_DATA_HOME=str(root / 'data'), APPIMAGE_EXTRACT_AND_RUN='1')
    log = open('/tmp/pablock-gui-driver.log', 'w')
    driver = subprocess.Popen([os.environ.get('TAURI_DRIVER', 'tauri-driver'), '--port', '4455', '--native-port', '4456'], env=env, stdout=log, stderr=subprocess.STDOUT)
    session = None
    try:
        for _ in range(100):
            try:
                http('GET', '/status')
                break
            except (OSError, RuntimeError):
                time.sleep(.1)
        result = http('POST', '/session', {'capabilities': {'alwaysMatch': {'tauri:options': {'application': binary}}}})
        session = result['sessionId']
        prefix = '/session/' + session
        def js(script, args=None):
            return http('POST', prefix + '/execute/sync', {'script': script, 'args': args or []})
        def wait_js(script, timeout=20):
            end = time.monotonic() + timeout
            while time.monotonic() < end:
                if js(script):
                    return
                time.sleep(.15)
            raise AssertionError('Timed out: ' + script + '\n' + js('return document.body.innerText'))
        def click_text(text):
            js("const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===arguments[0]);if(!b)throw Error('Button missing: '+arguments[0]);b.click();", [text])
        def fill(label, value):
            js("const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(arguments[0]));const e=l?.querySelector('input,textarea');if(!e)throw Error('Input missing');const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,arguments[1]);e.dispatchEvent(new Event('input',{bubbles:true}));", [label, value])
        wait_js("return document.body.innerText.includes('Create vault')")
        fill('Master password', 'smoke-master-password')
        fill('Confirm password', 'smoke-master-password')
        click_text('Create vault')
        wait_js("return document.body.innerText.includes('Your projects')")
        js("document.querySelector('button[aria-label=\"Add project\"]').click()")
        wait_js("return !!document.querySelector('dialog[open]')")
        fill('Project directory', str(project))
        js("document.querySelector('dialog form').requestSubmit()")
        wait_js("return location.hash.includes('/project/')")
        js("document.querySelector('button[aria-label=\"Scan project\"]').click()")
        wait_js("return !!document.querySelector('dialog[open] input[type=checkbox]')")
        click_text('Preview import')
        wait_js("return [...document.querySelectorAll('dialog button')].some(b=>b.textContent.trim()==='Confirm')")
        click_text('Confirm')
        wait_js("return !!document.querySelector('button[aria-label=\"Reveal TOKEN\"]')")
        js("document.querySelector('button[aria-label=\"Reveal TOKEN\"]').click()")
        wait_js("return document.body.innerText.includes('smoke-secret')")
        js("document.querySelector('button[aria-label=\"Hide TOKEN\"]').click()")
        wait_js("return !document.body.innerHTML.includes('smoke-secret')")
        # The actual restricted window capability must work too.
        js("document.querySelector('button[aria-label=\"Maximize\"]').click()")
        js("document.querySelector('button[aria-label=\"Diff & export\"]').click()")
        wait_js("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Compare with disk')")
        fill('Destination file', 'export.env')
        click_text('Compare with disk')
        wait_js("return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Export file')")
        click_text('Export file')
        wait_js("return document.body.innerText.includes('Export complete.')")
        assert (project / 'export.env').read_text() == 'TOKEN="smoke-secret"\n'
        click_text('Close')
        wait_js("return !document.querySelector('dialog[open]')")
        time.sleep(.2)
        screenshot = http('GET', prefix + '/screenshot')
        Path('/tmp/pablock-gui-smoke.png').write_bytes(base64.b64decode(screenshot))
        js("document.querySelector('button[aria-label=\"Lock vault\"]').click()")
        wait_js("return document.body.innerText.includes('Unlock vault')")
        assert not js("return document.body.innerHTML.includes('smoke-secret')")
        print('PASS: real WebKit setup, add project, scan preview/import, reveal/hide, export, and lock')
    finally:
        if session:
            try:
                http('DELETE', '/session/' + session)
            except (OSError, RuntimeError):
                pass
        driver.terminate()
        try:
            driver.wait(timeout=5)
        except subprocess.TimeoutExpired:
            driver.kill()
        log.close()
