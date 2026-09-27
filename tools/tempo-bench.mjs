// 浏览器端自动测速的准确率：拿离线工具测出"稳定段 ≥60 秒"的曲子当真值
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire('C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const ROOT = 'D:/blender/DJLab';
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg' };
const srv = http.createServer((q, r) => { let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep)) f = path.join(ROOT, 'index.html'); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(8795);
const db = JSON.parse(fs.readFileSync(ROOT + '/tools/cache/scan.json', 'utf8'));
const truth = Object.values(db).filter(r => r.analysis?.groove && r.analysis.groove[1] - r.analysis.groove[0] >= 60 && fs.existsSync(ROOT + '/tools/cache/' + r.fileName)).map(r => ({ f: r.fileName, bpm: r.analysis.bpm }));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage(); await page.goto('http://127.0.0.1:8795/index.html'); await page.waitForFunction(() => window.__dj?.ready);
let ok = 0, near = 0; const miss = [];
for (const t of truth) {
  const r = await page.evaluate(async f => { const { detectTempo } = await import('/js/local.js'); const { ctx } = await import('/js/engine.js'); const b = await ctx.decodeAudioData(await (await fetch('/tools/cache/' + encodeURIComponent(f))).arrayBuffer()); return detectTempo(b).bpm; }, t.f);
  const e = Math.abs(r - t.bpm) / t.bpm; const oct = [0.5, 2].some(k => Math.abs(r - t.bpm * k) / (t.bpm * k) < 0.005);
  if (e < 0.005) ok++; else if (oct) near++; else miss.push(`${t.f} 真 ${t.bpm.toFixed(2)} 测 ${r.toFixed(2)}`);
}
console.log(`共 ${truth.length} 首：准 ${ok}，差两倍/一半 ${near}，其他错 ${miss.length}`); miss.forEach(m => console.log('  ', m));
await browser.close(); srv.close();
