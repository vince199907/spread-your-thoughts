# 第十一章的可执行模块
保持原 TypeScript 结构，不另复制运行逻辑。四柱 src/bazi.ts；塔罗 src/tarot.ts；三钱 src/coin.ts；蓍草 src/ichingshifa.ts 与 python/ichingshifa_adapter.py；占星 src/astrology_adapter.ts；时区 src/timezone.ts；计分 src/confirmed-item-scoring.ts；编排 src/reading.ts。CLI 由 npm run build 生成 dist/src/cli.js。
