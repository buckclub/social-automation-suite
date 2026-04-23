"""
Dev-loop supervisor for Reddit-to-Reels.

Runs run_server.py as a child *in its own Windows process group* so Ctrl+C
in this console only reaches the supervisor. The supervisor then:
  - forwards CTRL_BREAK_EVENT to the child (uvicorn shuts down cleanly)
  - loops and relaunches the server
  - exits only on a second Ctrl+C within 2 seconds

Why this and not start.ps1 / trap handlers:
  Windows broadcasts CTRL_C_EVENT to every process attached to the console,
  so a native child (python.exe) and a PowerShell script both receive it at
  once and PS tears down the pipeline regardless of its CancelKeyPress
  handler. Using CREATE_NEW_PROCESS_GROUP on the child cuts that broadcast
  and lets us decide what to do when the user presses Ctrl+C.
"""
from __future__ import annotations
import os
import signal
import subprocess
import sys
import time

HERE      = os.path.dirname(os.path.abspath(__file__))
RUN       = os.path.join(HERE, "run_server.py")
VENV_PY   = os.path.join(HERE, ".venv", "Scripts", "python.exe")
PORT      = 8000

# Ctrl+C double-tap window.
DOUBLE_TAP_SECS = 2.0
# Extra pause after a quick crash so stderr is visible before the relaunch spam.
QUICK_CRASH_PAUSE = 4.0
NORMAL_RESTART_PAUSE = 0.4


def _spawn_server() -> subprocess.Popen:
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    # Anything else inherits stdin/stdout/stderr so the user sees uvicorn output.
    python = VENV_PY if os.path.isfile(VENV_PY) else sys.executable
    return subprocess.Popen([python, RUN], cwd=HERE, **kwargs)


def _stop_server(proc: subprocess.Popen, grace: float = 5.0) -> None:
    """Ask the server to shut down cleanly, then kill if it doesn't."""
    if proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            # CTRL_BREAK_EVENT is the only signal deliverable to a child in a
            # different process group on Windows. uvicorn catches SIGBREAK.
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            proc.send_signal(signal.SIGINT)
    except Exception:
        pass
    try:
        proc.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def main() -> None:
    if not os.path.isfile(RUN):
        print(f"Could not find {RUN}", file=sys.stderr)
        sys.exit(1)
    if not os.path.isfile(VENV_PY):
        print(f"Warning: venv python not at {VENV_PY}. Falling back to {sys.executable}.")

    print("")
    print("Reddit-to-Reels dev loop")
    print("  Ctrl+C     -> restart server")
    print("  Ctrl+C x2  -> exit (within 2 seconds)")
    print("")

    last_break = 0.0

    while True:
        started = time.monotonic()
        print(f"> Starting server on http://localhost:{PORT} ...")
        try:
            proc = _spawn_server()
        except FileNotFoundError as e:
            print(f"Could not launch python: {e}", file=sys.stderr)
            sys.exit(1)

        # POLL the child — a blocking proc.wait() on Windows swallows SIGINT
        # until the child exits, so Ctrl+C wouldn't be seen by the supervisor.
        exit_code = None
        got_ctrl_c = False
        try:
            while True:
                try:
                    rc = proc.poll()
                except Exception:
                    rc = None
                if rc is not None:
                    exit_code = rc
                    break
                try:
                    time.sleep(0.1)
                except KeyboardInterrupt:
                    got_ctrl_c = True
                    break
        except KeyboardInterrupt:
            got_ctrl_c = True

        if got_ctrl_c:
            now = time.monotonic()
            double_tap = (now - last_break) < DOUBLE_TAP_SECS
            last_break = now
            print("")
            if double_tap:
                print("< Exiting.")
                _stop_server(proc, grace=3.0)
                return
            print(". Restarting server ...")
            _stop_server(proc, grace=5.0)
            try:
                time.sleep(0.3)
            except KeyboardInterrupt:
                return
        else:
            elapsed = time.monotonic() - started
            pause = QUICK_CRASH_PAUSE if elapsed < 2 else NORMAL_RESTART_PAUSE
            print(f"< Server exited (code={exit_code}, ran {elapsed:.1f}s). "
                  f"Restarting in {pause:.1f}s (Ctrl+C to exit)...")
            try:
                time.sleep(pause)
            except KeyboardInterrupt:
                return


if __name__ == "__main__":
    # Ignore stray SIGBREAK in the supervisor itself — only the child needs it.
    if sys.platform == "win32":
        try:
            signal.signal(signal.SIGBREAK, signal.SIG_IGN)
        except Exception:
            pass
    try:
        main()
    except KeyboardInterrupt:
        pass
