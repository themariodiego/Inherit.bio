"""One public READY/frame handoff. subprocess.PIPE is a real anonymous FIFO.

The outer launcher owns the process group and its unchanged 2880/5s bounds.
No alternative command or provider is accepted by this entrypoint.
"""
import base64
import json
import os
import selectors
import signal
import subprocess
import sys
import time


def handoff(command, nonce):
    if os.getpgrp() != os.getpid():
        raise ValueError("group-refused")
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=sys.stdout.buffer,
                             stderr=subprocess.PIPE, close_fds=True)
    completed = False
    whole_deadline = time.monotonic() + 2700
    try:
        selector = selectors.DefaultSelector()
        selector.register(child.stderr, selectors.EVENT_READ)
        deadline = time.monotonic() + 10
        ready = bytearray()
        while b"\n" not in ready:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise ValueError("ready-refused")
            chunk = os.read(child.stderr.fileno(), 1)
            if not chunk or len(ready) >= 1024:
                raise ValueError("ready-refused")
            ready.extend(chunk)
        if ready != ("OWNED_LINUX_READY:" + nonce + "\n").encode():
            raise ValueError("ready-refused")
        sys.stderr.buffer.write(ready)
        sys.stderr.buffer.flush()
        selector.unregister(child.stderr)
        selector.register(sys.stdin.buffer, selectors.EVENT_READ)
        deadline = time.monotonic() + 10
        frame = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise ValueError("input-refused")
            chunk = os.read(sys.stdin.fileno(), 4096)
            if not chunk:
                break
            frame.extend(chunk)
            if len(frame) > 65536:
                raise ValueError("input-refused")
        if not frame or not frame.endswith(b"\n"):
            raise ValueError("input-refused")
        child.stdin.write(frame)
        child.stdin.close()
        selector.unregister(sys.stdin.buffer)
        selector.register(child.stderr, selectors.EVENT_READ)
        while True:
            remaining = whole_deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError("whole-refused")
            if not selector.select(min(1, remaining)):
                continue
            chunk = os.read(child.stderr.fileno(), 4096)
            if not chunk:
                break
            sys.stderr.buffer.write(chunk)
            sys.stderr.buffer.flush()
        selector.close()
        result = child.wait(timeout=max(0.001, whole_deadline - time.monotonic()))
        completed = result == 0
        return result
    finally:
        if not completed:
            # Foreground timeout leaves every descendant in this owned PGID.
            # Do not leave a stderr-holding descendant alive after refusal.
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            os.killpg(os.getpgrp(), signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            finally:
                os.killpg(os.getpgrp(), signal.SIGKILL)


def main():
    if len(sys.argv) != 3:
        raise ValueError("arguments-refused")
    node, encoded = sys.argv[1:]
    owner = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    if not os.path.isabs(node) or os.path.realpath(os.getcwd()) != owner["root"]:
        raise ValueError("source-refused")
    return handoff(["timeout", "--foreground", "--signal=TERM", "--kill-after=5s", "2700", node, "--import", "tsx", "scripts/comprehension/run-owned-linux.mts",
                    "--owner", encoded, "--prepare"], owner["nonce"])


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Hosted owned public pipe refused", file=sys.stderr)
        sys.exit(1)
