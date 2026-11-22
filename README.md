# 把心事摊开看 · Spread Your Thoughts

**用一张卡，把说不清的困扰，整理成下一步。**

这是一套中文自我反思 Skill，也可以作为本地命令行工具使用。你可以从塔罗、易经、八字与西方占星，或行为倾向问答切入。牌和卦提供一个看事情的角度，出生计算只作象征素材；真正能指导下一步的，是你自己说出来的处境和选择。

每张卡只留三句：看见眼下的卡点，想清继续下去会怎样，选一个现在做得到的动作。它不预测结果，不给人下诊断，也不替人做决定。


本仓库发布的是 v0.2.1 的本地原型。命令每次以选择的一种支柱产出一张卡；并非四种来源每次都齐备，不自动搜集用户资料，也不含后续的四源联动校验候选、创作样片或真实试用数据。

## 快速使用

需要 Node ≥20。首次安装依赖需要软件仓库或缓存；安装完成后计算离线。

```sh
npm ci --ignore-scripts
npm test
node dist/src/cli.js read --input tests/fixtures/demo-iching.json
node dist/src/cli.js card --input tests/fixtures/demo-iching.json > reading-card.html
```

双击 assets/card/card-preview-offline.html 看四套虚构示例。card 命令每次生成一张 HTML 卡，实际牌面或卦爻用同次计算的数据。上部插画轻视差和弱箔光，下部三句不动；触屏、减少动效均用静态。卡片不会在加载时请求外部资源。分享卡片前请检查其中是否含用户原话。

## 适配器

- read 输入见 schemas/input.schema.json。pillar 选 tarot / iching / astrology / psychology，symbol.method 选该支柱方法；可另给 birth。read 与 card 分开调用时用相同 seed、手动牌或六爻重放，否则可能抽到不同结果。
- tarot-draw --seed 保留旧 22 张接口；tarot-draw --input 用完整 78 张、单／三牌、手动或种子重放。旧 advice 的 30 句都逐字保留；仅是编辑模板，不能当真实画像。组合忠告另基于明确证据。
- timezone --input 可传 {"mode":"civil-to-utc","local":"1991-09-15T01:30:00","timezone":"Asia/Shanghai","disambiguation":"later"}；反向方法 utc-to-civil 收 utc 和 timezone；true-solar 收 utc 和东正西负的 longitude。
- 八字 IANA 换算、农历与节气、日时柱和真太阳时约定见 references/bazi-conventions.md。占星支持太阳星座、交界日期候选及十天体地心热带黄经；不输出上升、宫位或相位。地点不做联网地理编码。
- questions 输出 34 条可选访谈问题；next-question 选择下一问。questionnaire 给英文原始题目和量尺，score 仅收明确选档；psychology 保留原保守规则画像，既不补齐缺项，也不从象征推断人格。
- 蓍草需独立依赖，不替代三钱。建议 Python 3.12，可使用固定版本二进制轮子：

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --only-binary=:all: -r python/requirements.txt
THOUGHTS_REQUIRE_ICHINGSHIFA=1 npm test
node dist/src/cli.js ichingshifa --lines 789789
node dist/src/cli.js ichingshifa --seed 42
```

## 本地保存

默认不保存。只有指定绝对目录、记录类别和 consent:true 才写入；出生资料、命盘和结果索引分开保存，不保存原始对话、答卷或三句文本。要保留完整卡片，在自己控制的位置显式重定向 HTML。建议避免把真实出生资料放进 shell 历史或同步目录。

```sh
node dist/src/cli.js save --root "$HOME/.mingli-data" --input - <<'JSON'
{"kind":"birth","id":"demo","consent":true,"data":{"calendar":"solar","year":1991,"month":9,"day":15,"hour":1,"minute":30,"timezone":"Asia/Shanghai","disambiguation":"later","timeStandard":"civil"}}
JSON
node dist/src/cli.js list --root "$HOME/.mingli-data"
node dist/src/cli.js load --root "$HOME/.mingli-data" --kind birth --id demo
node dist/src/cli.js delete --root "$HOME/.mingli-data" --kind birth --id demo
```

bazi 记录包含 profileId、ruleVersion 与 pillars（year、month、day、hour 各为干支或 null）；result 记录只存 pillar、ruleVersion、symbolIds。兼容旧 zone 字段；新版使用 timezone。保存/读回保留出生钟点折叠选择。删除出生资料时加 --cascade-bazi 才同时删除关联命盘；未删的派生记录标明来源已删除。访问限制为 POSIX 本地权限，不承诺加密或系统备份抹除。

见 [Skill](SKILL.md)、[测试说明](tests/calculation-cases.md)、[来源](references/sources.md)。
