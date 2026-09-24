// DJ 学习网站 验收脚本 —— 判卷标准，冻结，任何人不许改（改了就算不合格）。
// 用法（在 D:\blender\DJLab 下）：
//   node tools/accept.mjs                 本地验收：自带静态服务器，站点挂在 /dj-lab/ 子路径（和 GitHub Pages 一样）
//   node tools/accept.mjs --url https://jyb635050-ai.github.io/dj-lab/
//                                         线上验收：全套检查＋线上 data/*.json 必须与本地逐字节相同
//   node tools/accept.mjs --prove         反向验证：往页面里注入破坏（静音／假声音／卡顿／外链／报错／谎报速度／假许可），
//                                         对应检查必须全部变红。全部抓到 → 退出码 1；有破坏没被抓到 → 退出码 2
//   --only 组名,组名   只跑某几组（调试用）：data home studio lessons layout license。交付必须跑全量
// 全部 PASS 退出码 0；任一 FAIL 退出码 1。截图写到 shots/。
// 判卷在浏览器里"接听"网页真正输出到扬声器的声音（ctx.destination 之前插一个监听器），用声音本身判：
// 播放有没有声、推子/EQ/滤波有没有真起作用、速度是不是真的。只改页面上显示的数字骗不过去。
//
// ───── 数据契约 ─────
// data/tracks.json  数组，至少 8 首，每项：
//   id        小写字母数字短横线，唯一；title、artist 非空
//   file      "audio/<文件名>"，本地文件，单首 ≤ 8 MB，全部合计 ≤ 40 MB
//   bpm       原速（实测，数字）；firstBeat 第一拍所在秒数（≥0）
//   groove    [开始秒, 结束秒]，长度 ≥ 30：这段速度稳定、每拍有底鼓。判卷在这段里用声音测速，误差须 ≤ 0.5%
//   license   必须是 "CC0-1.0"
//   source    原曲页面网址（https）：页面里必须出现 creativecommons.org/publicdomain/zero/1.0，
//             不许出现 creativecommons.org/licenses/by（署名类许可），且必须出现 origFile 这个字符串
//   origFile  原始文件名（如 FMA 页面 JSON 里的 fileName）
//   速度分布：至少 4 首原速在 118–128 之间，其中至少一对相差 ≥ 3
// data/lessons.json 数组，至少 8 课，每项 { id, title:{zh,en}, steps:[ { text:{zh,en}, check } ] }，每课 3–8 步
//   check 只许用这些 kind（判卷会用真实鼠标键盘自己把每一步做完）：
//     {kind:"play", deck:"a"|"b", is:true|false}            该台在播/停
//     {kind:"slider", id:"<下面推子旋钮的 testid>", to:0~1, tol:≤0.1}   值按 aria 范围归一化后到 to±tol
//     {kind:"bpmMatch", deck, tol:≤0.5}                     该台速度与另一台相差 ≤ tol（靠 pitch 推子，不按 sync）
//     {kind:"sync", deck}                                   这一步开始后按了该台 sync，两台速度一致
//     {kind:"loop", deck, is:true}                          该台循环开着
//     {kind:"hotcue", deck, n:1~4}                          这一步开始后，该台第 n 个热点先被设下、再被按下跳回
//     {kind:"scratch", deck}                                这一步开始后，3 秒内来回搓该台转盘 ≥ 4 次换向
//     {kind:"quiz", choices:{zh:[..],en:[..]}, answer:下标} 选项 [data-testid=choice]（只显示当前步的）；选错要提示且不算过
//     {kind:"ack"}                                          「懂了」按钮 [data-testid=ack]；每课最多 1 个
//   8 课合计必须用到：play、slider(xfader)、slider(eq-low-*)、slider(filter-*)、bpmMatch、sync、loop、hotcue、scratch、quiz
//   每一步变成当前步时，它的条件必须还没满足（判卷会先等 1 秒、点一下步骤文字，这时不许算过）
//
// ───── 页面契约 ─────
// 路由：#/ 首页课程地图；#/studio 自由打碟；#/lesson/<课程 id>；#/credits 曲目出处
// window.__dj：ready（音频引擎与曲库就绪置 true）；state() 返回
//   { a:{ track, playing, bpm, pitch, position, phase, loop }, b:{…} }
//   track＝已载入曲目 id；bpm＝当前实际速度；pitch＝变速百分比；position＝曲目内秒数；phase＝在当前拍里的位置 0~1（按 firstBeat 与原速算）
//   seek(deck, 秒)：跳到曲目该位置（仅供判卷用）
// 声音：整页只许 new 一个 AudioContext，所有声音经 Web Audio 连到 ctx.destination
// 打碟台控件（d＝a 或 b），#/studio 和每个课程页都要有：
//   推子旋钮 role=slider，tabindex=0，带 aria-valuemin/max/now；键盘 →↑ 加、←↓ 减、Home 最小、End 最大；鼠标拖动能改
//     [data-testid=xfader]   横向；最小＝只听 A，最大＝只听 B
//     [data-testid=vol-d]    竖向，往上＝大；最小＝静音
//     [data-testid=pitch-d]  值＝变速百分比，范围至少 −8…+8，值越大越快；aria-orientation 写明横竖
//     [data-testid=eq-hi-d] [data-testid=eq-mid-d] [data-testid=eq-low-d]  旋钮：中点＝原样，最小＝切掉该频段
//     [data-testid=filter-d] 旋钮：中点＝关；往小＝低通（变闷），往大＝高通（变薄）
//     旋钮拖法：按住上下拖，往上加，拖 250px 以内走完全程
//   按钮 [data-testid=play-d] [data-testid=cue-d] [data-testid=sync-d] [data-testid=loop-d]（play/loop 用 aria-pressed 表示开关）
//     [data-testid=hotcue-d-1] … [data-testid=hotcue-d-4]：空的按＝设点，设过的按＝跳过去
//   [data-testid=jog-d] 转盘：按住绕圆心拖；暂停时顺时针＝位置前进、逆时针＝后退，拖动时要出声（搓碟）
//   [data-testid=bpm-d] 文字里有当前实际速度（1 位小数）
//   曲库 [data-testid=track][data-id=曲目 id]，里面有 [data-testid=load-a] 和 [data-testid=load-b]（至少在 #/studio）
//   以上每个 data-testid 在同一页面里只许出现一个（曲库条目除外）
//   1280×720 和 1440×900 下，#/studio 不滚动就能看到上面全部控件；任何页面、任何宽度不许横向滚动
// 首页：[data-testid=lesson-card][data-id][data-done="true|false"]，点击进入该课；进度存本机，刷新后保持
// 课程页：[data-testid=step] 按顺序，data-state="todo|active|done"，同时只有一步 active；全部完成出现 [data-testid=lesson-complete]
// 语言：[data-testid=lang] 切换中/英；默认 <html lang="zh-CN">，切换后 "en"，刷新后保持；首页课程卡显示对应语言的课程标题
// #/credits：每首一个 [data-testid=credit]，含曲名、作者，和指向 source 的链接
// 首页首屏（加载完再等 2 秒）总下载 ≤ 2 MB（音频要等载入打碟台时再下）
// 页面加载和交互期间不许请求任何外域资源；控制台不许有报错
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const PROVE = args.includes('--prove');
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const SHOT = path.join(ROOT, 'shots');
const SUB = '/dj-lab/';
const CCBY_PAGE = 'https://freemusicarchive.org/music/Kevin_MacLeod/Best_of_2014_1461/Crossing_the_Divide/'; // 实测 2026-09-24：CC-BY 3.0 页面
const KINDS = ['play', 'slider', 'bpmMatch', 'sync', 'loop', 'hotcue', 'scratch', 'quiz', 'ack'];
const SLIDERS = d => [`vol-${d}`, `pitch-${d}`, `eq-hi-${d}`, `eq-mid-${d}`, `eq-low-${d}`, `filter-${d}`];
const ALL_SLIDERS = ['xfader', ...SLIDERS('a'), ...SLIDERS('b')];
const CONTROLS = ['xfader', ...['a', 'b'].flatMap(d => [...SLIDERS(d), `play-${d}`, `cue-${d}`, `sync-${d}`, `loop-${d}`, `jog-${d}`, `bpm-${d}`, `hotcue-${d}-1`, `hotcue-${d}-2`, `hotcue-${d}-3`, `hotcue-${d}-4`])];

let results = [];
function rec(id, ok, msg) { results.push({ id, ok, msg }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${msg}`); }
const tid = id => `[data-testid="${id}"]`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const want = g => !ONLY || ONLY.includes(g);

// ───── 静态服务器 ─────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (!u.startsWith(SUB)) { rsp.writeHead(u === '/favicon.ico' ? 404 : 302, { location: SUB }); return rsp.end(); }
      let f = path.join(ROOT, u.slice(SUB.length));
      if (!f.startsWith(ROOT)) { rsp.writeHead(403); return rsp.end(); }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) { rsp.writeHead(404); return rsp.end('404'); }
      const st = fs.statSync(f), type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
      const m = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      if (m && (m[1] || m[2])) {
        const s = m[1] ? +m[1] : Math.max(0, st.size - +m[2]), e = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
        rsp.writeHead(206, { 'content-type': type, 'content-range': `bytes ${s}-${e}/${st.size}`, 'content-length': e - s + 1, 'accept-ranges': 'bytes' });
        fs.createReadStream(f, { start: s, end: e }).pipe(rsp);
      } else {
        rsp.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
        fs.createReadStream(f).pipe(rsp);
      }
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ───── 注入页面的监听器（判卷自己的，和网页代码无关）─────
function probeInit(sab) {
  const P = window.__probe = { blocks: [], bands: [], ctxCount: 0, taps: 0, frames: [], longtasks: [] };
  const Orig = window.AudioContext;
  if (Orig) {
    const W = class AudioContext extends Orig { constructor(...a) { super(...a); P.ctxCount++; if (!P.ctx) P.ctx = this; } };
    window.AudioContext = W; if (window.webkitAudioContext) window.webkitAudioContext = W;
  }
  const oc = AudioNode.prototype.connect;
  function setupTap(ctx) {
    const inp = ctx.createGain(); inp.gain.value = (sab.silence || sab.noise) ? 0 : 1;
    const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
    oc.call(inp, mono);
    if (sab.noise) {
      const nb = ctx.createBuffer(1, Math.round(ctx.sampleRate * 29.37), ctx.sampleRate), d = nb.getChannelData(0); // 不能短：短循环本身会形成节拍
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
      const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true; oc.call(ns, mono); ns.start();
    }
    const lp1 = ctx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 150;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 150;
    oc.call(mono, lp1); oc.call(lp1, lp2);
    const mg = ctx.createChannelMerger(2); oc.call(mono, mg, 0, 0); oc.call(lp2, mg, 0, 1);
    const sp = ctx.createScriptProcessor(512, 2, 1); oc.call(mg, sp);
    const mute = ctx.createGain(); mute.gain.value = 0; oc.call(sp, mute); oc.call(mute, ctx.destination);
    sp.onaudioprocess = e => {
      const a = e.inputBuffer.getChannelData(0), b = e.inputBuffer.getChannelData(1); let s = 0, t = 0;
      for (let i = 0; i < a.length; i++) { s += a[i] * a[i]; t += b[i] * b[i]; }
      P.blocks.push([e.playbackTime, Math.sqrt(s / a.length), Math.sqrt(t / b.length)]);
      if (P.blocks.length > 24000) P.blocks.splice(0, 6000);
    };
    const an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0; oc.call(mono, an);
    const fd = new Float32Array(an.frequencyBinCount), hz = ctx.sampleRate / an.fftSize;
    setInterval(() => {
      if (ctx.state !== 'running') return;
      an.getFloatFrequencyData(fd); let l = 0, m = 0, h = 0;
      for (let i = 1; i < fd.length; i++) { const f = i * hz, p = Math.pow(10, fd[i] / 10); if (f < 150) l += p; else if (f >= 500 && f < 2000) m += p; else if (f >= 6000 && f < 16000) h += p; }
      P.bands.push([ctx.currentTime, l, m, h]); if (P.bands.length > 6000) P.bands.splice(0, 1500);
    }, 40);
    P.ctx = ctx; P.taps++;
    return inp;
  }
  AudioNode.prototype.connect = function (t, ...r) {
    const res = oc.call(this, t, ...r);
    if (Orig && t instanceof AudioDestinationNode && t.context instanceof Orig) {
      const ctx = t.context; if (!ctx.__tap) ctx.__tap = setupTap(ctx);
      oc.call(this, ctx.__tap);
    }
    return res;
  };
  const db = x => 20 * Math.log10(x + 1e-10);
  P.now = () => P.ctx ? P.ctx.currentTime : -1;
  P.rms = (t0, t1) => {
    const B = P.blocks.filter(x => x[0] >= t0 && x[0] < t1); if (!B.length) return { db: -200, peak: -200, n: 0 };
    let s = 0, pk = 0; for (const b of B) { s += b[1] * b[1]; pk = Math.max(pk, b[1]); }
    return { db: 10 * Math.log10(s / B.length + 1e-20), peak: db(pk), n: B.length };
  };
  P.firstAbove = (t0, thr) => { const b = P.blocks.find(x => x[0] >= t0 && db(x[1]) > thr); return b ? b[0] : null; };
  P.band = (t0, t1) => {
    const B = P.bands.filter(x => x[0] >= t0 && x[0] < t1); if (!B.length) return null;
    const m = [1, 2, 3].map(k => 10 * Math.log10(B.reduce((s, x) => s + x[k], 0) / B.length + 1e-20));
    return { low: m[0], mid: m[1], high: m[2], n: B.length };
  };
  P.bpm = (t0, t1, expect) => { // 低频包络的起音强度 → 8 拍间隔的自相关峰，抛物线插值
    const B = P.blocks.filter(x => x[0] >= t0 && x[0] < t1); if (B.length < 300) return { ok: false, why: '样本太少 ' + B.length };
    const dt = (B[B.length - 1][0] - B[0][0]) / (B.length - 1);
    const d = []; for (let i = 1; i < B.length; i++) d.push(Math.max(B[i][2] - B[i - 1][2], 0));
    const mean = d.reduce((a, b) => a + b, 0) / d.length; for (let i = 0; i < d.length; i++) d[i] -= mean;
    const ac = k => { let s = 0; for (let i = 0; i + k < d.length; i++) s += d[i] * d[i + k]; return s / (d.length - k); };
    const e0 = ac(0); if (!(e0 > 0)) return { ok: false, why: '没有起音' };
    const kLo = Math.floor(8 * 60 / (expect * 1.04) / dt), kHi = Math.ceil(8 * 60 / (expect * 0.96) / dt);
    let bk = kLo, bv = -Infinity; const vals = {};
    for (let k = kLo - 1; k <= kHi + 1; k++) { vals[k] = ac(k); if (k >= kLo && k <= kHi && vals[k] > bv) { bv = vals[k]; bk = k; } }
    const y0 = vals[bk - 1], y1 = vals[bk], y2 = vals[bk + 1], den = y0 - 2 * y1 + y2;
    const off = den < 0 ? 0.5 * (y0 - y2) / den : 0;
    return { ok: true, bpm: 8 * 60 / ((bk + off) * dt), strength: bv / e0, edge: bk === kLo || bk === kHi };
  };
  const fr = t => { P.frames.push(t); if (P.frames.length > 4000) P.frames.splice(0, 1000); requestAnimationFrame(fr); };
  requestAnimationFrame(fr);
  try { new PerformanceObserver(l => l.getEntries().forEach(e => P.longtasks.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true }); } catch (e) { }
  if (sab.jank) setInterval(() => { const t = performance.now(); while (performance.now() - t < 80); }, 250);
  if (sab.ext) addEventListener('load', () => { fetch('https://example.com/prove.png', { mode: 'no-cors' }).catch(() => { }); });
  if (sab.conerr) addEventListener('load', () => console.error('prove: injected error'));
}

// ───── 公共动作 ─────
let browser, BASE, srv;
const netBad = new Set(), conErr = [];
async function newPage(sab = {}, vp = { width: 1440, height: 900 }, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, userAgent: UA, ...opts });
  await ctx.addInitScript(probeInit, sab);
  if (sab.badbpm) await ctx.route('**/data/tracks.json', async r => {
    const rsp = await r.fetch(); const j = await rsp.json();
    j.forEach(t => { t.bpm = Math.round(t.bpm * 1.03 * 100) / 100; });
    await r.fulfill({ response: rsp, body: JSON.stringify(j) });
  });
  const page = await ctx.newPage();
  const host = new URL(BASE).host;
  page.on('request', q => { const u = q.url(); if (/^https?:/.test(u) && new URL(u).host !== host) netBad.add(u); });
  page.on('console', m => { if (m.type() === 'error') conErr.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => conErr.push('pageerror: ' + String(e.message).slice(0, 200)));
  return page;
}
async function go(page, hash) { await page.goto(BASE + hash, { waitUntil: 'load' }); await page.evaluate(h => { if (location.hash !== h) location.hash = h; }, hash); }
async function waitReady(page, ms = 15000) { await page.waitForFunction(() => window.__dj && window.__dj.ready === true, null, { timeout: ms }); }
const st = page => page.evaluate(() => window.__dj.state());
const now = page => page.evaluate(() => window.__probe.now());
async function aria(page, id) {
  return page.$eval(tid(id), e => ({ role: e.getAttribute('role'), min: parseFloat(e.getAttribute('aria-valuemin')), max: parseFloat(e.getAttribute('aria-valuemax')), now: parseFloat(e.getAttribute('aria-valuenow')), orient: e.getAttribute('aria-orientation') }));
}
async function setVal(page, id, target, tolAbs) {
  await page.locator(tid(id)).focus();
  let a = await aria(page, id);
  if (target <= a.min) { await page.keyboard.press('Home'); return aria(page, id); }
  if (target >= a.max) { await page.keyboard.press('End'); return aria(page, id); }
  if (tolAbs == null) tolAbs = (a.max - a.min) * 0.01;
  const fromTop = (a.max - target) < (target - a.min);
  await page.keyboard.press(fromTop ? 'End' : 'Home'); a = await aria(page, id);
  const key = fromTop ? 'ArrowDown' : 'ArrowUp';
  await page.keyboard.press(key); const b = await aria(page, id); const step = Math.abs(b.now - a.now);
  if (!(step > 0)) throw new Error(`${id} 按 ${key} 值不变`);
  const n = Math.min(3000, Math.floor(Math.abs(target - b.now) / step));
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
  let c = await aria(page, id);
  for (let i = 0; i < 30 && Math.abs(c.now - target) > tolAbs; i++) { await page.keyboard.press(c.now < target ? 'ArrowUp' : 'ArrowDown'); c = await aria(page, id); }
  return c;
}
async function setNorm(page, id, v, tol) { const a = await aria(page, id); return setVal(page, id, a.min + v * (a.max - a.min), tol == null ? null : tol * (a.max - a.min)); }
const norm = a => (a.now - a.min) / (a.max - a.min);
async function pressed(page, id) { return (await page.getAttribute(tid(id), 'aria-pressed')) === 'true'; }
async function center(page, id) { const b = await page.locator(tid(id)).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; }
async function jog(page, deck, moves, msPer = 25) { // moves：每段转多少度（顺时针为正），按住不放连续转
  const { x, y, b } = await center(page, `jog-${deck}`); const r = Math.min(b.width, b.height) * 0.35; let ang = -Math.PI / 2;
  await page.mouse.move(x + r * Math.cos(ang), y + r * Math.sin(ang)); await page.mouse.down();
  for (const deg of moves) {
    const steps = Math.max(6, Math.round(Math.abs(deg) / 6));
    for (let i = 0; i < steps; i++) { ang += deg * Math.PI / 180 / steps; await page.mouse.move(x + r * Math.cos(ang), y + r * Math.sin(ang)); await sleep(msPer); }
  }
  await page.mouse.up();
}
async function load(page, deck, id) {
  await page.locator(`${tid('track')}[data-id="${id}"] ${tid('load-' + deck)}`).first().click();
  await page.waitForFunction(([d, i]) => window.__dj.state()[d].track === i, [deck, id], { timeout: 20000 }); await sleep(300);
}
async function setPlay(page, d, on) {
  if ((await st(page))[d].playing === on) return;
  await page.locator(tid(`play-${d}`)).click();
  await page.waitForFunction(([d, on]) => window.__dj.state()[d].playing === on, [d, on], { timeout: 3000 }).catch(() => { });
}
async function measureBpm(page, ms, expect) { const t0 = await now(page); await sleep(ms); const t1 = await now(page); return page.evaluate(([a, b, e]) => window.__probe.bpm(a, b, e), [t0, t1, expect]); }
async function measureRms(page, ms) { const t0 = await now(page); await sleep(ms); const t1 = await now(page); return page.evaluate(([a, b]) => window.__probe.rms(a, b), [t0, t1]); }
async function measureBand(page, ms) { const t0 = await now(page); await sleep(ms); const t1 = await now(page); return page.evaluate(([a, b]) => window.__probe.band(a, b), [t0, t1]); }
async function fetchJson(rel) { const r = await fetch(BASE + rel, { headers: { 'user-agent': UA } }); if (!r.ok) throw new Error(rel + ' ' + r.status); return r.json(); }
const pct = (a, b) => Math.abs(a - b) / b * 100;
const f1 = x => (typeof x === 'number' ? x.toFixed(1) : String(x));

// ───── 组：data ─────
async function groupData() {
  let T, L;
  try { T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tracks.json'), 'utf8')); } catch (e) { rec('D1', false, 'data/tracks.json 读不了：' + e.message); }
  if (T) {
    const bad = []; let total = 0; const ids = new Set();
    if (!Array.isArray(T) || T.length < 8) bad.push(`曲目 ${Array.isArray(T) ? T.length : '非数组'} 首 < 8`);
    for (const t of Array.isArray(T) ? T : []) {
      const w = `[${t.id}]`;
      if (!/^[a-z0-9-]+$/.test(t.id || '') || ids.has(t.id)) bad.push(w + ' id 不合规或重复'); ids.add(t.id);
      if (!t.title || !t.artist) bad.push(w + ' 缺 title/artist');
      const f = path.join(ROOT, t.file || '#');
      if (!/^audio\//.test(t.file || '') || !fs.existsSync(f)) bad.push(w + ' 音频文件不存在 ' + t.file);
      else { const s = fs.statSync(f).size; total += s; if (s > 8e6) bad.push(w + ` 文件 ${(s / 1e6).toFixed(1)}MB > 8MB`); }
      if (!(t.bpm > 60 && t.bpm < 200)) bad.push(w + ' bpm 不合理');
      if (!(t.firstBeat >= 0)) bad.push(w + ' firstBeat 缺');
      if (!Array.isArray(t.groove) || !(t.groove[0] >= 0) || !(t.groove[1] - t.groove[0] >= 30)) bad.push(w + ' groove 缺或短于 30 秒');
      if (t.license !== 'CC0-1.0') bad.push(w + ' license 不是 CC0-1.0');
      if (!/^https:\/\//.test(t.source || '') || !t.origFile) bad.push(w + ' 缺 source/origFile');
    }
    if (total > 40e6) bad.push(`音频合计 ${(total / 1e6).toFixed(1)}MB > 40MB`);
    const mid = (Array.isArray(T) ? T : []).filter(t => t.bpm >= 118 && t.bpm <= 128);
    if (mid.length < 4) bad.push(`118–128 BPM 只有 ${mid.length} 首 < 4`);
    if (!mid.some(a => mid.some(b => Math.abs(a.bpm - b.bpm) >= 3))) bad.push('118–128 里没有相差 ≥3 BPM 的一对');
    rec('D1', !bad.length, bad.length ? bad.slice(0, 12).join('；') : `曲目 ${T.length} 首，音频合计 ${(total / 1e6).toFixed(1)}MB，118–128 BPM ${mid.length} 首`);
  }
  try { L = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/lessons.json'), 'utf8')); } catch (e) { rec('D2', false, 'data/lessons.json 读不了：' + e.message); }
  if (L) {
    const bad = [], used = new Set(), ids = new Set(); let steps = 0;
    if (!Array.isArray(L) || L.length < 8) bad.push(`课程 ${Array.isArray(L) ? L.length : '非数组'} 课 < 8`);
    for (const l of Array.isArray(L) ? L : []) {
      const w = `[${l.id}]`;
      if (!/^[a-z0-9-]+$/.test(l.id || '') || ids.has(l.id)) bad.push(w + ' id 不合规或重复'); ids.add(l.id);
      if (!l.title?.zh || !l.title?.en) bad.push(w + ' 标题缺中/英');
      if (!Array.isArray(l.steps) || l.steps.length < 3 || l.steps.length > 8) { bad.push(w + ' 步数不在 3–8'); continue; }
      let acks = 0;
      l.steps.forEach((s, i) => {
        steps++; const c = s.check || {}, v = `${w}第${i + 1}步`;
        if (!s.text?.zh || !s.text?.en) bad.push(v + ' 文字缺中/英');
        if (!KINDS.includes(c.kind)) { bad.push(v + ' kind 不认识 ' + c.kind); return; }
        if (['play', 'bpmMatch', 'sync', 'loop', 'hotcue', 'scratch'].includes(c.kind) && !['a', 'b'].includes(c.deck)) bad.push(v + ' deck 不对');
        if (c.kind === 'play' && typeof c.is !== 'boolean') bad.push(v + ' play 缺 is');
        if (c.kind === 'loop' && c.is !== true) bad.push(v + ' loop 的 is 必须 true');
        if (c.kind === 'slider') { if (!ALL_SLIDERS.includes(c.id) || !(c.to >= 0 && c.to <= 1) || !(c.tol > 0 && c.tol <= 0.1)) bad.push(v + ' slider 参数不对'); else used.add(c.id === 'xfader' ? 'xfader' : c.id.replace(/-[ab]$/, '')); }
        if (c.kind === 'bpmMatch' && !(c.tol > 0 && c.tol <= 0.5)) bad.push(v + ' bpmMatch tol 不对');
        if (c.kind === 'hotcue' && ![1, 2, 3, 4].includes(c.n)) bad.push(v + ' hotcue n 不对');
        if (c.kind === 'quiz') { const z = c.choices?.zh, e = c.choices?.en; if (!Array.isArray(z) || !Array.isArray(e) || z.length < 2 || z.length !== e.length || !(c.answer >= 0 && c.answer < z.length)) bad.push(v + ' quiz 参数不对'); }
        if (c.kind === 'ack') acks++;
        used.add(c.kind);
      });
      if (acks > 1) bad.push(w + ' ack 超过 1 个');
    }
    const need = ['play', 'xfader', 'eq-low', 'filter', 'bpmMatch', 'sync', 'loop', 'hotcue', 'scratch', 'quiz'].filter(k => !used.has(k));
    if (need.length) bad.push('课程没用到：' + need.join(','));
    rec('D2', !bad.length, bad.length ? bad.slice(0, 12).join('；') : `课程 ${L.length} 课 ${steps} 步，题型齐`);
  }
  return { T, L };
}

// ───── 组：home（首页、语言）─────
async function groupHome(L) {
  const page = await newPage();
  try {
    await go(page, '#/'); await page.waitForSelector(tid('lesson-card'), { timeout: 15000 });
    const cards = await page.$$eval(tid('lesson-card'), es => es.map(e => ({ id: e.getAttribute('data-id'), done: e.getAttribute('data-done') })));
    const ids = (L || []).map(l => l.id);
    const okCards = L && cards.length === L.length && cards.every((c, i) => c.id === ids[i] && c.done === 'false');
    await fs.promises.mkdir(SHOT, { recursive: true }); await page.screenshot({ path: path.join(SHOT, 'home-1440.png') });
    await page.locator(tid('lesson-card')).first().click(); await sleep(800);
    const h = await page.evaluate(() => location.hash);
    rec('H1', okCards && h === '#/lesson/' + ids[0], `课程卡 ${cards.length} 张（应 ${ids.length}，初始都未完成），点第一张进 ${h}`);
    await go(page, '#/'); await page.waitForSelector(tid('lesson-card'));
    const lang0 = await page.getAttribute('html', 'lang');
    const t0 = await page.locator(tid('lesson-card')).first().innerText();
    await page.locator(tid('lang')).click(); await sleep(500);
    const lang1 = await page.getAttribute('html', 'lang'); const t1 = await page.locator(tid('lesson-card')).first().innerText();
    await page.reload(); await page.waitForSelector(tid('lesson-card'));
    const lang2 = await page.getAttribute('html', 'lang');
    await page.locator(tid('lang')).click(); await sleep(500);
    const lang3 = await page.getAttribute('html', 'lang');
    const ok = lang0 === 'zh-CN' && t0.includes(L[0].title.zh) && lang1 === 'en' && t1.includes(L[0].title.en) && lang2 === 'en' && lang3 === 'zh-CN';
    rec('H2', ok, `语言 默认 ${lang0} → 切换 ${lang1} → 刷新 ${lang2} → 再切 ${lang3}；卡片标题跟着换：${t0.includes(L[0].title.zh) && t1.includes(L[0].title.en)}`);
  } catch (e) { rec('H1', false, '首页出错：' + e.message.split('\n')[0]); }
  await page.context().close();
}

// ───── 组：studio（用声音判）─────
async function groupStudio(T, sab = {}, only = null) {
  const page = await newPage(sab);
  const run = k => !only || only.includes(k);
  try {
    const t0 = Date.now(); await go(page, '#/studio');
    try { await waitReady(page, 10000); rec('S1', true, `打碟台就绪 ${Date.now() - t0}ms`); } catch { rec('S1', false, '10 秒内 __dj.ready 没变 true'); throw new Error('stop'); }
    const tracks = await page.evaluate(() => fetch('data/tracks.json').then(r => r.json()));
    const mid = tracks.filter(t => t.bpm >= 118 && t.bpm <= 128).sort((a, b) => a.bpm - b.bpm);
    const pool = mid.length >= 2 ? mid : [...tracks].sort((a, b) => a.bpm - b.bpm);
    const A = pool[0], B = pool.find(t => Math.abs(t.bpm - A.bpm) >= 3) || pool[pool.length - 1];
    await load(page, 'a', A.id); await load(page, 'b', B.id);
    for (const d of ['a', 'b']) { await setVal(page, `pitch-${d}`, 0, 0.01); await setNorm(page, `vol-${d}`, 1); for (const k of ['eq-hi', 'eq-mid', 'eq-low', 'filter']) await setNorm(page, `${k}-${d}`, 0.5, 0.01); }
    await setNorm(page, 'xfader', 0);
    await page.evaluate(([s]) => window.__dj.seek('a', s), [A.groove[0]]);
    // S2/S3：按播放多久出声；暂停后是否真静音
    if (run('S3') || run('S2')) {
      await page.evaluate(() => window.__probe.now()); const tc = Math.max(0, await now(page));
      await page.locator(tid('play-a')).click();
      await page.waitForFunction(() => window.__probe.ctx, null, { timeout: 3000 }).catch(() => { });
      await sleep(1200);
      const t1 = await page.evaluate(([t]) => window.__probe.firstAbove(t, -35), [tc]);
      const lat = t1 == null ? null : Math.round((t1 - tc) * 1000);
      const ctxN = await page.evaluate(() => window.__probe.ctxCount);
      if (run('S3')) rec('S3', lat != null && lat <= 400 && (await pressed(page, 'play-a')) && ctxN === 1, `按下播放到出声 ${lat == null ? '没出声' : lat + 'ms'}（≤400），play 按钮 aria-pressed=${await pressed(page, 'play-a')}，AudioContext ${ctxN} 个（应 1）`);
      if (run('S2')) {
        await setPlay(page, 'a', false); await sleep(500); const q = await measureRms(page, 1000);
        await setPlay(page, 'a', true); await sleep(300);
        rec('S2', q.n > 0 && q.db < -60, `暂停后输出 ${f1(q.db)} dBFS（应 < −60）`);
      }
    }
    await setPlay(page, 'a', true); await sleep(400);
    // S4 交叉推子
    if (run('S4')) {
      const on = await measureRms(page, 1000); await setNorm(page, 'xfader', 1); await sleep(300); const off = await measureRms(page, 1000); await setNorm(page, 'xfader', 0); await sleep(300);
      rec('S4', on.db > -30 && on.db - off.db >= 30, `只听 A ${f1(on.db)} dBFS → 推到只听 B（B 没放）${f1(off.db)} dBFS，降 ${f1(on.db - off.db)} dB（应 ≥30）`);
    }
    // S5 EQ
    if (run('S5')) {
      await page.evaluate(([s]) => window.__dj.seek('a', s), [A.groove[0]]); await sleep(300);
      const f0 = await measureBand(page, 2000); await setNorm(page, 'eq-low-a', 0); await sleep(300); const f1b = await measureBand(page, 2000); await setNorm(page, 'eq-low-a', 0.5, 0.01);
      await sleep(300); const f2 = await measureBand(page, 2000); await setNorm(page, 'eq-hi-a', 0); await sleep(300); const f3 = await measureBand(page, 2000); await setNorm(page, 'eq-hi-a', 0.5, 0.01);
      const ok = f0 && f1b && f2 && f3 && f0.low > -70 && f0.low - f1b.low >= 15 && Math.abs(f0.mid - f1b.mid) <= 6 && f2.high - f3.high >= 15 && Math.abs(f2.low - f3.low) <= 6;
      rec('S5', !!ok, f0 && f3 ? `切低频：低频降 ${f1(f0.low - f1b.low)} dB（≥15）、中频变 ${f1(f1b.mid - f0.mid)} dB（≤6）；切高频：高频降 ${f1(f2.high - f3.high)} dB（≥15）、低频变 ${f1(f3.low - f2.low)} dB（≤6）` : '测不到频谱');
    }
    // S6 滤波
    if (run('S6')) {
      const g0 = await measureBand(page, 2000); await setNorm(page, 'filter-a', 0); await sleep(400); const g1 = await measureBand(page, 2000);
      await setNorm(page, 'filter-a', 0.5, 0.01); await sleep(300); const g2 = await measureBand(page, 2000); await setNorm(page, 'filter-a', 1); await sleep(400); const g3 = await measureBand(page, 2000); await setNorm(page, 'filter-a', 0.5, 0.01);
      const ok = g0 && g1 && g2 && g3 && g0.high - g1.high >= 15 && g2.low - g3.low >= 15;
      rec('S6', !!ok, g0 && g3 ? `滤波拧到最小（低通）高频降 ${f1(g0.high - g1.high)} dB；拧到最大（高通）低频降 ${f1(g2.low - g3.low)} dB（都应 ≥15）` : '测不到频谱');
    }
    // S7 每首曲子的真实速度
    if (run('S7')) {
      const bad = []; const list = sab.noise || sab.badbpm ? tracks.slice(0, 2) : tracks;
      for (const t of list) {
        await load(page, 'a', t.id); await setVal(page, 'pitch-a', 0, 0.01);
        await page.evaluate(([s]) => window.__dj.seek('a', s), [t.groove[0] + 1]);
        await setPlay(page, 'a', true);
        await sleep(800); const m = await measureBpm(page, 11000, t.bpm); const s = await st(page);
        const shown = parseFloat(((await page.locator(tid('bpm-a')).innerText()).match(/\d+(\.\d+)?/) || [])[0]);
        const ok = m.ok && !m.edge && m.strength >= 0.1 && pct(m.bpm, t.bpm) <= 0.5 && pct(s.a.bpm, m.bpm) <= 0.5 && Math.abs(shown - s.a.bpm) <= 0.15;
        console.log(`   [${t.id}] 标 ${t.bpm} 实测 ${m.ok ? m.bpm.toFixed(2) : m.why} 强度 ${m.strength?.toFixed(2)}${m.edge ? ' 贴边' : ''} 状态 ${s.a.bpm?.toFixed?.(2)} 显示 ${shown}`);
        if (!ok) bad.push(t.id);
      }
      rec('S7', !bad.length, bad.length ? `速度对不上：${bad.join(',')}（标称、声音实测、状态、显示须互差 ≤0.5%）` : `${list.length} 首声音实测速度与标称相差都 ≤0.5%`);
    }
    // S8 变速
    if (run('S8')) {
      await load(page, 'a', A.id); await page.evaluate(([s]) => window.__dj.seek('a', s), [A.groove[0] + 1]);
      await setPlay(page, 'a', true);
      const a = await aria(page, 'pitch-a'); await page.locator(tid('pitch-a')).focus(); await page.keyboard.press('End'); await sleep(600);
      const exp = A.bpm * (1 + a.max / 100); const m = await measureBpm(page, 11000, exp); const s = await st(page);
      const ok = a.min <= -8 && a.max >= 8 && m.ok && !m.edge && pct(m.bpm, exp) <= 0.5 && pct(s.a.bpm, exp) <= 0.5;
      rec('S8', ok, `pitch 范围 ${a.min}…${a.max}；推到 +${a.max}% 期望 ${exp.toFixed(2)}，声音实测 ${m.ok ? m.bpm.toFixed(2) : m.why}，状态 ${s.a.bpm?.toFixed?.(2)}`);
      await setVal(page, 'pitch-a', 0, 0.01);
    }
    // S9 同步
    if (run('S9')) {
      await load(page, 'a', A.id); await load(page, 'b', B.id); await setVal(page, 'pitch-a', 0, 0.01); await setVal(page, 'pitch-b', 0, 0.01);
      await page.evaluate(([x, y]) => { window.__dj.seek('a', x); window.__dj.seek('b', y); }, [A.groove[0] + 1, B.groove[0] + 1.23]);
      await setPlay(page, 'a', true);
      await setPlay(page, 'b', true);
      await setNorm(page, 'xfader', 0.5, 0.02); await sleep(500);
      await page.locator(tid('sync-b')).click(); await sleep(1000);
      const ph = s => { const x = Math.abs(s.a.phase - s.b.phase) % 1; return Math.min(x, 1 - x); };
      const s1 = await st(page); await sleep(6000); const s2 = await st(page);
      await setNorm(page, 'xfader', 1); await sleep(500); const m = await measureBpm(page, 10000, s2.a.bpm);
      const ok = Math.abs(s1.b.bpm - s1.a.bpm) <= 0.05 && ph(s1) <= 0.03 && ph(s2) <= 0.05 && m.ok && !m.edge && pct(m.bpm, s2.a.bpm) <= 0.5;
      rec('S9', ok, `A ${A.bpm} / B ${B.bpm} 按 B 的 sync：速度差 ${Math.abs(s1.b.bpm - s1.a.bpm).toFixed(3)}（≤0.05），拍位差 ${ph(s1).toFixed(3)} → 6 秒后 ${ph(s2).toFixed(3)}（≤0.03/0.05），单听 B 声音实测 ${m.ok ? m.bpm.toFixed(2) : m.why}（应≈${s2.a.bpm.toFixed(2)}）`);
      await setPlay(page, 'b', false);
      await setNorm(page, 'xfader', 0); await setVal(page, 'pitch-b', 0, 0.01);
    }
    // S10 循环
    if (run('S10')) {
      await page.evaluate(([s]) => window.__dj.seek('a', s), [A.groove[0] + 2]);
      await setPlay(page, 'a', true);
      await sleep(300); await page.locator(tid('loop-a')).click(); await sleep(250); const on = await pressed(page, 'loop-a');
      const ps = []; for (let i = 0; i < 24; i++) { ps.push((await st(page)).a.position); await sleep(250); }
      const span = Math.max(...ps) - Math.min(...ps), beat = 60 / A.bpm, wrapped = ps.some((p, i) => i && p < ps[i - 1] - 0.2);
      await page.locator(tid('loop-a')).click(); await sleep(250); const off = !(await pressed(page, 'loop-a'));
      const p0 = (await st(page)).a.position; await sleep(5 * beat * 1000); const p1 = (await st(page)).a.position;
      const ok = on && wrapped && span <= 4 * beat + 0.15 && off && p1 - p0 > 4 * beat * 0.9;
      rec('S10', ok, `开循环 aria-pressed=${on}，6 秒内位置在 ${span.toFixed(2)}s 范围里来回（≤4 拍 ${(4 * beat).toFixed(2)}s）绕回=${wrapped}；关掉后继续往前 ${(p1 - p0).toFixed(2)}s`);
    }
    // S11 热点
    if (run('S11')) {
      await setPlay(page, 'a', true);
      const p0 = (await st(page)).a.position; await page.locator(tid('hotcue-a-1')).click(); const p1 = (await st(page)).a.position;
      await sleep(3000); const p2 = (await st(page)).a.position; await page.locator(tid('hotcue-a-1')).click(); const p3 = (await st(page)).a.position;
      const ok = p2 - p1 > 2 && Math.abs(p3 - (p0 + p1) / 2) <= 0.35;
      rec('S11', ok, `设热点于 ${p1.toFixed(2)}s，3 秒后到 ${p2.toFixed(2)}s，再按跳回 ${p3.toFixed(2)}s`);
    }
    // S12 搓碟
    if (run('S12')) {
      await setPlay(page, 'a', false);
      await sleep(400); const p0 = (await st(page)).a.position; const tq = await now(page);
      await jog(page, 'a', [180], 20); const p1 = (await st(page)).a.position; const tq1 = await now(page);
      await jog(page, 'a', [-180], 20); const p2 = (await st(page)).a.position;
      const loud = await page.evaluate(([a, b]) => window.__probe.rms(a, b), [tq, tq1 + 0.05]);
      const ok = p1 - p0 > 0.05 && p1 - p2 > 0.05 && loud.peak > -40;
      rec('S12', ok, `暂停时顺转半圈 位置 ${p0.toFixed(2)}→${p1.toFixed(2)}，逆转回 ${p2.toFixed(2)}；搓的时候最大音量 ${f1(loud.peak)} dBFS（应 > −40）`);
    }
    // S13 鼠标拖
    if (run('S13')) {
      const bad = [];
      const dragTo = async (id, dx, dy) => { const c = await center(page, id); await page.mouse.move(c.x, c.y); await page.mouse.down(); const n = 12; for (let i = 1; i <= n; i++) await page.mouse.move(c.x + dx * i / n, c.y + dy * i / n); await page.mouse.up(); await sleep(100); return aria(page, id); };
      let a = await aria(page, 'xfader'); const bx = (await center(page, 'xfader')).b.width;
      let r = await dragTo('xfader', bx, 0); if (r.now !== r.max) bad.push('xfader 往右拖没到最大'); r = await dragTo('xfader', -bx, 0); if (r.now !== r.min) bad.push('xfader 往左拖没到最小');
      const by = (await center(page, 'vol-a')).b.height;
      r = await dragTo('vol-a', 0, by); if (r.now !== r.min) bad.push('vol-a 往下拖没到最小'); r = await dragTo('vol-a', 0, -by); if (r.now !== r.max) bad.push('vol-a 往上拖没到最大');
      for (const k of ['eq-low-a', 'filter-b']) { r = await dragTo(k, 0, -260); if (r.now !== r.max) bad.push(k + ' 往上拖 260px 没到最大'); r = await dragTo(k, 0, 520); if (r.now !== r.min) bad.push(k + ' 往下拖没到最小'); await setNorm(page, k, 0.5, 0.01); }
      a = await aria(page, 'pitch-a'); const pc = await center(page, 'pitch-a'); const horiz = a.orient === 'horizontal'; const span = horiz ? pc.b.width : pc.b.height;
      const e1 = await dragTo('pitch-a', horiz ? span : 0, horiz ? 0 : span), e2 = await dragTo('pitch-a', horiz ? -span : 0, horiz ? 0 : -span);
      if (!([e1.now, e2.now].includes(a.min) && [e1.now, e2.now].includes(a.max))) bad.push('pitch-a 两头拖不到头');
      await setVal(page, 'pitch-a', 0, 0.01); await setNorm(page, 'xfader', 0); await setNorm(page, 'vol-a', 1);
      rec('S13', !bad.length, bad.length ? bad.join('；') : '推子、旋钮、变速推子都能用鼠标拖到两头');
    }
    // S14 流畅
    if (run('S14')) {
      await page.evaluate(([s]) => window.__dj.seek('a', s), [A.groove[0]]);
      await setPlay(page, 'a', true);
      await setPlay(page, 'b', true);
      await sleep(500); const c = await center(page, 'xfader'); const w0 = await page.evaluate(() => performance.now());
      await page.mouse.move(c.x, c.y); await page.mouse.down();
      for (let k = 0; k < 6; k++) for (let i = 0; i <= 20; i++) { await page.mouse.move(c.x + Math.sin((k * 20 + i) / 20 * Math.PI) * c.b.width * 0.45, c.y); await sleep(20); }
      await page.mouse.up(); const w1 = await page.evaluate(() => performance.now());
      const r = await page.evaluate(([a, b]) => { const f = window.__probe.frames.filter(t => t >= a && t <= b); const iv = f.slice(1).map((t, i) => t - f[i]).sort((x, y) => x - y); return { n: iv.length, p95: iv[Math.floor(iv.length * 0.95)], max: iv[iv.length - 1], lt: window.__probe.longtasks.filter(x => x[0] >= a && x[0] <= b).length }; }, [w0, w1]);
      const ok = r.n > 60 && r.p95 <= 20 && r.max <= 70 && r.lt === 0;
      rec('S14', ok, `两台同放、来回拖交叉推子 ${((w1 - w0) / 1000).toFixed(1)}s：帧间隔 p95 ${f1(r.p95)}ms（≤20）、最大 ${f1(r.max)}ms（≤70）、卡顿长任务 ${r.lt} 个（应 0）`);
      await setPlay(page, 'a', false); await setPlay(page, 'b', false);
    }
    await page.screenshot({ path: path.join(SHOT, (sab.name ? 'prove-' + sab.name + '-' : '') + 'studio-1440.png') });
  } catch (e) { if (e.message !== 'stop') rec('S0', false, '打碟台测试中断：' + e.message.split('\n')[0]); }
  await page.context().close();
}

// ───── 组：lessons（判卷自己把每一课做一遍）─────
async function solve(page, c) {
  const d = c.deck;
  if (c.kind === 'play') { if ((await st(page))[d].playing !== c.is) await page.locator(tid(`play-${d}`)).click(); }
  else if (c.kind === 'slider') await setNorm(page, c.id, c.to, c.tol / 3);
  else if (c.kind === 'bpmMatch') {
    const o = d === 'a' ? 'b' : 'a';
    for (let i = 0; i < 4; i++) {
      const s = await st(page); if (Math.abs(s[o].bpm - s[d].bpm) <= c.tol * 0.5) break;
      const base = s[d].bpm / (1 + s[d].pitch / 100); await setVal(page, `pitch-${d}`, (s[o].bpm / base - 1) * 100, 0.02);
    }
  }
  else if (c.kind === 'sync') await page.locator(tid(`sync-${d}`)).click();
  else if (c.kind === 'loop') { if (!(await st(page))[d].loop) await page.locator(tid(`loop-${d}`)).click(); }
  else if (c.kind === 'hotcue') { await page.locator(tid(`hotcue-${d}-${c.n}`)).click(); await sleep(1500); await page.locator(tid(`hotcue-${d}-${c.n}`)).click(); }
  else if (c.kind === 'scratch') await jog(page, d, [50, -50, 50, -50, 50, -50, 50], 15);
  else if (c.kind === 'ack') await page.locator(`${tid('ack')}:visible`).first().click();
}
async function groupLessons(L) {
  const page = await newPage();
  let n = 0;
  for (const l of L || []) {
    let why = '';
    try {
      await go(page, '#/lesson/' + l.id); await waitReady(page);
      await page.waitForFunction(k => document.querySelectorAll('[data-testid="step"]').length === k, l.steps.length, { timeout: 10000 }).catch(() => { });
      const steps = page.locator(tid('step'));
      if (await steps.count() !== l.steps.length) throw new Error(`页面步数 ${await steps.count()} ≠ ${l.steps.length}`);
      for (let k = 0; k < l.steps.length; k++) {
        const s = steps.nth(k), c = l.steps[k].check, tag = `第${k + 1}步(${c.kind})`;
        const wait = async (v, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await s.getAttribute('data-state') === v) return true; await sleep(100); } return false; };
        if (!(await wait('active', 6000))) throw new Error(tag + ' 没变成当前步');
        const actives = await page.$$eval('[data-testid="step"][data-state="active"]', es => es.length);
        if (actives !== 1) throw new Error(tag + ` 同时有 ${actives} 步 active`);
        await sleep(1000); await s.click({ position: { x: 4, y: 4 } }).catch(() => { }); await sleep(300);
        if (await s.getAttribute('data-state') !== 'active') throw new Error(tag + ' 还没做就算过了');
        if (c.kind === 'quiz') {
          const ch = page.locator(`${tid('choice')}:visible`);
          await ch.nth(c.answer === 0 ? 1 : 0).click(); await sleep(800);
          if (await s.getAttribute('data-state') !== 'active') throw new Error(tag + ' 选错也算过了');
          await ch.nth(c.answer).click();
        } else await solve(page, c);
        if (!(await wait('done', 5000))) throw new Error(tag + ' 做了但 5 秒内没判过');
      }
      if (!(await page.locator(tid('lesson-complete')).isVisible())) throw new Error('全部做完没出现 lesson-complete');
      if (n === 0) await page.screenshot({ path: path.join(SHOT, 'lesson-complete-1440.png') });
      n++;
    } catch (e) { why = e.message.split('\n')[0]; }
    rec('C1:' + l.id, !why, why || `${l.steps.length} 步，判卷亲手做完，每步做之前都没被提前算过`);
  }
  await go(page, '#/'); await page.reload(); await page.waitForSelector(tid('lesson-card'), { timeout: 15000 }).catch(() => { });
  const done = await page.$$eval(tid('lesson-card'), es => es.map(e => e.getAttribute('data-done')));
  rec('C2', done.length === (L || []).length && done.filter(x => x === 'true').length === n && n === (L || []).length, `刷新后首页显示已完成 ${done.filter(x => x === 'true').length}/${done.length}（判卷做完 ${n} 课）`);
  await page.context().close();
}

// ───── 组：layout ─────
async function groupLayout(L) {
  const bad = [];
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    const page = await newPage({}, vp);
    try {
      await go(page, '#/studio'); await waitReady(page); await sleep(500); await page.evaluate(() => scrollTo(0, 0));
      for (const id of CONTROLS) {
        const b = await page.locator(tid(id)).first().boundingBox().catch(() => null);
        if (!b || b.width < 1 || b.x < 0 || b.y < 0 || b.x + b.width > vp.width + 1 || b.y + b.height > vp.height + 1) bad.push(`${vp.width}×${vp.height} ${id} 不在首屏`);
      }
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push(`${vp.width} 打碟台横向溢出`);
      await page.screenshot({ path: path.join(SHOT, `studio-${vp.width}.png`) });
    } catch (e) { bad.push(`${vp.width} 打碟台出错 ${e.message.split('\n')[0]}`); }
    await page.context().close();
  }
  const land = await newPage({}, { width: 844, height: 390 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  try {
    await go(land, '#/studio'); await waitReady(land); await sleep(500);
    if (await land.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push('844×390 打碟台横向溢出');
    for (const id of ['play-a', 'play-b', 'xfader', 'pitch-a', 'pitch-b']) { const b = await land.locator(tid(id)).first().boundingBox().catch(() => null); if (!b || b.width < 1) bad.push('844×390 看不到 ' + id); }
    await land.screenshot({ path: path.join(SHOT, 'studio-844x390.png') });
  } catch (e) { bad.push('844×390 出错 ' + e.message.split('\n')[0]); }
  await land.context().close();
  const port = await newPage({}, { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  try {
    for (const h of ['#/', '#/lesson/' + L[0].id, '#/credits']) {
      await go(port, h); await sleep(1500);
      if (await port.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push(`390×844 ${h} 横向溢出`);
    }
    await go(port, '#/'); await sleep(800); await port.screenshot({ path: path.join(SHOT, 'home-390.png'), fullPage: true });
  } catch (e) { bad.push('390×844 出错 ' + e.message.split('\n')[0]); }
  await port.context().close();
  rec('P1', !bad.length, bad.length ? bad.slice(0, 10).join('；') : '1440/1280 打碟台控件全在首屏；844×390、390×844 无横向滚动');
  // 首屏重量
  const page = await newPage(); let bytes = 0;
  page.on('requestfinished', async q => { try { const s = await q.sizes(); bytes += s.responseBodySize + s.responseHeadersSize; } catch { } });
  await go(page, '#/'); await sleep(2000);
  rec('P2', bytes > 0 && bytes <= 2e6, `首页首屏下载 ${(bytes / 1e6).toFixed(2)} MB（≤2）`);
  // 出处页
  try {
    await go(page, '#/credits'); await page.waitForSelector(tid('credit'), { timeout: 10000 });
    const T = await page.evaluate(() => fetch('data/tracks.json').then(r => r.json()));
    const cs = await page.$$eval(tid('credit'), es => es.map(e => ({ t: e.innerText, h: [...e.querySelectorAll('a')].map(a => a.href) })));
    const miss = T.filter(t => !cs.some(c => c.t.includes(t.title) && c.t.includes(t.artist) && c.h.includes(t.source)));
    rec('P3', !miss.length && cs.length === T.length, miss.length ? '出处页缺：' + miss.map(t => t.id).join(',') : `出处页 ${cs.length} 首，曲名、作者、原页链接齐`);
  } catch (e) { rec('P3', false, '出处页出错 ' + e.message.split('\n')[0]); }
  await page.context().close();
}

// ───── 组：license（联网核对每首的原页面）─────
async function groupLicense(T, swap = false) {
  const bad = [];
  for (const [i, t] of (T || []).entries()) {
    const src = swap && i === 0 ? CCBY_PAGE : t.source; let txt = null, code = 0;
    for (let k = 0; k < 3 && txt == null; k++) { try { const r = await fetch(src, { headers: { 'user-agent': UA }, redirect: 'follow' }); code = r.status; if (r.ok) txt = await r.text(); } catch (e) { code = e.message; } if (txt == null) await sleep(1500); }
    if (txt == null) { bad.push(`[${t.id}] 原页打不开 ${code}`); continue; }
    const u = txt.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/\\\//g, '/');
    if (!u.includes('creativecommons.org/publicdomain/zero/1.0')) bad.push(`[${t.id}] 原页没有 CC0 标记`);
    if (u.includes('creativecommons.org/licenses/by')) bad.push(`[${t.id}] 原页出现署名类许可`);
    if (!u.includes(t.origFile)) bad.push(`[${t.id}] 原页找不到 ${t.origFile}`);
  }
  rec('L1', !bad.length && (T || []).length > 0, bad.length ? bad.slice(0, 10).join('；') : `${T.length} 首原页都写着 CC0，文件名对得上`);
}

// ───── 主流程 ─────
async function main() {
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  if (urlArg) BASE = urlArg.endsWith('/') ? urlArg : urlArg + '/';
  else { srv = await serve(); BASE = `http://127.0.0.1:${srv.address().port}${SUB}`; }
  await fs.promises.mkdir(SHOT, { recursive: true });
  console.log('站点', BASE);
  if (PROVE) return prove();
  const { T, L } = await groupData();
  if (urlArg) {
    for (const f of ['data/tracks.json', 'data/lessons.json']) {
      let same = false; try { const r = await fetch(BASE + f, { headers: { 'user-agent': UA } }); same = Buffer.compare(Buffer.from(await r.arrayBuffer()), fs.readFileSync(path.join(ROOT, f))) === 0; } catch { }
      rec('U:' + f, same, same ? '线上与本地逐字节相同' : '线上与本地不一致');
    }
  }
  if (want('home') && L) await groupHome(L);
  if (want('studio') && T) await groupStudio(T);
  if (want('lessons') && L) await groupLessons(L);
  if (want('layout') && L) await groupLayout(L);
  if (want('license') && T) await groupLicense(T);
  rec('N1', netBad.size === 0, netBad.size ? '请求了外域：' + [...netBad].slice(0, 5).join(' ') : '全程没有请求外域');
  rec('N2', conErr.length === 0, conErr.length ? '控制台报错：' + conErr.slice(0, 5).join(' | ') : '全程控制台无报错');
}
async function prove() {
  const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tracks.json'), 'utf8'));
  const cases = [
    { sab: { name: 'silence', silence: true }, fn: () => groupStudio(T, { name: 'silence', silence: true }, ['S3']), expect: ['S3'] },
    { sab: { name: 'noise', noise: true }, fn: () => groupStudio(T, { name: 'noise', noise: true }, ['S4', 'S5', 'S6', 'S7']), expect: ['S4', 'S5', 'S6', 'S7'] },
    { sab: { name: 'badbpm', badbpm: true }, fn: () => groupStudio(T, { name: 'badbpm', badbpm: true }, ['S7']), expect: ['S7'] },
    { sab: { name: 'jank', jank: true }, fn: () => groupStudio(T, { name: 'jank', jank: true }, ['S14']), expect: ['S14'] },
    { name: 'ext', fn: async () => { const p = await newPage({ ext: true }); await go(p, '#/'); await sleep(2500); await p.context().close(); rec('N1', netBad.size === 0, '外域请求 ' + netBad.size); }, expect: ['N1'] },
    { name: 'conerr', fn: async () => { const p = await newPage({ conerr: true }); await go(p, '#/'); await sleep(1500); await p.context().close(); rec('N2', conErr.length === 0, '控制台报错 ' + conErr.length); }, expect: ['N2'] },
    { name: 'license', fn: () => groupLicense(T.slice(0, 1), true), expect: ['L1'] },
  ];
  let slipped = 0;
  for (const c of cases) {
    const nm = c.name || c.sab.name; console.log(`\n── 注入破坏：${nm} ──`);
    results = []; netBad.clear(); conErr.length = 0;
    await c.fn();
    for (const id of c.expect) {
      const r = results.find(x => x.id === id);
      if (!r) { console.log(`!! ${nm}：${id} 没跑出结果`); slipped++; }
      else if (r.ok) { console.log(`!! ${nm}：${id} 被破坏了却仍 PASS —— 检查失灵`); slipped++; }
      else console.log(`OK ${nm}：${id} 正确变红`);
    }
  }
  console.log(slipped ? `\n反向验证不成立：${slipped} 处破坏没被抓到` : '\n反向验证成立：每种破坏都被抓到');
  return slipped ? 2 : 1;
}
let code;
try { const r = await main(); code = PROVE ? r : (results.length && results.every(x => x.ok) ? 0 : 1); }
catch (e) { console.error('验收脚本出错：', e); code = PROVE ? 2 : 1; }
if (!PROVE) console.log(`\n合计 ${results.filter(x => x.ok).length}/${results.length} PASS`);
await browser?.close(); srv?.close();
process.exit(code);
