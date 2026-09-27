// 本地导入 + 录音导出 端到端自测（不是判卷）
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire('C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const ROOT = 'D:/blender/DJLab', CACHE = ROOT + '/tools/cache';
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (f === path.join(ROOT, '/') || f.endsWith(path.sep)) f = path.join(ROOT, 'index.html'); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(8796);
const want = { 'Loyalty_Freak_Music_-_09_-_Hello_Michael_.mp3': 130.0, 'Loyalty_Freak_Music_-_07_-_Sweet_Me.mp3': 120.0, 'Loyalty_Freak_Music_-_06_-_People_are_spinning.mp3': 110.01, 'Komiku_-_15_-_Intensive_puzzle_resolution.mp3': 122.64 };
// 再造一个 wav 测格式
const { execFileSync } = await import('node:child_process');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(CACHE, 'Loyalty_Freak_Music_-_02_-_Friend_to_friend.mp3'), '-t', '60', path.join(CACHE, 'friend.wav')]);
want['friend.wav'] = 130.02;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://127.0.0.1:8796/#/studio'); await page.waitForFunction(() => window.__dj?.ready);
const t0 = Date.now();
await page.setInputFiles('.mine input[type=file]', Object.keys(want).map(f => path.join(CACHE, f)));
await page.waitForFunction(n => document.querySelectorAll('.track.local').length === n, Object.keys(want).length, { timeout: 120000 });
console.log(`导入 ${Object.keys(want).length} 首用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const rows = await page.$$eval('.track.local', es => es.map(e => ({ title: e.querySelector('.t-title').innerText, bpm: +e.querySelector('.bpm-in').value })));
let bad = 0;
for (const [f, b] of Object.entries(want)) {
  const key = f.replace(/\.[^.]+$/, '').replace(/_/g, ' ').split(' - ').pop().trim(); const r = rows.find(x => x.title.includes(key)); const err = r ? Math.abs(r.bpm - b) / b * 100 : NaN;
  if (!(err <= 0.5)) bad++;
  console.log(`  ${f.padEnd(52)} 真值 ${b}  测得 ${r?.bpm}  误差 ${err.toFixed(2)}%`);
}
console.log('测速不准的首数', bad);
// 载入 A 播放
await page.locator('.track.local').first().locator('.ld-a').click();
await page.waitForFunction(() => window.__dj.state().a.track?.startsWith('local-'), null, { timeout: 20000 });
await page.click('[data-testid=play-a]'); await page.waitForTimeout(1500);
const s = await page.evaluate(() => window.__dj.state().a); console.log('A 台本地歌', s.track, '在播', s.playing, '位置', s.position.toFixed(2));
// 改 BPM ×2 再 ½
const inp = page.locator('.track.local').first().locator('.bpm-in'); const b0 = +(await inp.inputValue());
await page.locator('.track.local').first().locator('.mini').nth(1).click(); const b1 = +(await inp.inputValue());
await page.locator('.track.local').first().locator('.mini').nth(0).click(); const b2 = +(await inp.inputValue());
console.log('×2 / ½：', b0, '→', b1, '→', b2);
const tapBtn = page.locator('.track.local').first().locator('.tap');
await page.evaluate(() => new Promise(r => { const b = document.querySelector('.track.local .tap'); let i = 0; const t0 = performance.now(); const go = () => { b.click(); if (++i < 8) setTimeout(go, t0 + 500 * i - performance.now()); else r(); }; go(); }));
await page.waitForTimeout(300); console.log('TAP 8 下（间隔 500ms）→', await inp.inputValue());
await page.locator('.track.local').first().locator('.bpm-in').fill(String(b0)); await page.locator('.track.local').first().locator('.bpm-in').press('Enter'); await page.waitForTimeout(300);
console.log('手动改回 →', await inp.inputValue(), ' A 台 BPM', (await page.evaluate(() => window.__dj.state().a.bpm)).toFixed(2));
// 录 5 秒
await page.click('.rec'); await page.waitForTimeout(5200); const shown = await page.innerText('.rec-t'); await page.click('.rec');
await page.waitForSelector('.complete.export', { timeout: 10000 }); await page.waitForTimeout(900); console.log('录制中计时显示', shown);
await page.screenshot({ path: ROOT + '/shots/export-dialog.png' });
const [d1] = await Promise.all([page.waitForEvent('download'), page.locator('.complete.export .btn-primary').click()]);
const p1 = path.join(CACHE, d1.suggestedFilename()); await d1.saveAs(p1);
const [d2] = await Promise.all([page.waitForEvent('download'), page.locator('.complete.export .btn').nth(1).click()]);
const p2 = path.join(CACHE, d2.suggestedFilename()); await d2.saveAs(p2);
for (const p of [p1, p2]) { const info = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_name,channels,sample_rate', '-of', 'compact', p]).toString().trim().replace(/\n/g, ' | '); console.log(path.basename(p), (fs.statSync(p).size / 1e6).toFixed(2) + 'MB', info); }
const wav = execFileSync('ffmpeg', ['-v', 'error', '-i', p1, '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
// 刷新后本地歌还在
await page.reload(); await page.waitForFunction(() => window.__dj?.ready); await page.waitForTimeout(1500);
console.log('刷新后本地歌数', await page.locator('.track.local').count());
await page.screenshot({ path: ROOT + '/shots/studio-local.png', fullPage: true });
console.log('页面报错', errs.length ? errs : '无');
await browser.close(); srv.close();
