// 本地歌曲：文件只存在这台电脑的浏览器里（IndexedDB），不上传。导入时解码并自动测速。
import { ctx, primeBuffer } from './engine.js';

const DB = 'beatlab', STORE = 'local-tracks';
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode), s = t.objectStore(STORE); const out = fn(s); t.oncomplete = () => res(out.result ?? out); t.onerror = () => rej(t.error); });
}
const toTrack = r => ({ id: r.id, title: r.title, artist: r.artist, blob: r.blob, bpm: r.bpm, firstBeat: r.firstBeat, duration: r.duration, local: true });

export async function listLocal() {
  try { const rows = await tx('readonly', s => s.getAll()); return rows.sort((a, b) => a.added - b.added).map(toTrack); } catch { return []; }
}
export async function saveLocal(t) { try { await tx('readwrite', s => s.put({ id: t.id, title: t.title, artist: t.artist, blob: t.blob, bpm: t.bpm, firstBeat: t.firstBeat, duration: t.duration, added: t.added || Date.now() })); } catch { } }
export async function deleteLocal(id) { try { await tx('readwrite', s => s.delete(id)); } catch { } }

// 「Loyalty_Freak_Music_-_09_-_Hello_Michael_.mp3」→ 艺人 Loyalty Freak Music / 歌名 Hello Michael
export function splitName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = base.split(/\s+[-–—]\s+/).map(x => x.trim()).filter(x => x && !/^\d{1,3}$/.test(x));
  return parts.length >= 2 ? { artist: parts[0], title: parts.slice(1).join(' - ') } : { artist: '', title: base || name };
}
// 导入一个文件：解码 → 测速 → 存库
export async function importFile(file) {
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  await new Promise(r => setTimeout(r, 0));
  const { bpm, firstBeat } = detectTempo(buf);
  const t = { id: 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...splitName(file.name), blob: file, bpm: +bpm.toFixed(2), firstBeat: +firstBeat.toFixed(3), duration: +buf.duration.toFixed(1), local: true, added: Date.now() };
  primeBuffer(t, buf);
  await saveLocal(t);
  return t;
}

// ───── 测速：和曲库工具同一套办法（150Hz 低频包络的起音强度，1/2/4/8 拍间隔自相关打分，再用 8 拍间隔精修）─────
export function detectTempo(buf) {
  const sr = buf.sampleRate, BL = 512, DT = BL / sr;
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  // 最多分析中间 150 秒，够准也够快
  const span = Math.min(buf.length, Math.round(150 * sr)), start = Math.max(0, Math.round((buf.length - span) / 2));
  const w = 2 * Math.PI * 150 / sr, a = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), b0 = (1 - c) / 2, b1 = 1 - c, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
  const n = Math.floor(span / BL), env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0, p = start + i * BL; j < BL; j++, p++) {
      const x = (L[p] + R[p]) * 0.5;
      const y = (b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y;
      const z = (b0 * y + b1 * u1 + b0 * u2 - a1 * z1 - a2 * z2) / a0; u2 = u1; u1 = y; z2 = z1; z1 = z;
      acc += z * z;
    }
    env[i] = Math.sqrt(acc / BL);
  }
  const d = new Float32Array(n - 1); let m = 0;
  for (let i = 1; i < n; i++) { d[i - 1] = Math.max(env[i] - env[i - 1], 0); m += d[i - 1]; }
  m /= d.length; for (let i = 0; i < d.length; i++) d[i] -= m;
  curves.set(buf, { d, m, t0: start / sr, DT });
  const acf = k => { let s = 0; for (let i = 0; i + k < d.length; i++) s += d[i] * d[i + k]; return s / (d.length - k); };
  const at = lag => { const k = Math.floor(lag), f = lag - k; return acf(k) * (1 - f) + acf(k + 1) * f; };
  let best = [120, -Infinity];
  // 1/2/4/8/16 拍间隔一起打分（小节级的重复最可靠），再乘一个轻微的先验：舞曲大多在 100–140 BPM
  for (let bpm = 85; bpm <= 175; bpm += 0.5) {
    const beat = 60 / bpm / DT; if (16 * beat + 2 >= d.length) continue;
    const v = at(beat) + at(2 * beat) + at(4 * beat) + at(8 * beat) + at(16 * beat), q = Math.log2(bpm / 120) / 0.35;
    const sc = v > 0 ? v * Math.exp(-0.5 * q * q) : v; if (sc > best[1]) best = [bpm, sc];
  }
  const g = best[0], kLo = Math.floor(480 / (g * 1.02) / DT), kHi = Math.ceil(480 / (g * 0.98) / DT);
  let bk = kLo, bv = -Infinity; const v = {};
  for (let k = kLo - 1; k <= kHi + 1; k++) { v[k] = acf(k); if (k >= kLo && k <= kHi && v[k] > bv) { bv = v[k]; bk = k; } }
  const den = v[bk - 1] - 2 * v[bk] + v[bk + 1], off = den < 0 ? 0.5 * (v[bk - 1] - v[bk + 1]) / den : 0;
  let bpm = 480 / ((bk + off) * DT); if (!(bpm > 60 && bpm < 200)) bpm = g;
  return { bpm, firstBeat: phaseFor(buf, bpm) };
}
// 第一拍：把起音强度按拍长折叠，找峰值相位（改了 BPM 也要重算，不然拍子网格会错位）
const curves = new WeakMap();
export function phaseFor(buf, bpm) {
  if (!curves.has(buf)) detectTempo(buf);
  const { d, m, t0, DT } = curves.get(buf), P = 60 / bpm, bins = 64, hist = new Float64Array(bins);
  for (let i = 0; i < d.length; i++) { const t = t0 + (i + 1) * DT; hist[Math.floor((t % P) / P * bins) % bins] += Math.max(d[i] + m, 0); }
  let bi = 0; for (let i = 1; i < bins; i++) if (hist[i] > hist[bi]) bi = i;
  return (bi + 0.5) / bins * P;
}
