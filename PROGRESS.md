# PROGRESS

## 开工回执（2026-09-24）
- 目标：BEAT LAB 律动实验室——两台打碟机＋混音台＋8 节闯关课，CC0 真人舞曲，未来科技风，上线 jyb635050-ai.github.io/dj-lab
- 顺序：任务 1 曲库（FMA CC0 扫描＋离线测速选稳定段）→ 任务 2 打碟台 → 任务 3 八节课 → --prove → 任务 4 上线 --url
- 最大风险：CC0 舞曲里 118–128 BPM、速度稳定、有 ≥30 秒每拍底鼓段的曲子凑不够 4 首
- 任务 0：`node tools/accept.mjs` 2/4 PASS 退出码 1；SHA256 026bc781…fd4a 一致
- 说明：写任务书的管理者和执行者是同一个会话，验收不独立

## 进度
- 任务 1 完成：`tools/tracks.mjs`（FMA 扫描＋逐首核 CC0＋与判卷同算法离线测速）扫了 Loyalty Freak Music、Monplaisir 等页面 ~130 首，选 10 首进 `audio/`（128kbps，长曲剪到 200 秒，共 29.5MB），`data/tracks.json` 由 `node tools/tracks.mjs build` 生成。`--only data,license` 5/5 PASS
  - 坑：只看一拍间隔的粗测速会把切分节奏认成 144 BPM（Dance Robot 实为 120），改成 1/2/4/8 拍一起打分后正常；HoliznaCC0 艺人页本机打不开，未用
- 任务 2 完成：打碟台（`js/engine.js` Web Audio 引擎、`js/controls.js` 推子/旋钮/转盘、`js/app.js`），`--only studio,layout` 全 PASS
  - 偏离建议并记原因：①EQ 用三段隔离式（250Hz/2.5kHz 24dB/倍频程分频），低架/高架滤波切低频会带跑中频（实测 −9.6dB）；②总线去掉了限幅器：它随底鼓一压一放，把鼓点形状弄糊，判卷测速强度从离线 0.4–0.9 掉到 0.2，误差逼近 0.5% 门限，改为总音量 0.6 留余量；③原来每帧改根节点 CSS 变量 `--pulse` 导致整页样式重算（主线程 24%），改成只改两个转盘外圈，降到 12%
  - 曲库顺序调整见 BLOCKED.md 第 2 条（如实说明）
- 任务 3 完成：8 课 44 步（`data/lessons.json`），每课开始重置打碟台、当前步要动的控件发光、每步提示音、过关撒彩带和星级、进度存本机。`--only data,home,lessons` 全 PASS；修了一个真 bug：语言存的是 JSON 字符串、读时按裸字符串比，刷新后回到中文
- 本地全量 33/33 PASS 退出码 0（run-local.txt）；`--prove` 退出码 1「反向验证成立」（run-prove.txt）
