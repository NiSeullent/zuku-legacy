#!/usr/bin/env python3
"""Small, standard-library-only QMP console for an already running test VM."""
from __future__ import annotations

import argparse
import binascii
import json
from pathlib import Path
import socket
import struct
import sys
import tempfile
import time
import zlib

MAX_MESSAGE = 1024 * 1024
MAX_IMAGE = 64 * 1024 * 1024


class QMPError(Exception):
    pass


class QMPClient:
    def __init__(self, socket_path: str, timeout: float = 10):
        if not Path(socket_path).is_absolute() or "\x00" in socket_path:
            raise ValueError("--socket must be an absolute Unix socket path")
        if not 0 < timeout <= 120:
            raise ValueError("--timeout must be between 0 and 120 seconds")
        self.timeout = timeout
        self.buffer = bytearray()
        self.next_id = 0
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(timeout)
        try:
            self.sock.connect(socket_path)
            self.greeting = self._receive(time.monotonic() + timeout)
            if "QMP" not in self.greeting:
                raise QMPError("The socket did not send a QMP greeting")
            self.execute("qmp_capabilities")
        except BaseException:
            self.sock.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.sock.close()

    def _receive(self, deadline: float) -> dict:
        while True:
            if time.monotonic() >= deadline:
                raise TimeoutError("QMP response timed out")
            newline = self.buffer.find(b"\n")
            if newline >= 0:
                if newline > MAX_MESSAGE:
                    raise QMPError("QMP message exceeded one MiB")
                line = bytes(self.buffer[:newline]).strip()
                del self.buffer[:newline + 1]
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except (ValueError, UnicodeError) as error:
                    raise QMPError("Invalid QMP JSON response") from error
                if not isinstance(message, dict):
                    raise QMPError("QMP response must be an object")
                return message
            if len(self.buffer) > MAX_MESSAGE:
                raise QMPError("QMP message exceeded one MiB")
            self.sock.settimeout(max(0.001, deadline - time.monotonic()))
            chunk = self.sock.recv(65536)
            if not chunk:
                raise QMPError("QMP socket closed before the response")
            self.buffer.extend(chunk)

    def execute(self, command: str, arguments: dict | None = None):
        self.next_id += 1
        request_id = self.next_id
        message = {"execute": command, "id": request_id}
        if arguments is not None:
            message["arguments"] = arguments
        deadline = time.monotonic() + self.timeout
        self.sock.settimeout(self.timeout)
        self.sock.sendall(json.dumps(message, ensure_ascii=True).encode("ascii") + b"\r\n")
        while True:
            response = self._receive(deadline)
            if "event" in response:
                continue
            if response.get("id") != request_id:
                if "error" in response and "id" not in response:
                    raise QMPError("QMP rejected a command before reading its request ID")
                continue
            if "error" in response:
                error = response["error"]
                if isinstance(error, dict):
                    raise QMPError(f"{command}: {error.get('class', 'Error')}: {error.get('desc', '')}")
                raise QMPError(f"{command}: invalid command error")
            if "return" not in response:
                raise QMPError("QMP response has no return value")
            return response["return"]


ALIASES = {"enter": "ret", "return": "ret", "escape": "esc", "space": "spc",
           "del": "delete", "win": "meta_l", "windows": "meta_l", "control": "ctrl"}
KEYS = set("abcdefghijklmnopqrstuvwxyz0123456789") | {
    "shift", "shift_r", "ctrl", "ctrl_r", "alt", "alt_r", "meta_l", "meta_r",
    "ret", "esc", "spc", "tab", "backspace", "delete", "insert", "home", "end",
    "pgup", "pgdn", "up", "down", "left", "right", "caps_lock", "num_lock",
    "scroll_lock", "print", "pause", "menu", "minus", "equal", "bracket_left",
    "bracket_right", "semicolon", "apostrophe", "grave_accent", "backslash",
    "comma", "dot", "slash",
} | {f"f{i}" for i in range(1, 13)}


def key_combo(value: str) -> list[str]:
    if len(value) > 128:
        raise ValueError("Key combination is too long")
    keys = [ALIASES.get(part, part) for part in value.lower().split("-")]
    if not 1 <= len(keys) <= 6 or len(set(keys)) != len(keys) or any(key not in KEYS for key in keys):
        raise ValueError("Use known qcodes joined by '-', for example ctrl-alt-delete or alt-f4")
    return keys


def ascii_keys(value: str) -> list[list[str]]:
    if len(value) > 2048:
        raise ValueError("Text is limited to 2048 ASCII characters")
    plain = {" ": "spc", "\n": "ret", "\r": "ret", "\t": "tab", "-": "minus", "=": "equal",
             "[": "bracket_left", "]": "bracket_right", ";": "semicolon", "'": "apostrophe",
             "`": "grave_accent", "\\": "backslash", ",": "comma", ".": "dot", "/": "slash"}
    shifted = dict(zip("!@#$%^&*()", "1234567890"))
    shifted.update({"_": "minus", "+": "equal", "{": "bracket_left", "}": "bracket_right",
                    ":": "semicolon", '"': "apostrophe", "~": "grave_accent", "|": "backslash",
                    "<": "comma", ">": "dot", "?": "slash"})
    result = []
    for character in value:
        if "a" <= character <= "z" or "0" <= character <= "9":
            result.append([character])
        elif "A" <= character <= "Z":
            result.append(["shift", character.lower()])
        elif character in plain:
            result.append([plain[character]])
        elif character in shifted:
            result.append(["shift", shifted[character]])
        else:
            raise ValueError("Text accepts printable US-layout ASCII, newline and tab only")
    return result


def send_keys(client: QMPClient, keys: list[str], hold_ms: int):
    client.execute("send-key", {"keys": [{"type": "qcode", "data": key} for key in keys], "hold-time": hold_ms})
    # QMP acknowledges before the scheduled key-up. Avoid overlapping successive chords.
    time.sleep(hold_ms / 1000)


def ppm_to_png(data: bytes) -> tuple[bytes, int, int]:
    """Encode QEMU's 8-bit RGB P6 dump without requiring Pillow or ImageMagick."""
    if len(data) > MAX_IMAGE:
        raise ValueError("Screen image exceeds 64 MiB")
    index = 0
    tokens = []
    for _ in range(4):
        while index < len(data):
            if data[index:index + 1] in (b" ", b"\t", b"\r", b"\n"):
                index += 1
            elif data[index:index + 1] == b"#":
                end = data.find(b"\n", index)
                if end < 0:
                    raise ValueError("Incomplete PPM header")
                index = end + 1
            else:
                break
        start = index
        while index < len(data) and data[index:index + 1] not in (b" ", b"\t", b"\r", b"\n"):
            index += 1
        tokens.append(data[start:index])
    if tokens[0] != b"P6" or tokens[3] != b"255":
        raise ValueError("Expected an 8-bit RGB P6 screendump")
    width, height = int(tokens[1]), int(tokens[2])
    if not 1 <= width <= 8192 or not 1 <= height <= 8192 or width * height > 16_777_216:
        raise ValueError("Unsupported screen dimensions")
    # P6 has one separator before binary RGB data. Do not eat whitespace-valued pixels.
    if data[index:index + 2] == b"\r\n":
        index += 2
    elif data[index:index + 1] in (b" ", b"\t", b"\r", b"\n"):
        index += 1
    else:
        raise ValueError("Incomplete PPM header")
    pixels = data[index:]
    stride = width * 3
    if len(pixels) != stride * height:
        raise ValueError("Incomplete PPM pixel data")
    rows = b"".join(b"\0" + pixels[row * stride:(row + 1) * stride] for row in range(height))

    def chunk(kind: bytes, value: bytes) -> bytes:
        return struct.pack(">I", len(value)) + kind + value + struct.pack(">I", binascii.crc32(kind + value) & 0xffffffff)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    return png + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""), width, height


def screenshot(client: QMPClient, destination: str) -> dict:
    path = Path(destination)
    if not path.is_absolute() or path.suffix.lower() != ".png" or not path.parent.is_dir():
        raise ValueError("Screenshot needs an absolute .png path in an existing directory")
    # PPM is available before QEMU 7.1, which introduced native PNG screendump.
    with tempfile.TemporaryDirectory(prefix="qmp-screen-", dir=path.parent) as directory:
        temporary = Path(directory) / "screen.ppm"
        client.execute("screendump", {"filename": str(temporary)})
        if temporary.stat().st_size > MAX_IMAGE:
            raise ValueError("Screen image exceeds 64 MiB")
        png, width, height = ppm_to_png(temporary.read_bytes())
        path.write_bytes(png)
    return {"path": str(path), "format": "png", "width": width, "height": height}


def mouse_events(x: int, y: int, relative: bool, width: int | None, height: int | None) -> list[dict]:
    if relative:
        if abs(x) > 32767 or abs(y) > 32767:
            raise ValueError("Relative mouse movement must be within +/-32767")
        kind = "rel"
    else:
        if width is None or height is None or not 2 <= width <= 16384 or not 2 <= height <= 16384:
            raise ValueError("Absolute mouse movement requires --width and --height between 2 and 16384")
        if not 0 <= x < width or not 0 <= y < height:
            raise ValueError("Mouse coordinates must be inside the supplied display dimensions")
        x, y = round(x * 32767 / (width - 1)), round(y * 32767 / (height - 1))
        kind = "abs"
    return [{"type": kind, "data": {"axis": axis, "value": value}} for axis, value in (("x", x), ("y", y))]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", required=True, help="absolute path to the VM's QMP Unix socket")
    parser.add_argument("--timeout", type=float, default=10, help="response deadline in seconds (default 10)")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status", help="query VM run state")
    screen = commands.add_parser("screenshot", help="save a real guest display as PNG")
    screen.add_argument("path")
    keys = commands.add_parser("keys", aliases=["send-key"], help="send a bounded qcode chord")
    keys.add_argument("chord")
    keys.add_argument("--hold-ms", type=int, default=80)
    keys.add_argument("--repeat", type=int, default=1)
    text = commands.add_parser("text", help="type ASCII using a US keyboard layout; does not paste")
    text.add_argument("value")
    text.add_argument("--hold-ms", type=int, default=40)
    text.add_argument("--delay-ms", type=int, default=30)
    mouse = commands.add_parser("mouse", help="move a pointer and optionally click")
    mouse.add_argument("x", type=int)
    mouse.add_argument("y", type=int)
    mouse.add_argument("--relative", action="store_true", help="use relative PS/2 deltas instead of tablet coordinates")
    mouse.add_argument("--width", type=int)
    mouse.add_argument("--height", type=int)
    mouse.add_argument("--click", choices=["left", "middle", "right"])
    args = parser.parse_args(argv)
    try:
        # Validate input before connecting, so an invalid command makes no VM changes.
        chord = key_combo(args.chord) if args.command in ("keys", "send-key") else None
        typed = ascii_keys(args.value) if args.command == "text" else None
        events = mouse_events(args.x, args.y, args.relative, args.width, args.height) if args.command == "mouse" else None
        if hasattr(args, "hold_ms") and not 1 <= args.hold_ms <= 2000:
            raise ValueError("--hold-ms must be 1..2000")
        if hasattr(args, "repeat") and not 1 <= args.repeat <= 50:
            raise ValueError("--repeat must be 1..50")
        if hasattr(args, "delay_ms") and not 0 <= args.delay_ms <= 2000:
            raise ValueError("--delay-ms must be 0..2000")
        with QMPClient(args.socket, args.timeout) as client:
            if args.command == "status":
                result = client.execute("query-status")
            elif args.command == "screenshot":
                result = screenshot(client, args.path)
            elif chord is not None:
                for _ in range(args.repeat):
                    send_keys(client, chord, args.hold_ms)
                result = {"sent": args.repeat}
            elif typed is not None:
                for key in typed:
                    send_keys(client, key, args.hold_ms)
                    time.sleep(args.delay_ms / 1000)
                result = {"typed_characters": len(typed)}
            else:
                client.execute("input-send-event", {"events": events})
                if args.click:
                    client.execute("input-send-event", {"events": [{"type": "btn", "data": {"down": True, "button": args.click}}]})
                    try:
                        time.sleep(0.08)
                    finally:
                        client.execute("input-send-event", {"events": [{"type": "btn", "data": {"down": False, "button": args.click}}]})
                result = {"moved": True, "clicked": args.click}
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, QMPError) as error:
        print(f"qmp: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
