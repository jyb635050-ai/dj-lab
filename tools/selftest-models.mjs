// 机型自测（不是判卷）：四个机型截图 + 关键功能真的生效。BASE=线上网址 可测线上
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire('C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const ROOT = 'D:/blender/DJLab';
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep)) f = path.join(ROOT, 'index.html'); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(8794);
const BASE = process.env.BASE || 'http://127.0.0.1:8794/';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto(BASE + '#/studio'); await page.waitForFunction(() => window.__dj?.ready);
await page.waitForFunction(() => window.__dj.state().a.track && window.__dj.state().b.track);
const st = () => page.evaluate(() => window.__dj.state());
const E = (fn, arg) => page.evaluate(async ([src, arg]) => { const m = await import('./js/engine.js'); return new Function('m', 'arg', src)(m, arg); }, [fn, arg]);
const pick = async id => { await page.locator('.mb-btn', { hasText: { starter: 'STARTER', standard: 'STANDARD', club: 'CLUB', vinyl: 'VINYL' }[id] }).click(); await page.waitForTimeout(400); };
const vis = sel => page.locator(sel).first().isVisible();
let fail = 0; const ok = (c, msg) => { console.log(`${c ? 'OK  ' : 'BAD '} ${msg}`); if (!c) fail++; };
await page.waitForTimeout(800);

// ── 入门：一键过渡 ──
await pick('starter');
ok(await vis('.automix') && !(await vis('.fx-unit')) && !(await vis('.hot-x')), '入门：有一键过渡，没有效果器/热点 5–8');
await page.evaluate(() => window.__dj.seek('a', 30)); await page.click('[data-testid=play-a]');
await page.locator('[data-testid=xfader]').focus(); await page.keyboard.press('Home');
await page.click('.automix'); await page.waitForTimeout(700);
await page.screenshot({ path: ROOT + '/shots/model-starter.png' });
const bpmA = (await st()).a.bpm; await page.waitForTimeout(16 * 60 / bpmA * 1000 + 600);
const xf = +(await page.getAttribute('[data-testid=xfader]', 'aria-valuenow')), lowA = +(await page.getAttribute('[data-testid=eq-low-a]', 'aria-valuenow')), lowB = +(await page.getAttribute('[data-testid=eq-low-b]', 'aria-valuenow'));
const s1 = await st();
ok(xf === 1 && lowB === 0.5 && s1.b.playing && Math.abs(s1.a.bpm - s1.b.bpm) < 0.05, `入门：一键过渡 16 拍后推子=${xf}、B 低频=${lowB}、A 低频=${lowA}（结束复位）、B 在播=${s1.b.playing}、速度已同步=${Math.abs(s1.a.bpm - s1.b.bpm) < 0.05}`);
await page.click('[data-testid=play-a]'); await page.click('[data-testid=play-b]');

// ── 俱乐部：变速范围、循环长度、量化、8 热点、回声尾音 ──
await pick('club');
await page.locator('[data-testid=xfader]').focus(); await page.keyboard.press('Home'); // 一键过渡把推子推到了 B，这里推回 A
ok(await vis('.fx-unit') && await vis('.hot-x') && await vis('.range') && await vis('.trim-wrap'), '俱乐部：效果器、热点 5–8、变速范围、TRIM 都显示');
const rng = [];
for (let i = 0; i < 3; i++) { await page.locator('.deck-a .range').click(); rng.push(await page.getAttribute('[data-testid=pitch-a]', 'aria-valuemax')); }
ok(rng.join() === '16,6,10', `俱乐部：变速范围循环 ${rng.join(' → ')}`);
await page.locator('.deck-a .range').click(); // 到 ±16
await page.locator('[data-testid=pitch-a]').focus(); await page.keyboard.press('End');
ok(Math.abs((await st()).a.pitch - 16) < 0.01, `俱乐部：±16% 范围推到头 pitch=${(await st()).a.pitch}`);
await page.keyboard.press('Home'); for (let i = 0; i < 2; i++) await page.locator('.deck-a .range').click(); // 回 ±10，夹到 −10
ok(Math.abs((await st()).a.pitch + 6) < 0.01, `俱乐部：−16 经过 ±6 档被夹到 ${(await st()).a.pitch}（再切 ±10 保持）`);
await page.locator('[data-testid=pitch-a]').focus(); for (let i = 0; i < 500; i++) { if (Math.abs((await st()).a.pitch) < 0.01) break; await page.keyboard.press('ArrowUp'); }
for (let i = 0; i < 2; i++) await page.locator('.deck-a .loop-len .ll').nth(1).click(); // 4 → 16
await page.evaluate(() => window.__dj.seek('a', 40)); await page.click('[data-testid=play-a]'); await page.waitForTimeout(300);
await page.click('[data-testid=loop-a]'); await page.waitForTimeout(200);
const L = await E('const a = m.A; return [a.loop[1] - a.loop[0], a.beatLen];');
ok(Math.abs(L[0] - 16 * L[1]) < 1e-6, `俱乐部：循环长度 16 拍 = ${L[0].toFixed(3)}s（每拍 ${L[1].toFixed(3)}s）`);
await page.click('[data-testid=loop-a]');
await page.click('[data-testid=hotcue-a-6]'); await page.waitForTimeout(100);
const q = await E('const a = m.A, P = a.beatLen, x = (a.cues[5] - a.track.firstBeat) / P; return [a.cues[5], Math.abs(x - Math.round(x))];');
ok(q[0] != null && q[1] < 1e-6, `俱乐部：量化开着，热点 6 设在 ${q[0]?.toFixed(3)}s，离拍子 ${(q[1] * 1000).toFixed(3)}‰ 拍`);
await page.screenshot({ path: ROOT + '/shots/model-club.png' });
// 回声：开 FX 后暂停，尾音还在；关 FX 暂停则立刻安静
const tail = async on => { if (on !== (await page.getAttribute('.fx-on', 'aria-pressed') === 'true')) await page.click('.fx-on'); if (!(await st()).a.playing) await page.click('[data-testid=play-a]'); await page.waitForTimeout(1500); await page.click('[data-testid=play-a]'); await page.waitForTimeout(250); return E('return m.masterLevel();'); };
const withFx = await tail(true), noFx = await tail(false);
ok(withFx > 0.003 && noFx < 0.0005, `俱乐部：回声开时暂停后 250ms 仍有声 ${(20 * Math.log10(withFx + 1e-9)).toFixed(1)}dB；关掉时 ${(20 * Math.log10(noFx + 1e-9)).toFixed(1)}dB`);

// ── 黑胶：没有波形/SYNC，起转/按住即停/45 转/硬切 ──
await page.click('.fx-on').catch(() => { }); await pick('vinyl');
ok(!(await vis('.deck-a .wave-wrap')) && !(await vis('[data-testid=sync-a]')) && !(await vis('[data-testid=bpm-a]')) && await vis('.tonearm') && await vis('.rpm'), '黑胶：没有波形、SYNC、BPM 读数；有唱臂和 33/45');
await page.evaluate(() => window.__dj.seek('a', 50)); const p0 = (await st()).a.position;
await page.click('[data-testid=play-a]'); await page.waitForTimeout(1000); const p1 = (await st()).a.position;
ok(p1 - p0 > 0.75 && p1 - p0 < 0.9, `黑胶：电机起转，按下 1 秒走了 ${(p1 - p0).toFixed(3)}s（全速应 1.0，起转少 ~0.17）`);
const jb = await page.locator('[data-testid=jog-a]').boundingBox();
await page.mouse.move(jb.x + jb.width / 2, jb.y + 20); await page.mouse.down(); await page.waitForTimeout(300);
const h1 = await st(), held = await E('return m.A.held;');
await page.mouse.up(); await page.waitForTimeout(400); const h2 = await st();
ok(!h1.a.playing && held && h2.a.playing, `黑胶：按住唱片 → 停（playing=${h1.a.playing}, held=${held}），松手 → 回转（playing=${h2.a.playing}）`);
await page.locator('.deck-a .rpm').nth(1).click(); await page.waitForTimeout(100);
ok(Math.abs((await st()).a.bpm / 120 - 1.35) < 0.01, `黑胶：45 转后速度 ${(await st()).a.bpm.toFixed(2)}（120×1.35=162）`);
await page.locator('.deck-a .rpm').nth(0).click();
await page.locator('.curve .seg').nth(1).click(); await page.locator('[data-testid=xfader]').focus(); await page.keyboard.press('Home'); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
await page.waitForTimeout(150); const g = await E('return [m.A.xf.gain.value, m.B.xf.gain.value];');
ok(g[0] > 0.99 && g[1] > 0.99, `黑胶：硬切曲线，推子 0.05 时 A=${g[0].toFixed(2)} B=${g[1].toFixed(2)}（都满）`);
await page.screenshot({ path: ROOT + '/shots/model-vinyl.png' });
await page.click('[data-testid=play-a]');

// ── 标准：切回来所有专属控件都消失、曲线复位、变速 ±8 ──
await pick('standard');
const g2 = await E('return [m.A.xf.gain.value, m.mix.curve];');
ok(!(await vis('.fx-unit')) && !(await vis('.automix')) && !(await vis('.tonearm')) && await vis('[data-testid=sync-a]') && (await page.getAttribute('[data-testid=pitch-a]', 'aria-valuemax')) === '8' && g2[1] === 'smooth', `标准：专属控件都收起，变速 ±8，曲线=${g2[1]}`);
await page.screenshot({ path: ROOT + '/shots/model-standard.png' });
// 刷新后记住机型；课程页固定标准
await pick('club'); await page.reload(); await page.waitForFunction(() => window.__dj?.ready); await page.waitForTimeout(500);
ok(await vis('.fx-unit'), '刷新后仍是俱乐部机型');
await page.goto(BASE + '#/lesson/meet-the-decks'); await page.waitForTimeout(800);
ok(!(await vis('.fx-unit')) && (await page.getAttribute('.console', 'data-model')) === 'standard', '课程页固定用标准机型');
for (const vp of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
  await page.setViewportSize(vp);
  for (const id of ['starter', 'club', 'vinyl']) {
    await page.goto(BASE + '#/studio'); await page.waitForTimeout(300); await pick(id);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `${vp.width}×${vp.height} ${id} 无横向溢出（${over}px）`);
    if (vp.width === 1280) await page.screenshot({ path: ROOT + `/shots/model-${id}-1280.png` });
  }
}
ok(errs.length === 0, '页面报错：' + (errs.join(' | ') || '无'));
console.log(fail ? `\n${fail} 项不通过` : '\n全部通过');
await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
