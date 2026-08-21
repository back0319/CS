import json
import os
import selectors
import signal
import subprocess
import sys
import time


TIME_LIMIT_SECONDS = 3
OUTPUT_LIMIT_BYTES = 64 * 1024
READ_CHUNK_BYTES = 8 * 1024


def emit(outcome, started, stdout=b"", stderr=b""):
    payload = {
        "outcome": outcome,
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
        "execution_time": round((time.perf_counter() - started) * 1000, 2),
    }
    print(json.dumps(payload, ensure_ascii=False))


def kill_process_group(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            process.kill()
        except ProcessLookupError:
            pass


def execute_solution():
    started = time.perf_counter()
    with open("input.txt", "rb") as input_file:
        process = subprocess.Popen(
            [sys.executable, "solution.py"],
            stdin=input_file,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )

    selector = selectors.DefaultSelector()
    streams = {"stdout": bytearray(), "stderr": bytearray()}
    assert process.stdout is not None
    assert process.stderr is not None
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    outcome = None

    try:
        while selector.get_map():
            remaining = TIME_LIMIT_SECONDS - (time.perf_counter() - started)
            if remaining <= 0:
                outcome = "TIMED_OUT"
                kill_process_group(process)
                break

            for key, _ in selector.select(timeout=min(0.05, remaining)):
                chunk = os.read(key.fd, READ_CHUNK_BYTES)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue

                stream = streams[key.data]
                stream.extend(chunk)
                if len(stream) > OUTPUT_LIMIT_BYTES:
                    outcome = "OUTPUT_LIMIT"
                    kill_process_group(process)
                    break

            if outcome:
                break

        process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        outcome = outcome or "TIMED_OUT"
        kill_process_group(process)
        process.wait()
    finally:
        selector.close()

    if outcome == "OUTPUT_LIMIT":
        return outcome, b"", b""
    if outcome == "TIMED_OUT":
        return outcome, b"", b""
    if process.returncode != 0:
        return "RUNTIME_ERROR", bytes(streams["stdout"]), bytes(streams["stderr"])
    return "OK", bytes(streams["stdout"]), bytes(streams["stderr"])


def main():
    started = time.perf_counter()
    try:
        with open("solution.py", "r", encoding="utf-8") as source_file:
            source = source_file.read()
        compile(source, "solution.py", "exec")
    except SyntaxError as error:
        message = f"{error.__class__.__name__}: {error.msg} (line {error.lineno})"
        emit("COMPILE_ERROR", started, stderr=message.encode("utf-8"))
        return

    try:
        outcome, stdout, stderr = execute_solution()
        emit(outcome, started, stdout=stdout, stderr=stderr)
    except Exception:
        emit("RUNTIME_ERROR", started)


if __name__ == "__main__":
    main()
