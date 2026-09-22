"""Local-only HTTP service. Python standard library; no package installation required."""
from __future__ import annotations

import argparse
import functools
import json
import logging
import mimetypes
from pathlib import Path
import re
import sqlite3
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
import uuid
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
MAX_BODY = 64 * 1024 * 1024
MAX_SAMPLES = 18000


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
                sample_count INTEGER NOT NULL, summary TEXT NOT NULL, payload TEXT NOT NULL)""")

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def list(self):
        with self.connect() as db:
            rows = db.execute("SELECT id,name,created_at,sample_count,summary FROM sessions ORDER BY created_at DESC LIMIT 200")
            return [dict(r, summary=json.loads(r["summary"])) for r in rows]

    def get(self, sid):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM sessions WHERE id=?", (sid,)).fetchone()
            return json.loads(row[0]) if row else None

    def create(self, body):
        if not isinstance(body, dict) or body.get("schema_version") != 1:
            raise ValueError("Expected a FaceScope session with schema_version 1.")
        name = body.get("name")
        samples = body.get("samples")
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            raise ValueError("Session name must contain 1 to 120 characters.")
        if not isinstance(samples, list) or not 1 <= len(samples) <= MAX_SAMPLES:
            raise ValueError(f"Session requires 1 to {MAX_SAMPLES} samples.")
        previous = -1.0
        for sample in samples:
            if not isinstance(sample, dict):
                raise ValueError("Every sample must be an object.")
            timestamp = sample.get("time")
            if type(timestamp) not in (int, float) or timestamp < 0 or timestamp < previous:
                raise ValueError("Sample timestamps must be nonnegative and ordered.")
            if type(sample.get("detected")) is not bool:
                raise ValueError("Every sample must have a detected boolean.")
            previous = timestamp
        # Reject NaN/Infinity anywhere, including nested landmark arrays.
        json.dumps(body, allow_nan=False)
        sid = uuid.uuid4().hex
        created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        detected = sum(s["detected"] for s in samples)
        summary = {"duration": samples[-1]["time"] - samples[0]["time"],
                   "detected_samples": detected, "sample_count": len(samples),
                   "tracking_percent": round(100 * detected / len(samples), 1)}
        body = dict(body, id=sid, name=name.strip(), created_at=created, summary=summary)
        with self.connect() as db:
            db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)",
                       (sid, body["name"], created, len(samples), json.dumps(summary),
                        json.dumps(body, allow_nan=False, separators=(",", ":"))))
        return {"id": sid, "name": body["name"], "created_at": created, "summary": summary}

    def delete(self, sid):
        with self.connect() as db:
            return db.execute("DELETE FROM sessions WHERE id=?", (sid,)).rowcount > 0


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm"}

    def __init__(self, *args, store: Store, **kwargs):
        self.store = store
        super().__init__(*args, directory=str(ROOT / "web"), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(self), microphone=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        super().end_headers()

    def permitted_host(self):
        # Prevent DNS rebinding to a local service. The server binds loopback only.
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if self.headers.get("Host", "") not in allowed:
            self.json_response(403, {"error": "Localhost access only."})
            return False
        return True

    def permit_write(self):
        if not self.permitted_host():
            return False
        host = self.headers.get("Host")
        origin = self.headers.get("Origin")
        if self.headers.get("X-FaceScope") != "1" or (origin and origin != f"http://{host}"):
            self.json_response(403, {"error": "A same-origin FaceScope request is required."})
            return False
        return True

    def json_response(self, status, data):
        payload = json.dumps(data, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if not self.permitted_host():
            return
        path = urlsplit(self.path).path
        if path == "/api/health":
            self.json_response(200, {"status": "ok", "version": "1.0.0", "local_only": True})
        elif path == "/api/sessions":
            self.json_response(200, {"sessions": self.store.list()})
        elif re.fullmatch(r"/api/sessions/[a-f0-9]{32}", path):
            data = self.store.get(path.rsplit("/", 1)[1])
            self.json_response(200 if data else 404, data or {"error": "Session not found."})
        elif path.startswith("/api/"):
            self.json_response(404, {"error": "Unknown endpoint."})
        else:
            if any(p in ("..", ".") or p.startswith(".") for p in unquote(path).split("/") if p):
                self.json_response(403, {"error": "Invalid path."})
                return
            super().do_GET()

    def do_HEAD(self):
        if self.permitted_host():
            super().do_HEAD()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_POST(self):
        if not self.permit_write():
            return
        if urlsplit(self.path).path != "/api/sessions":
            self.json_response(404, {"error": "Unknown endpoint."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                self.json_response(413, {"error": "Session body must be between 1 byte and 64 MiB."})
                return
            if self.headers.get_content_type() != "application/json":
                self.json_response(415, {"error": "Use application/json."})
                return
            self.connection.settimeout(30)
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("Incomplete request body.")
            def invalid_constant(value):
                raise ValueError(f"Non-finite JSON number: {value}")
            body = json.loads(raw, parse_constant=invalid_constant)
            self.json_response(201, self.store.create(body))
        except (ValueError, UnicodeDecodeError, RecursionError) as exc:
            self.json_response(400, {"error": str(exc)[:250]})
        except (sqlite3.Error, OSError):
            logging.exception("Unable to save session")
            self.json_response(500, {"error": "Could not save session. Check disk space and server logs."})

    def do_DELETE(self):
        if not self.permit_write():
            return
        path = urlsplit(self.path).path
        if not re.fullmatch(r"/api/sessions/[a-f0-9]{32}", path):
            self.json_response(404, {"error": "Unknown endpoint."})
            return
        ok = self.store.delete(path.rsplit("/", 1)[1])
        self.json_response(200 if ok else 404, {"deleted": ok})


def make_server(port=8765, data_dir=None):
    store = Store(Path(data_dir or ROOT / "data") / "facescope.sqlite3")
    return ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, store=store))


def main():
    parser = argparse.ArgumentParser(description="MathTech FaceScope — local face motion analysis")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        server = make_server(args.port, args.data_dir)
    except OSError as exc:
        raise SystemExit(f"Cannot start: {exc}. Try --port 8766.") from exc
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"\nMathTech FaceScope 1.0.0\n{url}\nPress Ctrl+C to stop.\n", flush=True)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
