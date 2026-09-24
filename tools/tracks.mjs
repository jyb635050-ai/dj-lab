// 曲库工具（不是判卷）。
//   node tools/tracks.mjs scan <FMA 专辑或艺人页网址>...   列出曲目、核对每首曲目页是 CC0、下载到 tools/cache/、离线测速，结果并入 tools/cache/scan.json
//   node tools/tracks.mjs report                           按"能不能用"排序打印 scan.json
//   node tools/tracks.mjs build                            按 tools/picks.json 转码到 audio/ 并生成 data/tracks.json
// 测速算法与判卷 accept.mjs 的 P.bpm 相同：48kHz、512 样本块、150Hz 双低通包络的起音强度、8 拍间隔自相关＋抛物线插值。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools/cache');
const SCAN = path.join(CACHE, 'scan.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SR = 48000, BL = 512, DT = BL / SR;
fs.mkdirSync(CACHE, { recursive: true });
const unesc = s => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/\\\//g, '/');
const get = async u => { for (let k = 0; k < 3; k++) { try { const r = await fetch(u, { headers: { 'user-agent': UA } }); if (r.ok) return r; } catch { } await new Promise(r => setTimeout(r, 1500)); } throw new Error('fetch failed ' + u); };

// ───── 音频分析 ─────
export function envelope(file) {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  let x = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  const w = 2 * Math.PI * 150 / SR, a = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), b0 = (1 - c) / 2, b1 = 1 - c, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  for (let p = 0; p < 2; p++) { const o = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; o[i] = v; } x = o; }
  const n = Math.floor(x.length / BL), env = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < BL; j++) s += x[i * BL + j] ** 2; env[i] = Math.sqrt(s / BL); }
  return env;
}
function onset(env, t0, t1) {
  const i0 = Math.max(1, Math.floor(t0 / DT)), i1 = Math.min(env.length, Math.floor(t1 / DT)); const d = [];
  for (let i = i0; i < i1; i++) d.push(Math.max(env[i] - env[i - 1], 0));
  const m = d.reduce((a, b) => a + b, 0) / d.length; return d.map(v => v - m);
}
const acf = (d, k) => { let s = 0; for (let i = 0; i + k < d.length; i++) s += d[i] * d[i + k]; return s / (d.length - k); };
export function bpmAt(env, t0, t1, expect, beats = 8, win = 0.04) {
  const d = onset(env, t0, t1), e0 = acf(d, 0); if (!(e0 > 0)) return { bpm: 0, s: 0, edge: true };
  const kLo = Math.floor(beats * 60 / (expect * (1 + win)) / DT), kHi = Math.ceil(beats * 60 / (expect * (1 - win)) / DT);
  let bk = kLo, bv = -Infinity; const v = {};
  for (let k = kLo - 1; k <= kHi + 1; k++) { v[k] = acf(d, k); if (k >= kLo && k <= kHi && v[k] > bv) { bv = v[k]; bk = k; } }
  const den = v[bk - 1] - 2 * v[bk] + v[bk + 1], off = den < 0 ? 0.5 * (v[bk - 1] - v[bk + 1]) / den : 0;
  return { bpm: beats * 60 / ((bk + off) * DT), s: bv / e0, edge: bk === kLo || bk === kHi };
}
function coarse(env) { // 1/2/4/8 拍间隔的自相关一起打分，100–150 BPM 里找峰（只看一拍容易被切分节奏带偏）
  const d = onset(env, 0, env.length * DT); const e0 = acf(d, 0) || 1; let best = [0, -Infinity];
  const at = lag => { const k = Math.floor(lag), f = lag - k; return acf(d, k) * (1 - f) + acf(d, k + 1) * f; };
  for (let bpm = 100; bpm <= 150; bpm += 0.25) { const beat = 60 / bpm / DT; const v = at(beat) + at(2 * beat) + at(4 * beat) + at(8 * beat); if (v > best[1]) best = [bpm, v]; }
  return best[0];
}
export function analyze(file) {
  const env = envelope(file), dur = env.length * DT, c = coarse(env);
  const glob = bpmAt(env, 0, dur, c, 8, 0.03).bpm || c;
  const wins = []; for (let t = 0; t + 11 <= dur; t += 5) wins.push({ t, ...bpmAt(env, t, t + 11, glob, 8, 0.04) });
  // 最长的稳定段：相邻窗速度都在 ±0.3%、强度 ≥0.25
  let best = null, cur = null;
  for (const w of wins) {
    const ok = !w.edge && w.s >= 0.25 && Math.abs(w.bpm - glob) / glob <= 0.003;
    if (ok) { cur = cur ? { ...cur, end: w.t + 11 } : { start: w.t, end: w.t + 11 }; if (!best || cur.end - cur.start > best.end - best.start) best = cur; } else cur = null;
  }
  if (!best) return { dur, coarse: c, glob, groove: null, wins: wins.map(w => [w.t, +w.bpm.toFixed(2), +w.s.toFixed(2)]) };
  const g = bpmAt(env, best.start, best.end, glob, 16, 0.01);
  const bpm = g.bpm && !g.edge ? g.bpm : glob;
  // 第一拍：按 bpm 把起音强度折叠进一拍，找峰值相位
  const P = 60 / bpm, bins = 96, h = new Float64Array(bins);
  for (let i = Math.floor(best.start / DT) + 1; i < Math.floor(best.end / DT); i++) { const o = Math.max(env[i] - env[i - 1], 0); h[Math.floor(((i - 1) * DT % P) / P * bins) % bins] += o; }
  let bi = 0; for (let i = 1; i < bins; i++) if (h[i] > h[bi]) bi = i;
  return { dur, coarse: c, glob, bpm, groove: [best.start, best.end], firstBeat: (bi + 0.5) / bins * P, strength: g.s, wins: wins.map(w => [w.t, +w.bpm.toFixed(2), +w.s.toFixed(2)]) };
}

// ───── FMA ─────
async function albumsOf(url) {
  const html = await (await get(url)).text();
  if (html.includes('data-track-info=')) {
    const tr = [...html.matchAll(/data-track-info='(\{.*?\})'/g)].map(m => JSON.parse(unesc(m[1])));
    const isAlbum = /freemusicarchive\.org\/music\/[^/]+\/[^/]+\/?$/.test(url) && !/\/(bio|contact|discography|followers)/.test(url);
    if (isAlbum) return [{ url, tracks: tr }];
  }
  const base = url.replace(/\/?$/, '/');
  const links = [...new Set([...html.matchAll(/href="(https:\/\/freemusicarchive\.org\/music\/[^/"]+\/[^/"]+)\/?"/g)].map(m => m[1]))].filter(u => u.startsWith(base.slice(0, -1)) && !/\/(bio|contact|discography|followers)$/.test(u));
  const out = [];
  for (const l of links) { const h = await (await get(l)).text(); out.push({ url: l, tracks: [...h.matchAll(/data-track-info='(\{.*?\})'/g)].map(m => JSON.parse(unesc(m[1]))) }); }
  return out;
}
async function scan(urls) {
  const db = fs.existsSync(SCAN) ? JSON.parse(fs.readFileSync(SCAN, 'utf8')) : {};
  for (const u of urls) {
    for (const al of await albumsOf(u)) {
      for (const t of al.tracks) {
        const key = t.fileName; if (db[key]?.analysis || db[key]?.skip) continue;
        const rec = { title: t.title, artist: t.artistName, album: al.url, source: t.url, fileUrl: t.fileUrl, fileName: t.fileName };
        try {
          const page = unesc(await (await get(t.url)).text());
          rec.cc0 = page.includes('creativecommons.org/publicdomain/zero/1.0') && !page.includes('creativecommons.org/licenses/by') && page.includes(t.fileName);
          if (!rec.cc0) { rec.skip = '不是 CC0'; db[key] = rec; console.log('跳过（非 CC0）', t.title); continue; }
          const f = path.join(CACHE, t.fileName);
          if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(await (await get(t.fileUrl)).arrayBuffer()));
          rec.analysis = analyze(f);
          const a = rec.analysis; console.log(`${t.title.padEnd(40)} ${a.bpm ? a.bpm.toFixed(2) : '—'} groove ${a.groove ? a.groove.join('–') : '无'} 强度 ${a.strength?.toFixed(2) ?? '-'}`);
        } catch (e) { rec.skip = e.message; console.log('出错', t.title, e.message); }
        db[key] = rec; fs.writeFileSync(SCAN, JSON.stringify(db, null, 1));
      }
    }
  }
}
function report() {
  const db = JSON.parse(fs.readFileSync(SCAN, 'utf8'));
  const rows = Object.values(db).filter(r => r.analysis?.groove).map(r => ({ ...r, len: r.analysis.groove[1] - r.analysis.groove[0] })).sort((a, b) => a.analysis.bpm - b.analysis.bpm);
  for (const r of rows) console.log(`${r.analysis.bpm.toFixed(2).padStart(7)}  groove ${String(r.analysis.groove[0]).padStart(3)}–${String(r.analysis.groove[1]).padEnd(4)} (${String(r.len).padStart(3)}s) s=${r.analysis.strength.toFixed(2)} dur ${r.analysis.dur.toFixed(0).padStart(3)}  ${r.artist} — ${r.title}  [${r.fileName}]`);
  console.log(`可用 ${rows.filter(r => r.len >= 30).length} / 已扫 ${Object.keys(db).length}`);
}
function build() {
  const db = JSON.parse(fs.readFileSync(SCAN, 'utf8')), picks = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/picks.json'), 'utf8'));
  fs.mkdirSync(path.join(ROOT, 'audio'), { recursive: true });
  const out = [];
  for (const p of picks) {
    const r = db[p.fileName]; if (!r?.cc0) throw new Error('不是已核实的 CC0：' + p.fileName);
    const a = r.analysis, cut = p.cut || a.dur, file = `audio/${p.id}.mp3`, dst = path.join(ROOT, file);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(CACHE, p.fileName), '-t', String(cut), '-af', `afade=t=out:st=${cut - 3}:d=3`, '-ac', '2', '-ar', '44100', '-b:a', '128k', dst]);
    // 转码后按同算法复测，数据以复测为准
    const b = analyze(dst), g = p.groove || b.groove;
    const bpm = bpmAt(envelope(dst), g[0], g[1], a.bpm, 16, 0.01).bpm;
    out.push({ id: p.id, title: r.title, artist: r.artist, file, bpm: +bpm.toFixed(2), firstBeat: +b.firstBeat.toFixed(3), groove: [g[0], Math.min(g[1], Math.floor(cut) - 4)], duration: +b.dur.toFixed(1), license: 'CC0-1.0', source: r.source, origFile: r.fileName });
    console.log(`${p.id} ${bpm.toFixed(2)} groove ${g.join('–')} ${(fs.statSync(dst).size / 1e6).toFixed(1)}MB`);
  }
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data/tracks.json'), JSON.stringify(out, null, 1) + '\n');
}
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'scan') await scan(rest); else if (cmd === 'report') report(); else if (cmd === 'build') build(); else if (cmd === 'rescan') { const db = JSON.parse(fs.readFileSync(SCAN, 'utf8')); for (const r of Object.values(db)) { const f = path.join(CACHE, r.fileName || ''); if (!r.cc0 || !fs.existsSync(f)) continue; r.analysis = analyze(f); } fs.writeFileSync(SCAN, JSON.stringify(db, null, 1)); report(); }
else if (cmd === 'analyze') console.log(JSON.stringify(analyze(rest[0]), null, 1));
