import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths.js";
import type { CardModel } from "./reading.js";

export function renderCardHtml(model:CardModel):string {
  const readAsset=(name:string)=>readFileSync(join(repoRoot(),"assets","card",name),"utf8");
  const render=readAsset("thoughts-card.mjs").replace("export function renderThoughtsCard","function renderThoughtsCard");
  const data=JSON.stringify(model).replace(/</g,"\\u003c");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>把心事摊开看</title>
<style>${readAsset("thoughts-card.css")}
body{margin:0; padding:clamp(12px,4vw,36px); min-height:100vh; box-sizing:border-box; background:#e9e4da}
main{display:grid; justify-items:center}</style></head>
<body><main id="result"></main><noscript>请在本地浏览器启用 JavaScript 查看此卡片。</noscript>
<script type="application/json" id="card-data">${data}</script>
<script type="module">${render}
renderThoughtsCard(document.getElementById("result"),JSON.parse(document.getElementById("card-data").textContent));</script></body></html>`;
}
