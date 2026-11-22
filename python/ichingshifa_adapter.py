#!/usr/bin/env python3
"""可选、离线的 ichingshifa 3.1.9 适配器；不提供判词或使用当前时间。"""

from __future__ import annotations

import json
import random
import re
import sys
from importlib.metadata import version as pkg_version

EXPECTED_VERSION = "3.1.9"


def fail(code: str, message: str, extra: dict | None = None) -> None:
    error = {"code": code, "message": message, "verified": False}
    if extra:
        error.update(extra)
    json.dump({"ok": False, "error": error}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    raise SystemExit(2)


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ("--lines", "--seed"):
        fail("USAGE", "用法：ichingshifa_adapter.py --lines 789789 或 --seed 42")
    mode = sys.argv[1]
    arg = sys.argv[2]
    seed = None
    if mode == "--lines":
        if not re.fullmatch(r"[6789]{6}", arg):
            fail("INVALID_LINES", "需要 6 个由下而上的爻值，每位只能是 6、7、8 或 9。")
        lines = arg
    else:
        if not re.fullmatch(r"[0-9]{1,10}", arg) or int(arg) > 0xffffffff:
            fail("INVALID_SEED", "seed 必须是 0 到 4294967295 的整数。")
        seed = int(arg)
        lines = None
    try:
        version = pkg_version("ichingshifa")
        if version != EXPECTED_VERSION:
            fail("ICHINGSHIFA_UNAVAILABLE", f"仅支持已核版本 {EXPECTED_VERSION}；当前为 {version}。")
        from ichingshifa.ichingshifa import Iching
    except Exception as exc:  # noqa: BLE001 — 明确区分不可用与起卦错误
        fail("ICHINGSHIFA_UNAVAILABLE", f"未能加载 ichingshifa：{type(exc).__name__}。")
    try:
        engine = Iching()
        if seed is not None:
            # Upstream uses this subprocess's Python random.sample; isolate its state.
            random.seed(seed, version=2)
            lines = engine.bookgua()
        if not isinstance(lines, str) or not re.fullmatch(r"[6789]{6}", lines):
            fail("ICHINGSHIFA_EMPTY", "库未返回有效的六爻，不编造结果。")
        raw = engine.mget_bookgua_details(lines)
    except Exception as exc:  # noqa: BLE001
        fail("ICHINGSHIFA_CALL_FAILED", f"ichingshifa 调用失败：{type(exc).__name__}。")
    if not isinstance(raw, list) or len(raw) < 3 or raw[0] != lines or not all(
        isinstance(name, str) and name.strip() for name in raw[1:3]
    ):
        fail("ICHINGSHIFA_EMPTY", "库没有返回有效卦名，不编造结果。")
    changing_positions = [i + 1 for i, ch in enumerate(lines) if ch in "69"]
    json.dump(
        {
            "ok": True,
            "result": {
                "integration": "ichingshifa",
                "api": "Iching.mget_bookgua_details",
                "method": "upstream-yarrow-simulation" if seed is not None else "manual-line-lookup",
                "lineOrder": "bottom-up",
                "lines": [int(ch) for ch in lines],
                "changingPositions": changing_positions,
                "trace": {
                    "seed": seed,
                    "pythonVersion": ".".join(str(x) for x in sys.version_info[:3]),
                    "generator": "Iching.bookgua + Python random.sample" if seed is not None else None,
                    "replayLines": lines,
                },
                "package": "ichingshifa",
                "packageVersion": version,
                "verifiedCall": True,
                "inputBottomUp": lines,
                "primaryName": raw[1],
                "changedName": raw[2],
                "classicalTextIncluded": False,
                "note": "六爻与变化按上游方式记录，不推断用户状态。未声明理论概率；不是三钱法。可用记录中的六爻独立重放卦名。",
                "notThreeCoin": True,
                "notYarrowSimulatedHere": seed is None,
            },
        },
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
