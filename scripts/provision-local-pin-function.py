#!/usr/bin/env python3
"""Write owner-only local Edge Function secrets from the pre-provisioned test account."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys


LOCAL_API = "http://127.0.0.1:55321"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
CREDENTIAL_FILE = Path("/tmp/our-dairy-farm/local-auth.json")
ENV_FILE = PROJECT_ROOT / "supabase/functions/.env"


def main():
    result = subprocess.run(
        ["supabase", "status", "--output", "env"], check=True, capture_output=True, text=True
    )
    env = {
        key: value.strip().strip('"')
        for key, value in (line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    }
    if env.get("API_URL") != LOCAL_API or not env.get("ANON_KEY"):
        raise SystemExit("Refusing to configure PIN login: the isolated local Supabase URL was not confirmed.")
    if not CREDENTIAL_FILE.is_file() or CREDENTIAL_FILE.stat().st_mode & 0o077:
        raise SystemExit("Local test credentials are missing or are not owner-only. Run the local account provisioning helper first.")
    try:
        account = json.loads(CREDENTIAL_FILE.read_text(encoding="utf-8"))
        email, password = account["email"], account["password"]
    except (OSError, KeyError, ValueError, TypeError) as error:
        raise SystemExit("Local test account credentials could not be read safely.") from error

    pin = os.environ.get("DAIRY_FARM_LOCAL_PIN", "246810")
    if not pin.isascii() or not pin.isdigit() or len(pin) != 6:
        raise SystemExit("DAIRY_FARM_LOCAL_PIN must be exactly six ASCII digits.")
    pin_pepper = secrets.token_urlsafe(32)
    rate_pepper = secrets.token_urlsafe(32)
    pin_hash = hmac.new(pin_pepper.encode(), pin.encode(), hashlib.sha256).hexdigest()
    values = {
        "FARM_PIN_HASH": pin_hash,
        "FARM_PIN_PEPPER": pin_pepper,
        "FARM_PIN_RATE_PEPPER": rate_pepper,
        "FARM_AUTH_EMAIL": email,
        "FARM_AUTH_PASSWORD": password,
        "FARM_PIN_ALLOWED_ORIGINS": "",
        "FARM_PIN_ALLOW_LOCAL_ORIGINS": "true",
    }
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = ENV_FILE.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write("# Local-only generated secrets. Do not commit or copy to production.\n")
        for key, value in values.items():
            output.write(f"{key}={value}\n")
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, ENV_FILE)
    os.chmod(ENV_FILE, 0o600)
    print("Local farm PIN Edge Function secrets prepared with owner-only permissions.")
    print("PIN: local development PIN is configured; no PIN or account password is printed.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.stderr or "Could not verify local Supabase status.", file=sys.stderr)
        raise SystemExit(error.returncode)
