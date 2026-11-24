#!/usr/bin/env python3
"""Serve the static app and a local-only PIN-to-Supabase-session exchange."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import hmac
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
CREDENTIAL_FILE = Path("/tmp/our-dairy-farm/local-auth.json")
LOCAL_API = "http://127.0.0.1:55321"
MAX_BODY_BYTES = 4096


def local_supabase_config():
    result = subprocess.run(
        ["supabase", "status", "--output", "env"],
        check=True,
        capture_output=True,
        text=True,
    )
    env = {
        key: value.strip().strip('"')
        for key, value in (line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    }
    if env.get("API_URL") != LOCAL_API or not env.get("ANON_KEY"):
        raise RuntimeError("The isolated local Supabase stack was not confirmed.")
    return env["ANON_KEY"]


def is_private_host(host):
    name = host.rsplit(":", 1)[0].strip("[]").lower()
    if name in {"localhost", "127.0.0.1", "0.0.0.0"}:
        return True
    try:
        return ipaddress.ip_address(name).is_private
    except ValueError:
        return False


class FarmHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # This server is only for development; never let a browser keep stale
        # app code or styles after a local change/restart.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def send_head(self):
        # Local file timestamp resolution and client clocks can make a modified
        # asset look unchanged to SimpleHTTPRequestHandler's 304 check.
        original_modified = self.headers.get("If-Modified-Since")
        if original_modified:
            del self.headers["If-Modified-Since"]
        try:
            return super().send_head()
        finally:
            if original_modified:
                self.headers["If-Modified-Since"] = original_modified

    def send_json(self, status, payload):
        encoded = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        origin = self.allowed_local_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(encoded)

    def allowed_local_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return None
        parsed = urlparse(origin)
        request_host = self.headers.get("Host", "").rsplit(":", 1)[0].strip("[]").lower()
        origin_host = (parsed.hostname or "").lower()
        same_machine_loopback = {"localhost", "127.0.0.1", "0.0.0.0"}
        same_host = origin_host == request_host or (
            origin_host in same_machine_loopback and request_host in same_machine_loopback
        )
        # The frontend may be served by VS Code Live Server or any other
        # local development server port. Keep this limited to HTTP origins on
        # the same local host so hosted/remote sites cannot receive sessions.
        if parsed.scheme == "http" and same_host:
            return origin
        return None

    def do_OPTIONS(self):
        if self.path.split("?", 1)[0] != "/__local_auth/pin" or not is_private_host(self.headers.get("Host", "")):
            self.send_response(403)
            self.end_headers()
            return
        origin = self.allowed_local_origin()
        if not origin:
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
        self.send_header("Access-Control-Max-Age", "300")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/__local_auth/pin":
            self.send_json(404, {"error": "Not found."})
            return
        host = self.headers.get("Host", "")
        if not is_private_host(host):
            self.send_json(403, {"error": "Local PIN sign-in is available only on localhost or a private LAN."})
            return
        origin = self.headers.get("Origin")
        cors_origin = self.allowed_local_origin()
        if origin and not cors_origin:
            self.send_json(403, {"error": "PIN sign-in request origin did not match this local app."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(400, {"error": "Invalid PIN request."})
            return
        try:
            request = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "Invalid PIN request."})
            return

        supplied_pin = request.get("pin") if isinstance(request, dict) else None
        expected_pin = os.environ.get("DAIRY_FARM_LOCAL_PIN", "246810")
        if not isinstance(supplied_pin, str) or not hmac.compare_digest(supplied_pin, expected_pin):
            self.send_json(401, {"error": "Incorrect PIN. No session was created."})
            return
        if not CREDENTIAL_FILE.exists():
            self.send_json(503, {"error": "Local PIN sign-in is not provisioned. Run the local account provisioning helper."})
            return
        if CREDENTIAL_FILE.stat().st_mode & 0o077:
            self.send_json(503, {"error": "Local Auth credentials must have owner-only file permissions."})
            return

        try:
            credentials = json.loads(CREDENTIAL_FILE.read_text(encoding="utf-8"))
            anon_key = local_supabase_config()
            body = json.dumps({"email": credentials["email"], "password": credentials["password"]}).encode()
            auth_request = Request(
                f"{LOCAL_API}/auth/v1/token?grant_type=password",
                data=body,
                method="POST",
                headers={
                    "apikey": anon_key,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
            )
            with urlopen(auth_request, timeout=10) as response:
                session = json.load(response)
        except (OSError, KeyError, ValueError, subprocess.CalledProcessError, URLError, HTTPError):
            self.send_json(503, {"error": "Local Supabase sign-in failed. Check that local Supabase is running and provision the local account again."})
            return

        if session.get("user", {}).get("app_metadata", {}).get("farm_access") is not True:
            self.send_json(403, {"error": "The local Auth account is missing its trusted farm access claim."})
            return
        self.send_json(200, {
            "access_token": session["access_token"],
            "refresh_token": session["refresh_token"],
            "expires_in": session.get("expires_in"),
            "token_type": session.get("token_type", "bearer"),
            "user": session["user"],
        })


def main():
    bind = "0.0.0.0" if "--lan" in sys.argv[1:] else "127.0.0.1"
    server = ThreadingHTTPServer((bind, 8001), FarmHandler)
    server.daemon_threads = True
    print(f"Serving Our Dairy Farm at http://{bind}:8001 (local development only)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
