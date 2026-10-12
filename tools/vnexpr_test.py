#!/usr/bin/env python3
"""Самопроверка грамматики условий (запускается в CI)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vnexpr

CASES = [
    ("trust >= 2 && !found_knife", {"trust": 2, "found_knife": False}, True),
    ("trust >= 2 && !found_knife", {"trust": 1, "found_knife": False}, False),
    ("(a || b) && c", {"a": False, "b": True, "c": True}, True),
    ("route == 'market'", {"route": "market"}, True),
    ("route != 'market' || n < -1", {"route": "market", "n": -5}, True),
    ("true", {}, True),
    ("!false", {}, True),
]
BAD = ["trust >= && x", "a &&", "(a", "a == 'unterminated", "A > 1", "a = 1"]


def main() -> int:
    ok = True
    for src, env, expected in CASES:
        got = vnexpr.evaluate(vnexpr.parse(src), env)
        if got != expected:
            print(f"FAIL {src!r} env={env}: {got} != {expected}")
            ok = False
    for src in BAD:
        try:
            vnexpr.parse(src)
        except vnexpr.ExprError:
            continue
        print(f"FAIL {src!r}: ожидалась ошибка синтаксиса")
        ok = False
    assert set(vnexpr.variables(vnexpr.parse("x > 1 && (y || !z)"))) == {"x", "y", "z"}
    print("vnexpr: ok" if ok else "vnexpr: FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
