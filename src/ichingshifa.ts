import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { repoRoot } from "./paths.js";
import { fail, ok, type Result } from "./result.js";

export function runIchingshifa(input: string | { seed: number }): Result<Record<string, unknown>> {
  let args: string[];
  if (typeof input === "string") {
    if (!/^[6789]{6}$/.test(input)) {
      return fail("INVALID_LINES", "ichingshifa 手动起卦需要 6 位由下而上的爻值，每位是 6、7、8 或 9。");
    }
    args = ["--lines", input];
  } else {
    const seed = input?.seed;
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      return fail("INVALID_SEED", "模拟蓍草需要 0 到 4294967295 的记录种子。");
    }
    args = ["--seed", String(seed)];
  }
  const script = join(repoRoot(), "python", "ichingshifa_adapter.py");
  const child = spawnSync("python3", ["-B", script, ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
  });
  if (child.error) {
    const code = (child.error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? fail("ICHINGSHIFA_UNAVAILABLE", "无法启动 python3。")
      : fail("ICHINGSHIFA_CALL_FAILED", "ichingshifa 子进程超时或无法运行。");
  }
  const stdout = (child.stdout || "").trim();
  if (!stdout) {
    return fail("ICHINGSHIFA_CALL_FAILED", "适配器没有输出，不编造卦象。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return fail("ICHINGSHIFA_CALL_FAILED", "适配器输出不是 JSON，已丢弃，不编造卦象。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("ICHINGSHIFA_CALL_FAILED", "适配器 JSON 无法读取。");
  }
  const body = parsed as { ok?: boolean; result?: Record<string, unknown>; error?: { code?: string; message?: string } };
  if (child.status === 0 && body.ok && body.result && body.result.packageVersion === "3.1.9") {
    return ok(body.result);
  }
  const code = body.error?.code || "ICHINGSHIFA_CALL_FAILED";
  const message = body.error?.message || "ichingshifa 没有返回卦名。";
  return fail(code, message);
}
