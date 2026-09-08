"""Protocol and conversion tests; no QEMU process or guest is launched."""
from __future__ import annotations

from contextlib import contextmanager, redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
import socket
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import zlib

import qmp


@contextmanager
def fake_monitor(handler=None, greeting=None):
    errors = []
    seen = []
    with tempfile.TemporaryDirectory(prefix="qmp-test-") as directory:
        path = str(Path(directory) / "qmp.sock")
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(path)
        listener.listen(1)
        listener.settimeout(2)

        def send(connection, message):
            connection.sendall(json.dumps(message).encode() + b"\r\n")

        def serve():
            try:
                connection, _ = listener.accept()
                with connection:
                    connection.settimeout(2)
                    send(connection, greeting if greeting is not None else {"QMP": {"version": {}, "capabilities": []}})
                    with connection.makefile("rb") as incoming:
                        for line in incoming:
                            request = json.loads(line)
                            seen.append(request)
                            if request["execute"] == "qmp_capabilities":
                                send(connection, {"return": {}, "id": request["id"]})
                            elif handler:
                                handler(connection, request, send)
                            else:
                                send(connection, {"return": {"status": "running"}, "id": request["id"]})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                errors.append(error)

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        try:
            yield path, seen
        finally:
            listener.close()
            thread.join(3)
            if thread.is_alive():
                raise AssertionError("Mock monitor did not stop")
            if errors:
                raise errors[0]


class ProtocolTests(unittest.TestCase):
    def test_negotiates_and_matches_ids_past_events_and_unrelated_responses(self):
        def respond(connection, request, send):
            send(connection, {"event": "STOP", "timestamp": {"seconds": 1, "microseconds": 0}})
            send(connection, {"return": {"wrong": True}, "id": 800})
            packet = json.dumps({"return": {"status": "running"}, "id": request["id"]}).encode() + b"\r\n"
            connection.sendall(packet[:7])
            time.sleep(0.005)
            connection.sendall(packet[7:])

        with fake_monitor(respond) as (path, seen):
            with qmp.QMPClient(path) as client:
                self.assertEqual(client.execute("query-status"), {"status": "running"})
                self.assertEqual(client.execute("query-status"), {"status": "running"})
            self.assertEqual([entry["id"] for entry in seen], [1, 2, 3])
            self.assertEqual(seen[0]["execute"], "qmp_capabilities")

    def test_command_error_is_not_a_success(self):
        def respond(connection, request, send):
            send(connection, {"error": {"class": "CommandNotFound", "desc": "missing"}, "id": request["id"]})

        with fake_monitor(respond) as (path, _):
            with qmp.QMPClient(path) as client:
                with self.assertRaisesRegex(qmp.QMPError, "CommandNotFound: missing"):
                    client.execute("query-status")

    def test_invalid_json_fails(self):
        with fake_monitor(lambda connection, *_: connection.sendall(b"bad-json\r\n")) as (path, _):
            with qmp.QMPClient(path) as client:
                with self.assertRaisesRegex(qmp.QMPError, "Invalid QMP JSON"):
                    client.execute("query-status")

    def test_non_qmp_greeting_fails(self):
        with fake_monitor(greeting={"hello": True}) as (path, _):
            with self.assertRaisesRegex(qmp.QMPError, "QMP greeting"):
                qmp.QMPClient(path)

    def test_timeout_even_if_events_keep_arriving(self):
        def respond(connection, _request, send):
            for _ in range(100):
                send(connection, {"event": "TEST"})
                time.sleep(0.005)

        with fake_monitor(respond) as (path, _):
            with qmp.QMPClient(path, timeout=0.05) as client:
                with self.assertRaises(TimeoutError):
                    client.execute("query-status")

    def test_oversized_message_is_bounded(self):
        with fake_monitor(lambda connection, *_: connection.sendall(b"x" * (qmp.MAX_MESSAGE + 2))) as (path, _):
            with qmp.QMPClient(path) as client:
                with self.assertRaisesRegex(qmp.QMPError, "one MiB"):
                    client.execute("query-status")

    def test_cli_status_and_invalid_input(self):
        with fake_monitor() as (path, _):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(qmp.main(["--socket", path, "status"]), 0)
            self.assertEqual(json.loads(output.getvalue()), {"status": "running"})
        with patch.object(qmp, "QMPClient") as client, redirect_stderr(io.StringIO()):
            self.assertEqual(qmp.main(["--socket", "/does-not-exist", "text", "한글"]), 1)
            client.assert_not_called()


class InputTests(unittest.TestCase):
    def test_all_printable_ascii_map_to_valid_qcodes(self):
        mappings = qmp.ascii_keys("".join(chr(value) for value in range(32, 127)))
        self.assertEqual(len(mappings), 95)
        for keys in mappings:
            self.assertTrue(all(key in qmp.KEYS for key in keys))
        self.assertEqual(qmp.ascii_keys("A:?_\n\t"), [["shift", "a"], ["shift", "semicolon"], ["shift", "slash"], ["shift", "minus"], ["ret"], ["tab"]])
        for invalid in ("한글", "\x00", "\x7f", "a" * 2049):
            with self.assertRaises(ValueError):
                qmp.ascii_keys(invalid)

    def test_key_chords_and_invalid_injection(self):
        self.assertEqual(qmp.key_combo("Ctrl-Alt-Del"), ["ctrl", "alt", "delete"])
        for invalid in ("ctrl-ctrl", "ctrl-", "a; quit", "a\nquit", "$(id)", ""):
            with self.assertRaises(ValueError):
                qmp.key_combo(invalid)

    def test_keyboard_cli_uses_structured_send_key_and_suppresses_text(self):
        with fake_monitor() as (path, seen), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(qmp.main(["--socket", path, "text", "A:", "--hold-ms", "1", "--delay-ms", "0"]), 0)
            commands = [entry for entry in seen if entry["execute"] != "qmp_capabilities"]
            self.assertEqual(commands[0]["arguments"], {"keys": [{"type": "qcode", "data": "shift"}, {"type": "qcode", "data": "a"}], "hold-time": 1})
            self.assertTrue(all(entry["execute"] == "send-key" for entry in commands))
            self.assertEqual(json.loads(output.getvalue()), {"typed_characters": 2})

    def test_mouse_coordinates_and_click_release(self):
        self.assertEqual(qmp.mouse_events(1023, 767, False, 1024, 768), [{"type": "abs", "data": {"axis": "x", "value": 32767}}, {"type": "abs", "data": {"axis": "y", "value": 32767}}])
        self.assertEqual(qmp.mouse_events(-3, 10, True, None, None)[0], {"type": "rel", "data": {"axis": "x", "value": -3}})
        for values in ((-1, 0, False, 100, 100), (100, 0, False, 100, 100), (0, 0, False, None, None), (32768, 0, True, None, None)):
            with self.assertRaises(ValueError):
                qmp.mouse_events(*values)
        with fake_monitor() as (path, seen), redirect_stdout(io.StringIO()):
            self.assertEqual(qmp.main(["--socket", path, "mouse", "3", "4", "--relative", "--click", "left"]), 0)
            buttons = [entry["arguments"]["events"][0]["data"] for entry in seen[2:]]
            self.assertEqual(buttons, [{"down": True, "button": "left"}, {"down": False, "button": "left"}])


class ImageTests(unittest.TestCase):
    def test_rgb_conversion_preserves_whitespace_pixels(self):
        pixels = b"\n\r\t\x00\xff\x80"
        image, width, height = qmp.ppm_to_png(b"P6\n# screen\n2 1\n255\n" + pixels)
        self.assertEqual((width, height), (2, 1))
        self.assertEqual(image[:8], b"\x89PNG\r\n\x1a\n")
        position = 8
        chunks = {}
        while position < len(image):
            size = struct.unpack(">I", image[position:position + 4])[0]
            kind = image[position + 4:position + 8]
            chunks[kind] = image[position + 8:position + 8 + size]
            position += size + 12
        self.assertEqual(struct.unpack(">IIBBBBB", chunks[b"IHDR"]), (2, 1, 8, 2, 0, 0, 0))
        self.assertEqual(zlib.decompress(chunks[b"IDAT"]), b"\0" + pixels)
        self.assertEqual(chunks[b"IEND"], b"")

    def test_rejects_incomplete_or_unbounded_images(self):
        for data in (b"", b"P6\n1 1\n255\n", b"P6\n0 1\n255\n", b"P6\n999999 1\n255\n", b"P3\n1 1\n255\nabc", b"P6\n1 1\n65535\nabcdef"):
            with self.assertRaises(ValueError):
                qmp.ppm_to_png(data)

    def test_screenshot_writes_requested_png_and_removes_temporary_ppm(self):
        def respond(connection, request, send):
            self.assertEqual(request["execute"], "screendump")
            Path(request["arguments"]["filename"]).write_bytes(b"P6\n1 1\n255\n\xff\0\x80")
            send(connection, {"return": {}, "id": request["id"]})

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "screenshot.png"
            with fake_monitor(respond) as (path, _):
                with qmp.QMPClient(path) as client:
                    result = qmp.screenshot(client, str(destination))
            self.assertEqual(result, {"path": str(destination), "format": "png", "width": 1, "height": 1})
            self.assertEqual(list(Path(directory).iterdir()), [destination])
            self.assertTrue(destination.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))


if __name__ == "__main__":
    unittest.main()
