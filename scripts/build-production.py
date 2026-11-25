#!/usr/bin/env python3
"""Build an allowlisted Cloudflare Pages artifact with explicit production config."""

from __future__ import annotations

import ipaddress
import json
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist"
LOCAL_AUTH_SCRIPT = re.compile(
    r"\s*<script\b[^>]*\bsrc=[\"']js/local-auth\.js(?:\?[^\"']*)?[\"'][^>]*></script>",
    re.IGNORECASE,
)
LOCAL_AUTH_CONTAINER = re.compile(r"\s*<div\b[^>]*\bid=[\"']local-auth-controls[\"'][^>]*>\s*</div>", re.IGNORECASE)
ALLOWED_OUTPUT_FILES = {
    "index.html",
    "css/style.css",
    "js/supabase-config.js",
    "js/database.js",
    "js/pin-auth.js",
    "js/milk-calculations.js",
    "js/milk-repository.js",
    "js/backup-restore.js",
    "js/app.js",
    "assets/images/cow.png",
    "_headers",
}


def required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Set {name} explicitly to build production output.")
    return value


def production_url(value: str) -> tuple[str, str]:
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise SystemExit("SUPABASE_URL must be an HTTPS project origin with no path, query, or fragment.")
    hostname = parsed.hostname.lower()
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".localhost"):
        raise SystemExit("A localhost URL cannot be used for a production build.")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address and (address.is_private or address.is_loopback or address.is_link_local or address.is_unspecified):
        raise SystemExit("A private or loopback address cannot be used for a production build.")
    origin = f"https://{parsed.netloc}"
    return origin, origin


def prepare_output() -> None:
    if OUTPUT.is_symlink():
        raise SystemExit("Refusing to build into a symlinked dist directory.")
    if OUTPUT.exists():
        if not OUTPUT.is_dir():
            raise SystemExit("dist exists and is not a directory.")
        allowed_top_level = {"index.html", "css", "js", "assets", "_headers"}
        unexpected = {entry.name for entry in OUTPUT.iterdir()} - allowed_top_level
        if unexpected:
            raise SystemExit(f"Refusing to remove unexpected dist entries: {', '.join(sorted(unexpected))}")
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)


def copy_file(relative: str) -> None:
    source = ROOT / relative
    destination = OUTPUT / relative
    if not source.is_file():
        raise SystemExit(f"Required production source is missing: {relative}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def write_runtime_config(origin: str, project_url: str, publishable_key: str) -> None:
    runtime = {
        "environment": "production",
        "localDevelopment": False,
        "productionAuthConfigured": False,
        "projectUrl": project_url,
        "publishableKey": publishable_key,
    }
    config_js = "window.DairySupabaseConfig = Object.freeze(" + json.dumps(runtime, separators=(",", ":")) + ");\n"
    config_path = OUTPUT / "js/supabase-config.js"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(config_js, encoding="utf-8")

    headers = f"""/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' {origin}
  Cache-Control: no-cache

/css/*
  Cache-Control: public, max-age=604800

/js/*
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=604800
"""
    (OUTPUT / "_headers").write_text(headers, encoding="utf-8")


def main() -> None:
    project_url = required_environment("SUPABASE_URL").rstrip("/")
    _, origin = production_url(project_url)
    publishable_key = required_environment("SUPABASE_PUBLISHABLE_KEY")
    lowered_key = publishable_key.lower()
    if not publishable_key.startswith("sb_publishable_"):
        raise SystemExit("SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key.")
    if "secret" in lowered_key or "service_role" in lowered_key:
        raise SystemExit("Secret/service-role credentials are forbidden in browser configuration.")

    prepare_output()
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html, removed = LOCAL_AUTH_SCRIPT.subn("", html)
    if removed != 1:
        raise SystemExit("Expected exactly one local-auth.js script tag in index.html.")
    html, controls_removed = LOCAL_AUTH_CONTAINER.subn("", html)
    if controls_removed != 1:
        raise SystemExit("Expected exactly one local-auth-controls container in index.html.")
    if "sample-data.js" in html or "246810" in html:
        raise SystemExit("Development sample data or PIN text must not be embedded in production HTML.")
    (OUTPUT / "index.html").write_text(html, encoding="utf-8")

    for relative in sorted(ALLOWED_OUTPUT_FILES - {"index.html", "js/supabase-config.js", "_headers"}):
        copy_file(relative)
    write_runtime_config(origin, project_url, publishable_key)

    actual = {
        item.relative_to(OUTPUT).as_posix()
        for item in OUTPUT.rglob("*")
        if item.is_file()
    }
    unexpected = actual - ALLOWED_OUTPUT_FILES
    missing = ALLOWED_OUTPUT_FILES - actual
    if unexpected or missing:
        raise SystemExit(f"Production output allowlist mismatch. Unexpected={sorted(unexpected)} missing={sorted(missing)}")

    print(f"Production output created at {OUTPUT}")
    print(f"Included {len(actual)} allowlisted files; production authentication remains disabled.")


if __name__ == "__main__":
    try:
        main()
    except OSError as error:
        print(f"Production build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
