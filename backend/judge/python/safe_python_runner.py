"""Restricted, subprocess-only Python evaluator for the local desktop build.

This is defense in depth for trusted classroom/demo code. It is not a security
boundary for hostile internet users; use an OS sandbox for that threat model.
"""

import builtins
import io
import json
import math
import signal
import sys
import traceback


MAX_OUTPUT_CHARS = 16_384
WINDOWS_JOB_HANDLE = None
ALLOWED_MODULES = {
    "bisect",
    "cmath",
    "collections",
    "decimal",
    "fractions",
    "functools",
    "heapq",
    "itertools",
    "json",
    "math",
    "operator",
    "random",
    "re",
    "statistics",
    "string",
    "typing",
}


class LimitedTextIO(io.StringIO):
    def write(self, value):
        value = str(value)
        remaining = MAX_OUTPUT_CHARS - self.tell()
        if remaining <= 0:
            return len(value)
        return super().write(value[:remaining])


def install_resource_limits():
    if sys.platform == "win32":
        install_windows_job_limits()
        return
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
    except (ImportError, OSError, ValueError):
        # Windows needs a Job Object/AppContainer for hard memory limits.
        pass


def install_windows_job_limits():
    global WINDOWS_JOB_HANDLE
    try:
        import ctypes
        from ctypes import wintypes

        class BasicLimitInformation(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_longlong),
                ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class IoCounters(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_ulonglong),
                ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong),
                ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong),
                ("OtherTransferCount", ctypes.c_ulonglong),
            ]

        class ExtendedLimitInformation(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", BasicLimitInformation),
                ("IoInfo", IoCounters),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.SetInformationJobObject.argtypes = [
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
        ]
        kernel32.SetInformationJobObject.restype = wintypes.BOOL
        kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return

        limits = ExtendedLimitInformation()
        limits.BasicLimitInformation.PerProcessUserTimeLimit = 5 * 10_000_000
        limits.BasicLimitInformation.ActiveProcessLimit = 1
        limits.BasicLimitInformation.LimitFlags = (
            0x00000002  # JOB_OBJECT_LIMIT_PROCESS_TIME
            | 0x00000008  # JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | 0x00000100  # JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | 0x00002000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        )
        limits.ProcessMemoryLimit = 256 * 1024 * 1024
        configured = kernel32.SetInformationJobObject(
            job,
            9,  # JobObjectExtendedLimitInformation
            ctypes.byref(limits),
            ctypes.sizeof(limits),
        )
        assigned = configured and kernel32.AssignProcessToJobObject(
            job,
            kernel32.GetCurrentProcess(),
        )
        if assigned:
            WINDOWS_JOB_HANDLE = job
        else:
            kernel32.CloseHandle(job)
    except (ImportError, OSError, ValueError):
        pass


def preload_allowed_modules():
    loaded = {}
    original_import = builtins.__import__
    for name in sorted(ALLOWED_MODULES):
        try:
            loaded[name] = original_import(name)
        except ImportError:
            pass
    return loaded, original_import


def make_safe_import(loaded_modules, original_import):
    def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        root = str(name).split(".", 1)[0]
        if level or root not in ALLOWED_MODULES:
            raise ImportError(f"module '{name}' is disabled in the local judge")
        if root in loaded_modules:
            return original_import(name, globals, locals, fromlist, 0)
        raise ImportError(f"module '{name}' is unavailable")

    return safe_import


def install_audit_guard():
    blocked_prefixes = (
        "ctypes.",
        "os.system",
        "os.spawn",
        "socket.",
        "subprocess.",
        "winreg.",
    )

    def audit(event, args):
        if event == "open" or event.startswith(blocked_prefixes):
            raise PermissionError(f"operation '{event}' is disabled in the local judge")

    sys.addaudithook(audit)


def safe_builtins(loaded_modules, original_import):
    allowed = dict(vars(builtins))
    for name in (
        "breakpoint",
        "compile",
        "eval",
        "exec",
        "exit",
        "help",
        "input",
        "open",
        "quit",
    ):
        allowed.pop(name, None)
    allowed["__import__"] = make_safe_import(loaded_modules, original_import)
    return allowed


def timeout_handler(signum, frame):
    raise TimeoutError("test case timed out")


def deep_equal(actual, expected):
    if isinstance(actual, float) and isinstance(expected, (int, float)):
        return math.isclose(actual, float(expected), rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(actual, list) and isinstance(expected, list):
        return len(actual) == len(expected) and all(
            deep_equal(left, right) for left, right in zip(actual, expected)
        )
    if isinstance(actual, dict) and isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(
            deep_equal(actual[key], expected[key]) for key in actual
        )
    return actual == expected


def json_safe(value):
    try:
        json.dumps(value, ensure_ascii=False)
        return value
    except (TypeError, ValueError):
        return repr(value)[:1000]


def run(payload):
    code = str(payload.get("code", ""))[:100_000]
    tests = payload.get("tests", [])[:100]
    loaded_modules, original_import = preload_allowed_modules()
    compiled = compile(code, "<student-solution>", "exec", dont_inherit=True, optimize=1)
    install_resource_limits()
    install_audit_guard()

    namespace = {
        "__builtins__": safe_builtins(loaded_modules, original_import),
        "__name__": "student_solution",
    }
    stdout = LimitedTextIO()
    stderr = LimitedTextIO()
    original_stdout, original_stderr = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = stdout, stderr
    try:
        exec(compiled, namespace, namespace)
        results = []
        has_alarm = hasattr(signal, "SIGALRM")
        if has_alarm:
            signal.signal(signal.SIGALRM, timeout_handler)
        for index, test in enumerate(tests, 1):
            try:
                function_name = str(test.get("function", "solve"))
                function = namespace.get(function_name)
                if not callable(function):
                    raise NameError(f"function '{function_name}' was not found")
                if has_alarm:
                    signal.alarm(2)
                args = test.get("args", [])
                actual = function(*args)
                if has_alarm:
                    signal.alarm(0)
                expected = test.get("expected")
                results.append({
                    "index": index,
                    "passed": deep_equal(actual, expected),
                    "input": args,
                    "args": args,
                    "actual": json_safe(actual),
                    "expected": expected,
                })
            except BaseException as error:
                if has_alarm:
                    signal.alarm(0)
                results.append({
                    "index": index,
                    "passed": False,
                    "input": test.get("args", []),
                    "args": test.get("args", []),
                    "actual": None,
                    "expected": test.get("expected"),
                    "error": f"{type(error).__name__}: {error}"[:1000],
                })
        return {
            "language": "python",
            "total": len(results),
            "passed": sum(1 for item in results if item["passed"]),
            "results": results,
            "stdout": stdout.getvalue(),
            "stderr": stderr.getvalue(),
            "sandbox": "restricted-python-subprocess",
        }
    finally:
        sys.stdout, sys.stderr = original_stdout, original_stderr


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = run(payload)
    except BaseException as error:
        result = {
            "language": "python",
            "total": 0,
            "passed": 0,
            "results": [],
            "loadError": f"{type(error).__name__}: {error}"[:1000],
            "trace": "execution stopped by the restricted runner",
            "sandbox": "restricted-python-subprocess",
        }
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
