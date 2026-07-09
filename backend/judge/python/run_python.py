import importlib.util
import json
import math
import os
import signal
import sys
import tempfile
import traceback


def timeout_handler(signum, frame):
    raise TimeoutError("单个测试用例运行超时")


def deep_equal(actual, expected):
    if isinstance(actual, float) and isinstance(expected, (int, float)):
        return math.isclose(actual, float(expected), rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(actual, list) and isinstance(expected, list):
        return len(actual) == len(expected) and all(deep_equal(a, b) for a, b in zip(actual, expected))
    return actual == expected


def load_solution(code):
    workdir = tempfile.mkdtemp(prefix="judge-")
    solution_path = os.path.join(workdir, "solution.py")
    with open(solution_path, "w", encoding="utf-8") as file:
        file.write(code)

    spec = importlib.util.spec_from_file_location("solution", solution_path)
    solution = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(solution)
    return solution


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    code = payload.get("code", "")
    tests = payload.get("tests", [])
    result = {"total": len(tests), "passed": 0, "results": []}

    try:
        solution = load_solution(code)
    except Exception as exc:
        result["loadError"] = str(exc)
        result["trace"] = traceback.format_exc(limit=2)
        print(json.dumps(result, ensure_ascii=False))
        return

    signal.signal(signal.SIGALRM, timeout_handler)
    for index, test in enumerate(tests, 1):
        name = test.get("function", "solve")
        args = test.get("args", [])
        expected = test.get("expected")
        try:
            fn = getattr(solution, name)
            signal.alarm(2)
            actual = fn(*args)
            signal.alarm(0)
            ok = deep_equal(actual, expected)
            result["passed"] += 1 if ok else 0
            result["results"].append({
                "index": index,
                "passed": ok,
                "actual": actual,
                "expected": expected
            })
        except Exception as exc:
            signal.alarm(0)
            result["results"].append({
                "index": index,
                "passed": False,
                "error": str(exc)
            })

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
