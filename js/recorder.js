// 录混音：从总线（交叉推子之后）接一路到 MediaStreamDestination，用 MediaRecorder 录；停下后可转成 WAV 下载。
import { ctx, masterOut } from './engine.js';

const TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
export const supported = typeof MediaRecorder !== 'undefined' && !!ctx.createMediaStreamDestination;
let dest = null, rec = null, chunks = [], t0 = 0;

export function isRecording() { return !!rec && rec.state === 'recording'; }
export function elapsed() { return isRecording() ? (performance.now() - t0) / 1000 : 0; }
export async function start() {
  if (ctx.state !== 'running') await ctx.resume();
  if (!dest) { dest = ctx.createMediaStreamDestination(); dest.channelCount = 2; masterOut.connect(dest); }
  const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
  rec = new MediaRecorder(dest.stream, { mimeType, audioBitsPerSecond: 256000 }); chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.start(1000); t0 = performance.now();
}
export function stop() {
  return new Promise(res => {
    if (!rec) return res(null);
    const r = rec; rec = null;
    r.onstop = () => { const type = r.mimeType || chunks[0]?.type || 'audio/webm'; res({ blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm', seconds: (performance.now() - t0) / 1000 }); };
    r.stop();
  });
}

// 压缩录音 → 16 位 WAV，顺便把峰值拉到 −1 dBFS
export async function toWav(blob) {
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const ch = Math.min(2, buf.numberOfChannels), len = buf.length, sr = buf.sampleRate;
  const data = []; let peak = 0;
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); data.push(d); for (let i = 0; i < len; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; } }
  const gain = peak > 0 ? Math.min(4, 0.891 / peak) : 1;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, len * ch * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i] * gain)); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}
export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
