# VM console helper

`qmp.py` controls an **already running** QEMU VM through its explicit Unix QMP
socket. It does not download media, install, launch, stop, or configure a VM.
Python 3.10+ is sufficient; no Python packages or graphical host desktop are needed.
Keep the QMP socket private: access permits control of that VM.

```sh
python3 scripts/vm/qmp.py --socket /absolute/qmp.sock status
python3 scripts/vm/qmp.py --socket /absolute/qmp.sock screenshot /absolute/desktop.png
python3 scripts/vm/qmp.py --socket /absolute/qmp.sock keys ctrl-alt-delete
python3 scripts/vm/qmp.py --socket /absolute/qmp.sock keys alt-d
python3 scripts/vm/qmp.py --socket /absolute/qmp.sock text 'http://10.0.2.2:18787/'
python3 scripts/vm/qmp.py --socket /absolute/qmp.sock keys enter
python3 scripts/vm/qmp.py --socket /absolute/qmp.sock mouse 200 300 --width 1024 --height 768 --click left
python3 scripts/vm/qmp.py --socket /absolute/qmp.sock mouse 30 -10 --relative
```

The screenshot directory must already exist and be writable by the QEMU process
and this helper. The explicitly named PNG is overwritten on each capture. The
helper requests a temporary PPM and encodes PNG using the standard library, so it
also works with QEMU versions before native PNG screendumps were introduced.

Text input requires the guest's US keyboard layout and Caps Lock off. It accepts
printable ASCII, newline and tab; it does not provide Unicode paste or clipboard
sharing. `keys` accepts qcodes joined by `-`; `enter`, `space`, `del` and `win` are
aliases. Use `--repeat`, `--hold-ms`, or text's `--delay-ms` when a slow guest needs
extra time. A successful input command confirms delivery, not what the guest did.

Absolute mouse coordinates require a guest-supported tablet device and explicit
screen dimensions. Use `--relative` for a PS/2 pointer. Take another screenshot
to verify focus, clicks, page load and the actual installed browser version.
Screenshots of a real guest are evidence of that guest only; preserve its OS,
browser version and test conditions with any compatibility report.

Protocol references: [QMP specification](https://www.qemu.org/docs/master/interop/qmp-spec.html)
and [QEMU UI command definitions](https://github.com/qemu/qemu/blob/master/qapi/ui.json).
Requests use unique IDs, match responses, tolerate unrelated events, and fail
on command errors or deadlines. No HMP strings or host shell commands are used.

Run the helper's protocol, input and image-conversion tests with
`python3 -m unittest discover -s scripts/vm -p 'test_qmp.py'`.
These tests use a local fake QMP socket and do not launch a VM or verify IE6.

## Native IE6 fixture probe

Copy `ie6-probe.vbs` into a local directory inside the Windows XP / Server 2003
guest and run it from a command prompt:

```bat
cscript //nologo C:\qa\ie6-probe.vbs C:\qa\ie6-report.txt
```

The ASCII source constructs Korean text with `ChrW`. It launches a visible
`InternetExplorer.Application` COM instance and navigates only the fixed fixture
origin `http://10.0.2.100`; configure the VM's isolated fixture network first.
Home, community, Korean search, content, login and text mode use their canonical
URLs. A separate search check submits the real HTML GET form with a Korean value
and checks its UTF-8 query and result heading. Unexpected top-level redirects
and popups are canceled. No OS security settings or credentials are changed.

The report records executable / MSHTML versions, user agent, title, heading,
script list, canonical links and horizontal layout measurements. Page runtime
inspection reports JScript and NeonUX-LC versions when accessible; blocked
inspection is explicitly marked unverified. Text mode is inspected without
injecting script. Each navigation polls at 100 ms intervals for at most 30
seconds; COM failures and assertion failures produce a nonzero exit status.

The named report is overwritten as UTF-16LE with a BOM and also printed through
`cscript`. Omit the report argument to use `ie6-report.txt` beside the script.
Output must use a local drive; UNC paths and network drives are rejected. The
probe does not upload the report. A successful run leaves IE on the home page
for a separate QMP screenshot. `PASS_WITH_LIMITATIONS` means DOM checks passed
with recorded runtime or layout warnings; inspect those before making a
compatibility claim. The Linux helper tests do not execute this Windows script.
