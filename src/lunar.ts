import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lunar = require("lunar-javascript") as typeof import("lunar-javascript");

export const Solar = lunar.Solar;
export const Lunar = lunar.Lunar;
export const LunarYear = lunar.LunarYear;
export const LunarMonth = lunar.LunarMonth;
export const LunarUtil = lunar.LunarUtil;

export function engineVersion(): string {
  const pkg = require("lunar-javascript/package.json") as { version: string };
  return pkg.version;
}
