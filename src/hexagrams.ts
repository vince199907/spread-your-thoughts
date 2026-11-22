import { readFileSync } from "node:fs";
import { dataPath } from "./paths.js";

export interface Hexagram {
  id: string;
  kingWen: number;
  name: string;
  upper: string;
  lower: string;
  linesBottomUp: number[];
}

interface HexagramFile {
  lineOrder: string;
  bit: string;
  note: string;
  hexagrams: Hexagram[];
}

let cached: HexagramFile | null = null;

export function loadHexagrams(): HexagramFile {
  if (!cached) {
    cached = JSON.parse(readFileSync(dataPath("hexagrams.json"), "utf8")) as HexagramFile;
  }
  return cached;
}

export function findHexagramByLines(lines: number[]): Hexagram | null {
  const key = lines.join("");
  return (
    loadHexagrams().hexagrams.find((item) => item.linesBottomUp.join("") === key) ?? null
  );
}
