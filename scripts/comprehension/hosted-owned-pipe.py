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


def emit_closed_failure(stage, result=None):
    """Public terminal metadata before group cleanup; never private output.

    This diagnostic cannot qualify a run or describe cleanup as complete.
    A failed diagnostic write must preserve the original failure and cleanup.
    """
    stages = {"bridge-ready", "bridge-input", "bridge-forward", "bridge-wait",
              "bridge-whole", "bridge-inner-terminal", "bridge-setup"}
    try:
        if stage not in stages:
            return
        if result is not None and type(result) is not int:
            return
        code, name = None, None
        classification = "setup-refused"
        if type(result) is int:
            if 1 <= result <= 255:
                code, classification = result, "exit-nonzero"
            elif -64 <= result < 0:
                allowed = {"SIGABRT", "SIGALRM", "SIGBUS", "SIGHUP", "SIGINT",
                           "SIGKILL", "SIGPIPE", "SIGQUIT", "SIGSEGV", "SIGTERM",
                           "SIGXCPU", "SIGXFSZ"}
                name = signal.Signals(-result).name
                if name not in allowed:
                    return
                classification = "signal"
            else:
                return
        # The inner stderr may end mid-line. End that discarded private frame
        # before starting this independent, bounded public physical frame.
        line = "\nOWNED_BOOTSTRAP_FAILURE_V1|" + json.dumps({
            "stage": stage, "classification": classification,
            "exitCode": code, "signal": name, "cleanup": "uncertain"},
            separators=(",", ":")) + "\n"
        data = line.encode("ascii")
        if len(data) > 512:
            return
        sys.stderr.buffer.write(data)
        sys.stderr.buffer.flush()
    except Exception:
        pass


def handoff(command, nonce):
    if os.getpgrp() != os.getpid():
        raise ValueError("group-refused")
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=sys.stdout.buffer,
                             stderr=subprocess.PIPE, close_fds=True)
    completed = False
    whole_deadline = time.monotonic() + 2700
    stage = "bridge-ready"
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
        stage = "bridge-input"
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
        stage = "bridge-forward"
        while True:
            remaining = whole_deadline - time.monotonic()
            if remaining <= 0:
                stage = "bridge-whole"
                raise ValueError("whole-refused")
            if not selector.select(min(1, remaining)):
                continue
            chunk = os.read(child.stderr.fileno(), 4096)
            if not chunk:
                break
            sys.stderr.buffer.write(chunk)
            sys.stderr.buffer.flush()
        selector.close()
        stage = "bridge-wait"
        result = child.wait(timeout=max(0.001, whole_deadline - time.monotonic()))
        if result != 0:
            emit_closed_failure("bridge-inner-terminal", result)
        completed = result == 0
        return result
    except BaseException:
        emit_closed_failure(stage)
        raise
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
        emit_closed_failure("bridge-setup")
        print("Hosted owned public pipe refused", file=sys.stderr)
        sys.exit(1)
