import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "data"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  throw new Error("找不到仓库根目录（需要 package.json 与 data/）。");
}

export function dataPath(...parts: string[]): string {
  return join(repoRoot(), "data", ...parts);
}
