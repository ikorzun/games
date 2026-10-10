"""Мини-грамматика условий сценария (поле `when` в episode.schema.json).

Грамматика:
  expr   := or
  or     := and ( '||' and )*
  and    := not ( '&&' not )*
  not    := '!' not | cmp
  cmp    := atom ( ('=='|'!='|'<='|'>='|'<'|'>') atom )?
  atom   := IDENT | INT | STRING | 'true' | 'false' | '(' expr ')'

IDENT  = [a-z_][a-z0-9_]*   INT = -?[0-9]+   STRING = '...'

Один и тот же модуль используется линтером (сбор переменных) и
рантаймом/тестами (вычисление). Никакого eval().
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterator

_TOKEN_RE = re.compile(
    r"\s*(?:(?P<op>==|!=|<=|>=|&&|\|\||[!<>()])|(?P<int>-?\d+)|(?P<str>'[^']*')|(?P<ident>[a-z_][a-z0-9_]*))"
)


class ExprError(ValueError):
    pass


@dataclass(frozen=True)
class Tok:
    kind: str
    text: str


def tokenize(src: str) -> list[Tok]:
    pos = 0
    out: list[Tok] = []
    src = src.strip()
    while pos < len(src):
        m = _TOKEN_RE.match(src, pos)
        if not m or m.end() == pos:
            raise ExprError(f"неожиданный символ в позиции {pos}: {src[pos:pos+10]!r}")
        pos = m.end()
        kind = m.lastgroup or ""
        out.append(Tok(kind, m.group(kind)))
    return out


# AST узлы: ("var", name) | ("int", v) | ("str", v) | ("bool", v)
#           ("not", node) | ("and", a, b) | ("or", a, b) | ("cmp", op, a, b)
Node = tuple


class _Parser:
    def __init__(self, toks: list[Tok]):
        self.toks = toks
        self.i = 0

    def peek(self) -> Tok | None:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self, text: str | None = None) -> Tok:
        t = self.peek()
        if t is None:
            raise ExprError("неожиданный конец выражения")
        if text is not None and t.text != text:
            raise ExprError(f"ожидалось {text!r}, получено {t.text!r}")
        self.i += 1
        return t

    def parse(self) -> Node:
        node = self.p_or()
        if self.peek() is not None:
            raise ExprError(f"лишние токены после выражения: {self.peek().text!r}")
        return node

    def p_or(self) -> Node:
        node = self.p_and()
        while self.peek() and self.peek().text == "||":
            self.take()
            node = ("or", node, self.p_and())
        return node

    def p_and(self) -> Node:
        node = self.p_not()
        while self.peek() and self.peek().text == "&&":
            self.take()
            node = ("and", node, self.p_not())
        return node

    def p_not(self) -> Node:
        if self.peek() and self.peek().text == "!":
            self.take()
            return ("not", self.p_not())
        return self.p_cmp()

    def p_cmp(self) -> Node:
        left = self.p_atom()
        t = self.peek()
        if t and t.text in ("==", "!=", "<=", ">=", "<", ">"):
            self.take()
            right = self.p_atom()
            return ("cmp", t.text, left, right)
        return left

    def p_atom(self) -> Node:
        t = self.take()
        if t.kind == "int":
            return ("int", int(t.text))
        if t.kind == "str":
            return ("str", t.text[1:-1])
        if t.kind == "ident":
            if t.text == "true":
                return ("bool", True)
            if t.text == "false":
                return ("bool", False)
            return ("var", t.text)
        if t.text == "(":
            node = self.p_or()
            self.take(")")
            return node
        raise ExprError(f"неожиданный токен {t.text!r}")


def parse(src: str) -> Node:
    return _Parser(tokenize(src)).parse()


def variables(node: Node) -> Iterator[str]:
    kind = node[0]
    if kind == "var":
        yield node[1]
    elif kind == "not":
        yield from variables(node[1])
    elif kind in ("and", "or"):
        yield from variables(node[1])
        yield from variables(node[2])
    elif kind == "cmp":
        yield from variables(node[2])
        yield from variables(node[3])


def evaluate(node: Node, env: dict[str, Any]) -> Any:
    kind = node[0]
    if kind in ("int", "str", "bool"):
        return node[1]
    if kind == "var":
        if node[1] not in env:
            raise ExprError(f"переменная не определена: {node[1]}")
        return env[node[1]]
    if kind == "not":
        return not evaluate(node[1], env)
    if kind == "and":
        return bool(evaluate(node[1], env)) and bool(evaluate(node[2], env))
    if kind == "or":
        return bool(evaluate(node[1], env)) or bool(evaluate(node[2], env))
    if kind == "cmp":
        op, a, b = node[1], evaluate(node[2], env), evaluate(node[3], env)
        return {
            "==": a == b, "!=": a != b,
            "<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b,
        }[op]
    raise ExprError(f"неизвестный узел {kind}")


def check(src: str, declared: set[str]) -> list[str]:
    """Возвращает список ошибок для выражения (синтаксис + необъявленные переменные)."""
    try:
        node = parse(src)
    except ExprError as e:
        return [f"синтаксис: {e}"]
    return [f"необъявленная переменная: {v}" for v in sorted(set(variables(node)) - declared)]
