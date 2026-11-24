#!/usr/bin/env python3
"""Provision the isolated local Supabase Auth account used by local PIN sign-in."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import urllib.error
import urllib.request


LOCAL_API = "http://127.0.0.1:55321"
CREDENTIAL_FILE = Path("/tmp/our-dairy-farm/local-auth.json")


def local_environment():
    result = subprocess.run(
        ["supabase", "status", "--output", "env"],
        check=True,
        capture_output=True,
        text=True,
    )
    return {
        key: value.strip().strip('"')
        for key, value in (line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    }


def request_json(url, *, method="GET", payload=None, api_key, bearer=None):
    body = None if payload is None else json.dumps(payload).encode()
    headers = {"apikey": api_key, "Accept": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=10) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def account_is_ready(api_url, anon_key, credentials):
    try:
        session = request_json(
            f"{api_url}/auth/v1/token?grant_type=password",
            method="POST",
            payload={"email": credentials["email"], "password": credentials["password"]},
            api_key=anon_key,
        )
        return session.get("user", {}).get("app_metadata", {}).get("farm_access") is True
    except (KeyError, OSError, ValueError, urllib.error.HTTPError):
        return False


def write_credentials(credentials):
    CREDENTIAL_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(CREDENTIAL_FILE.parent, 0o700)
    temporary = CREDENTIAL_FILE.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(credentials, output)
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, CREDENTIAL_FILE)


def main():
    env = local_environment()
    api_url = env.get("API_URL")
    admin_key = env.get("SERVICE_ROLE_KEY")
    anon_key = env.get("ANON_KEY")
    if api_url != LOCAL_API or not admin_key or not anon_key:
        raise SystemExit("Refusing to provision: the isolated local Supabase URL was not confirmed.")

    if CREDENTIAL_FILE.exists():
        try:
            existing = json.loads(CREDENTIAL_FILE.read_text(encoding="utf-8"))
            if account_is_ready(api_url, anon_key, existing):
                print("The existing local PIN sign-in account is ready.")
                return
        except (OSError, ValueError):
            pass

    email = f"milk-review-{secrets.token_hex(4)}@local.test"
    password = secrets.token_urlsafe(24)
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "app_metadata": {"farm_access": True},
    }
    try:
        user = request_json(
            f"{api_url}/auth/v1/admin/users",
            method="POST",
            payload=payload,
            api_key=admin_key,
            bearer=admin_key,
        )
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Local Auth account creation failed (HTTP {error.code}).") from error

    if user.get("app_metadata", {}).get("farm_access") is not True:
        raise SystemExit("Local Auth did not create an account with the trusted farm access claim.")
    write_credentials({"email": email, "password": password})
    print("The local PIN sign-in account is ready. Enter PIN 246810 in the local app.")
    print("Its random login credential is stored outside the web folder with owner-only permissions.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.stderr or "Could not read local Supabase status.", file=sys.stderr)
        raise SystemExit(error.returncode)
