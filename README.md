# BEAT LAB 律动实验室

两台唱机 + 一张混音台 + 八节闯关课，用 CC0 真人舞曲玩着学会打碟。纯静态网页，无构建、无外部依赖。

- 在线：https://jyb635050-ai.github.io/dj-lab/
- 本地预览：任意静态服务器指向本目录即可（判卷自带服务器：`node tools/accept.mjs`）

## 目录
- `index.html`、`css/app.css`、`js/engine.js`（Web Audio 引擎）、`js/controls.js`（推子/旋钮/转盘）、`js/app.js`（页面、课程）
- `data/tracks.json` 曲库（由 `node tools/tracks.mjs build` 生成），`data/lessons.json` 课程
- `audio/` 10 首 CC0 舞曲（来自 Free Music Archive，出处见站内「曲目出处」页）
- `fonts/` Space Grotesk、JetBrains Mono（均为 SIL Open Font License 1.1）
- `tools/accept.mjs` 验收脚本（冻结，勿改）；`tools/tracks.mjs` 曲库扫描、测速、转码工具

## 换歌
1. `node tools/tracks.mjs scan <FMA 专辑或艺人页>` —— 逐首核对曲目页是 CC0 后下载并离线测速
2. `node tools/tracks.mjs report` 看哪些有 ≥30 秒稳定节拍段
3. 编辑 `tools/picks.json`，`node tools/tracks.mjs build`
