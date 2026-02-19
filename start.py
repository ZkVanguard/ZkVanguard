#!/usr/bin/env python3
"""
ZkVanguard — Start ZKP Server + Cloudflare Tunnel
Cross-platform launcher (Windows / macOS / Linux)

Usage:  python start.py
"""

import os
import sys
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path

# ── ANSI helpers (works on Win 10+ / macOS / Linux) ─────────────────────────
CYAN    = "\033[96m"
GREEN   = "\033[92m"
YELLOW  = "\033[93m"
RED     = "\033[91m"
DCYAN   = "\033[36m"
WHITE   = "\033[97m"
RESET   = "\033[0m"

# Enable ANSI escape codes on Windows
if sys.platform == "win32":
    os.system("")  # triggers VT100 mode in cmd / powershell

ROOT = Path(__file__).resolve().parent


# ── Locate cloudflared ──────────────────────────────────────────────────────
def find_cloudflared() -> str:
    """Return the path to the cloudflared binary, or exit with a clear error."""
    # 1. On PATH?
    found = shutil.which("cloudflared")
    if found:
        return found

    # 2. Common install locations
    candidates = []
    if sys.platform == "win32":
        candidates = [
            Path(os.environ.get("ProgramFiles(x86)", ""), "cloudflared", "cloudflared.exe"),
            Path(os.environ.get("ProgramFiles", ""),      "cloudflared", "cloudflared.exe"),
            Path(os.environ.get("LOCALAPPDATA", ""),       "cloudflared", "cloudflared.exe"),
        ]
    elif sys.platform == "darwin":
        candidates = [
            Path("/usr/local/bin/cloudflared"),
            Path("/opt/homebrew/bin/cloudflared"),
        ]
    else:  # linux
        candidates = [
            Path("/usr/local/bin/cloudflared"),
            Path("/usr/bin/cloudflared"),
        ]

    for p in candidates:
        if p.is_file():
            return str(p)

    print(f"{RED}  cloudflared not found. Install it or add it to PATH.{RESET}")
    sys.exit(1)


# ── Stream reader (runs in a thread per process) ───────────────────────────
def stream_output(proc: subprocess.Popen, label: str, color: str):
    """Read lines from a subprocess and print them with a coloured prefix."""
    assert proc.stdout is not None
    for raw_line in proc.stdout:
        line = raw_line.rstrip("\n").rstrip("\r")
        if line:
            print(f"  {color}[{label}]{RESET} {line}")


# ── Main ───────────────────────────────────────────────────────────────────
def main():
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["PYTHONUNBUFFERED"]  = "1"

    cloudflared = find_cloudflared()

    print(f"\n{CYAN}  Starting ZkVanguard services...{RESET}\n")

    # Python executable — use the same interpreter running this script
    python = sys.executable

    # 1. ZKP API Server
    server_proc = subprocess.Popen(
        [python, str(ROOT / "zkp" / "api" / "server.py")],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(ROOT),
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    print(f"  {GREEN}[1/2] ZKP API server started  (PID {server_proc.pid}){RESET}")

    # 2. Cloudflare Tunnel
    tunnel_proc = subprocess.Popen(
        [cloudflared, "tunnel", "run", "enhanced-p521-zk"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(f"  {GREEN}[2/2] Cloudflare tunnel started (PID {tunnel_proc.pid}){RESET}")
    print(f"\n{YELLOW}  Both services running. Press Ctrl+C to stop.{RESET}\n")

    # Stream output from both in parallel threads
    t_server = threading.Thread(target=stream_output, args=(server_proc, "ZKP   ", WHITE),  daemon=True)
    t_tunnel = threading.Thread(target=stream_output, args=(tunnel_proc, "TUNNEL", DCYAN),  daemon=True)
    t_server.start()
    t_tunnel.start()

    # Wait until either process exits or Ctrl+C
    try:
        while True:
            if server_proc.poll() is not None:
                print(f"\n{RED}  ZKP server exited (code {server_proc.returncode}).{RESET}")
                break
            if tunnel_proc.poll() is not None:
                print(f"\n{RED}  Cloudflare tunnel exited (code {tunnel_proc.returncode}).{RESET}")
                break
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        print(f"\n{YELLOW}  Shutting down...{RESET}")
        for label, proc in [("ZKP server", server_proc), ("Cloudflare tunnel", tunnel_proc)]:
            if proc.poll() is None:
                # Graceful termination first
                if sys.platform == "win32":
                    proc.terminate()
                else:
                    proc.send_signal(signal.SIGTERM)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        print(f"  {GREEN}All services stopped.{RESET}\n")


if __name__ == "__main__":
    main()
