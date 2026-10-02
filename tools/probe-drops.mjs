import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire('C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const ROOT = 'D:/blender/DJLab', MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep)) f = path.join(ROOT, 'index.html'); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(8792);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--autoplay-policy=no-user-gesture-required'] });
for (const route of process.argv.slice(2)) {
  let tot = 0, miss = 0;
  for (let k = 0; k < 3; k++) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.addInitScript(() => { const oc = AudioNode.prototype.connect; window.__g = []; AudioNode.prototype.connect = function (t, ...r) { const res = oc.call(this, t, ...r); if (t instanceof AudioDestinationNode && !t.context.__t) { const c = t.context, sp = c.createScriptProcessor(512, 1, 1), m = c.createGain(); m.gain.value = 0; oc.call(sp, m); oc.call(m, c.destination); sp.onaudioprocess = e => window.__g.push(e.playbackTime); c.__t = sp; } if (t instanceof AudioDestinationNode) oc.call(this, t.context.__t); return res; }; });
    await p.goto('http://127.0.0.1:8792/#/studio'); await p.waitForFunction(() => window.__dj?.ready); await p.waitForFunction(() => window.__dj.state().a.track && window.__dj.state().b.track);
    await p.waitForTimeout(2500);
    await p.evaluate(async () => { const m = await import('./js/engine.js'); m.A.toggle(); m.B.toggle(); });
    await p.evaluate(r => { location.hash = r; }, route); await p.waitForTimeout(500);
    await p.evaluate(() => { window.__g.length = 0; }); await p.waitForTimeout(15000);
    const r = await p.evaluate(() => { const g = window.__g; return { n: g.length, want: Math.round((g[g.length - 1] - g[0]) / (512 / 48000)) + 1 }; });
    tot += r.want; miss += r.want - r.n; await p.close();
  }
  console.log(`${route}: 3×15 秒共应 ${tot} 块，丢 ${miss} 块`);
}
await b.close(); srv.close();
