import importlib.util
import json
import math
import os
import signal
import subprocess
import sys
import tempfile
import textwrap
import traceback


def timeout_handler(signum, frame):
    raise TimeoutError("单个测试用例运行超时")


def deep_equal(actual, expected):
    if isinstance(actual, float) and isinstance(expected, (int, float)):
        return math.isclose(actual, float(expected), rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(actual, list) and isinstance(expected, list):
        return len(actual) == len(expected) and all(deep_equal(a, b) for a, b in zip(actual, expected))
    return actual == expected


def run_command(args, cwd, stdin=None, timeout=5):
    completed = subprocess.run(
        args,
        cwd=cwd,
        input=stdin,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or f"exit {completed.returncode}").strip())
    return completed.stdout


def run_python(code, tests, workdir):
    solution_path = os.path.join(workdir, "solution.py")
    with open(solution_path, "w", encoding="utf-8") as file:
        file.write(code)

    spec = importlib.util.spec_from_file_location("solution", solution_path)
    solution = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(solution)

    has_alarm = hasattr(signal, "SIGALRM")
    if has_alarm:
        signal.signal(signal.SIGALRM, timeout_handler)
    results = []
    for index, test in enumerate(tests, 1):
        try:
            fn = getattr(solution, test.get("function", "solve"))
            if has_alarm:
                signal.alarm(2)
            actual = fn(*test.get("args", []))
            if has_alarm:
                signal.alarm(0)
            results.append(make_result(index, actual, test.get("expected")))
        except Exception as exc:
            if has_alarm:
                signal.alarm(0)
            results.append({"index": index, "passed": False, "error": str(exc)})
    return results


def run_javascript(code, tests, workdir):
    solution_path = os.path.join(workdir, "solution.js")
    runner_path = os.path.join(workdir, "runner.js")
    with open(solution_path, "w", encoding="utf-8") as file:
        file.write(code)
    with open(runner_path, "w", encoding="utf-8") as file:
        file.write(textwrap.dedent("""
            const fs = require("fs");
            const solution = require("./solution.js");
            const tests = JSON.parse(fs.readFileSync(0, "utf8"));
            const results = [];
            for (let i = 0; i < tests.length; i += 1) {
              const test = tests[i];
              try {
                const fn = solution[test.function || "solve"] || global[test.function || "solve"];
                if (typeof fn !== "function") throw new Error("找不到函数 " + (test.function || "solve"));
                const actual = fn(...(test.args || []));
                const passed = JSON.stringify(actual) === JSON.stringify(test.expected);
                results.push({ index: i + 1, passed, actual, expected: test.expected });
              } catch (error) {
                results.push({ index: i + 1, passed: false, error: String(error.message || error) });
              }
            }
            console.log(JSON.stringify(results));
        """))
    stdout = run_command(["node", runner_path], workdir, stdin=json.dumps(tests, ensure_ascii=False), timeout=5)
    return json.loads(stdout)


def run_cpp(code, tests, workdir):
    source_path = os.path.join(workdir, "solution.cpp")
    runner_path = os.path.join(workdir, "runner.cpp")
    binary_path = os.path.join(workdir, "runner")
    with open(source_path, "w", encoding="utf-8") as file:
        file.write(code)
    with open(runner_path, "w", encoding="utf-8") as file:
        file.write(build_cpp_runner(tests))
    run_command(["g++", "-std=c++17", "-O2", "-pipe", runner_path, "-o", binary_path], workdir, timeout=8)
    stdout = run_command([binary_path], workdir, timeout=5)
    return json.loads(stdout)


def run_java(code, tests, workdir):
    solution_path = os.path.join(workdir, "Solution.java")
    runner_path = os.path.join(workdir, "Main.java")
    with open(solution_path, "w", encoding="utf-8") as file:
        file.write(code)
    with open(runner_path, "w", encoding="utf-8") as file:
        file.write(build_java_runner(tests))
    run_command(["javac", "Solution.java", "Main.java"], workdir, timeout=8)
    stdout = run_command(["java", "Main"], workdir, timeout=5)
    return json.loads(stdout)


def make_result(index, actual, expected):
    return {"index": index, "passed": deep_equal(actual, expected), "actual": actual, "expected": expected}


def cpp_literal(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, list):
        if not value:
            return "{}"
        return "{" + ", ".join(cpp_literal(item) for item in value) + "}"
    return "nullptr"


def cpp_type(value):
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "double"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        inner = cpp_type(value[0]) if value else "int"
        return f"vector<{inner}>"
    return "int"


def cpp_json_expr(expr, value):
    typ = cpp_type(value)
    if typ.startswith("vector<"):
        return f"vecToJson({expr})"
    if typ == "string":
        return f"quote({expr})"
    if typ == "bool":
        return f"(({expr}) ? string(\"true\") : string(\"false\"))"
    return f"to_string({expr})"


def build_cpp_runner(tests):
    lines = [
        '#include <bits/stdc++.h>',
        'using namespace std;',
        '#include "solution.cpp"',
        'string quote(const string &s){ string r="\\""; for(char c:s){ if(c==\'"\') r+="\\\\\\""; else r+=c; } return r+"\\""; }',
        'template<class T> string vecToJson(const vector<T>& v){ string r="["; for(size_t i=0;i<v.size();++i){ if(i) r+=","; r+=to_string(v[i]); } return r+"]"; }',
        'template<> string vecToJson<string>(const vector<string>& v){ string r="["; for(size_t i=0;i<v.size();++i){ if(i) r+=","; r+=quote(v[i]); } return r+"]"; }',
        'bool eq(double a,double b){ return fabs(a-b)<1e-9; }',
        'template<class T> bool eq(T a,T b){ return a==b; }',
        'int main(){ vector<string> out;'
    ]
    for index, test in enumerate(tests, 1):
        fn = test.get("function", "solve")
        args = test.get("args", [])
        expected = test.get("expected")
        call = f"{fn}({', '.join(cpp_literal(arg) for arg in args)})"
        expected_literal = cpp_literal(expected)
        actual_json = cpp_json_expr("actual", expected)
        expected_json = cpp_json_expr("expected", expected)
        lines.append(f"try{{ auto actual = {call}; auto expected = {expected_literal}; bool ok = eq(actual, expected); out.push_back(string(\"{{\\\"index\\\":{index},\\\"passed\\\":\")+(ok?\"true\":\"false\")+\",\\\"actual\\\":\"+{actual_json}+\",\\\"expected\\\":\"+{expected_json}+\"}}\"); }}catch(...){{ out.push_back(\"{{\\\"index\\\":{index},\\\"passed\\\":false,\\\"error\\\":\\\"runtime error\\\"}}\"); }}")
    lines.append('cout<<"["; for(size_t i=0;i<out.size();++i){ if(i) cout<<","; cout<<out[i]; } cout<<"]"; }')
    return "\n".join(lines)


def java_literal(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, list):
        if not value:
            return "new int[]{}"
        inner = java_type(value[0])
        return f"new {inner}[]{{" + ", ".join(java_literal(item) for item in value) + "}"
    return "null"


def java_type(value):
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "double"
    if isinstance(value, str):
        return "String"
    if isinstance(value, list):
        inner = java_type(value[0]) if value else "int"
        return f"{inner}[]"
    return "int"


def java_json_expr(expr, value):
    typ = java_type(value)
    if typ.endswith("[]"):
        return f"toJson({expr})"
    if typ == "String":
        return f"quote({expr})"
    return f"String.valueOf({expr})"


def build_java_runner(tests):
    lines = [
        "import java.util.*;",
        "public class Main {",
        'static String quote(String s){ return "\\\"" + s.replace("\\\\", "\\\\\\\\").replace("\\\"", "\\\\\\\"") + "\\\""; }',
        "static String toJson(int[] a){ return Arrays.toString(a).replace(\" \", \"\"); }",
        "static String toJson(double[] a){ return Arrays.toString(a).replace(\" \", \"\"); }",
        "static String toJson(String[] a){ StringBuilder sb=new StringBuilder(\"[\"); for(int i=0;i<a.length;i++){ if(i>0) sb.append(','); sb.append(quote(a[i])); } return sb.append(']').toString(); }",
        "static boolean eq(double a,double b){ return Math.abs(a-b)<1e-9; }",
        "static boolean eq(int a,int b){ return a==b; }",
        "static boolean eq(String a,String b){ return Objects.equals(a,b); }",
        "static boolean eq(int[] a,int[] b){ return Arrays.equals(a,b); }",
        "static boolean eq(double[] a,double[] b){ return Arrays.equals(a,b); }",
        "static boolean eq(String[] a,String[] b){ return Arrays.equals(a,b); }",
        "public static void main(String[] args){ ArrayList<String> out=new ArrayList<>();"
    ]
    for index, test in enumerate(tests, 1):
        fn = test.get("function", "solve")
        args = test.get("args", [])
        expected = test.get("expected")
        call = f"Solution.{fn}({', '.join(java_literal(arg) for arg in args)})"
        expected_literal = java_literal(expected)
        actual_json = java_json_expr("actual", expected)
        expected_json = java_json_expr("expected", expected)
        lines.append(f"try{{ var actual={call}; var expected={expected_literal}; boolean ok=eq(actual, expected); out.add(\"{{\\\"index\\\":{index},\\\"passed\\\":\"+(ok?\"true\":\"false\")+\",\\\"actual\\\":\"+{actual_json}+\",\\\"expected\\\":\"+{expected_json}+\"}}\"); }}catch(Throwable e){{ out.add(\"{{\\\"index\\\":{index},\\\"passed\\\":false,\\\"error\\\":\"+quote(e.getMessage())+\"}}\"); }}")
    lines.append('System.out.print("["); for(int i=0;i<out.size();i++){ if(i>0) System.out.print(","); System.out.print(out.get(i)); } System.out.print("]"); }}')
    return "\n".join(lines)


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    language = (payload.get("language") or "python").lower()
    code = payload.get("code", "")
    tests = payload.get("tests", [])
    result = {"language": language, "total": len(tests), "passed": 0, "results": []}
    workdir = tempfile.mkdtemp(prefix="judge-")

    try:
        if language in ("python", "py"):
            result["results"] = run_python(code, tests, workdir)
        elif language in ("javascript", "js", "node"):
            result["results"] = run_javascript(code, tests, workdir)
        elif language in ("cpp", "c++"):
            result["results"] = run_cpp(code, tests, workdir)
        elif language in ("java",):
            result["results"] = run_java(code, tests, workdir)
        else:
            raise ValueError(f"不支持的语言：{language}")
    except Exception as exc:
        result["loadError"] = str(exc)
        result["trace"] = traceback.format_exc(limit=3)

    result["passed"] = sum(1 for item in result["results"] if item.get("passed"))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
