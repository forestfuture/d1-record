# Drives a command in a pseudo-terminal as a person at a terminal would, with the standard library
# only. Takes one JSON argument: {"cwd", "argv", "steps"}; prints one JSON object: {"transcript",
# "exitCode", "failed"}. Steps run in order:
#   {"expect": text, "timeout": seconds}  wait until the output so far contains text
#   {"send": text, "typing": seconds}     write text, a character at a time when typing is set
#   {"wait": seconds}                     keep reading for a while
#   {"exit": seconds}                     wait for the command to end
import json
import os
import pty
import select
import signal
import sys
import time

spec = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    os.chdir(spec["cwd"])
    os.environ["TERM"] = "xterm-256color"
    os.execvp(spec["argv"][0], spec["argv"])

transcript = b""
status = None


def pump(seconds):
    """Reads whatever the command prints for up to `seconds`."""
    global transcript
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if not ready:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            return
        if not data:
            return
        transcript += data


def exited():
    """The exit code if the command has ended, else None."""
    global status
    if status is None:
        done, raw = os.waitpid(pid, os.WNOHANG)
        if done:
            status = os.waitstatus_to_exitcode(raw)
    return status


failed = None
for index, step in enumerate(spec["steps"]):
    if "expect" in step:
        end = time.time() + step.get("timeout", 30)
        while step["expect"].encode() not in transcript and time.time() < end and exited() is None:
            pump(0.1)
        if step["expect"].encode() not in transcript:
            failed = "expect %r (step %d)" % (step["expect"], index)
            break
    elif "send" in step:
        typing = step.get("typing", 0)
        pieces = list(step["send"]) if typing else [step["send"]]
        for piece in pieces:
            os.write(fd, piece.encode())
            pump(typing or 0.02)
    elif "wait" in step:
        pump(step["wait"])
    elif "exit" in step:
        end = time.time() + step["exit"]
        while exited() is None and time.time() < end:
            pump(0.1)
        if exited() is None:
            failed = "exit (step %d)" % index
            break

pump(0.2)
if exited() is None:
    os.kill(pid, signal.SIGTERM)
    time.sleep(0.2)
    exited()
print(json.dumps({"transcript": transcript.decode("utf8", "replace"), "exitCode": status, "failed": failed}))
