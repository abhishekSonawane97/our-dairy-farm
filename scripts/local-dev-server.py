#!/usr/bin/env python3
"""Serve the app statically for local development; PIN verification runs in Supabase Edge Functions."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]


class FarmHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def send_head(self):
        original_modified = self.headers.get("If-Modified-Since")
        if original_modified:
            del self.headers["If-Modified-Since"]
        try:
            return super().send_head()
        finally:
            if original_modified:
                self.headers["If-Modified-Since"] = original_modified


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
