// 音频引擎：两台唱机 + 混音台，全部走 Web Audio，一个 AudioContext。
export const ctx = new AudioContext({ latencyHint: 'interactive' });
const unlock = () => { if (ctx.state !== 'running') ctx.resume(); };
addEventListener('pointerdown', unlock, true);
addEventListener('keydown', unlock, true);

// 总线：不用压缩/限幅（它会随底鼓一压一放，把鼓点形状弄糊），靠留足余量防削波：两台满音量叠加也不过 0dBFS 太多
const master = ctx.createGain(); master.gain.value = 0.6;
const out = ctx.createGain(); master.connect(out); out.connect(ctx.destination); // master（干声）+ 效果器湿声 → out → 扬声器
export const masterOut = out; // 录音从这里接（含效果器）
export const masterAnalyser = ctx.createAnalyser(); masterAnalyser.fftSize = 1024; out.connect(masterAnalyser);
export const fxBus = ctx.createGain(); fxBus.gain.value = 0.5; fxBus.connect(out); // 提示音，不经过推子

const SEC_PER_TURN = 1.8; // 33⅓ 转：转盘一圈 = 1.8 秒
const bufCache = new Map();
export function fetchBuffer(track) {
  if (!bufCache.has(track.id)) {
    const bytes = track.blob ? track.blob.arrayBuffer() : fetch(track.file).then(r => { if (!r.ok) throw new Error(track.file + ' ' + r.status); return r.arrayBuffer(); });
    bufCache.set(track.id, bytes.then(a => ctx.decodeAudioData(a)));
  }
  return bufCache.get(track.id);
}
export const primeBuffer = (track, buf) => bufCache.set(track.id, Promise.resolve(buf));
export const dropBuffer = id => bufCache.delete(id);
const T = () => ctx.currentTime;
const ramp = (param, v, tc = 0.012) => param.setTargetAtTime(v, T(), tc);

export const events = [];
export const emit = (type, deck, n) => { events.push({ type, deck, n, t: performance.now() }); if (events.length > 400) events.splice(0, 100); };

export class Deck {
  constructor(name) {
    Object.assign(this, { name, track: null, buf: null, rev: null, peaks: null, playing: false, pitch: 0, bend: 1, rpm: 1, pitchRange: 8, offset: 0, t0: 0, src: null, loop: null, loopBeats: 4, quantize: false, vinyl: false, held: false, cues: Array(8).fill(null), cue: 0, loading: false, pendingPlay: false, loadSeq: 0 });
    const bq = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
    this.input = ctx.createGain(); this.trim = ctx.createGain(); this.input.connect(this.trim); // TRIM：通道输入增益
    // 三段隔离式 EQ（DJ 混音台那种）：250Hz / 2.5kHz 两个 24dB/倍频程分频点，每段一个增益，拧到底就是真的切掉
    const LR = (type, f) => { const a = bq(type, f, Math.SQRT1_2), b = bq(type, f, Math.SQRT1_2); a.connect(b); return [a, b]; };
    const [l1, l2] = LR('lowpass', 250), [h1, h2] = LR('highpass', 250), [m1, m2] = LR('lowpass', 2500), [t1, t2] = LR('highpass', 2500);
    const ap = bq('allpass', 2500, 0.5); // 低频路补一个同相位的全通，三段加起来才平
    const gl = ctx.createGain(), gm = ctx.createGain(), gh = ctx.createGain(), sum = ctx.createGain();
    this.low = { gain: gl.gain }; this.mid = { gain: gm.gain }; this.hi = { gain: gh.gain };
    this.trim.connect(l1); l2.connect(ap); ap.connect(gl); gl.connect(sum);
    this.trim.connect(h1); h2.connect(m1); m2.connect(gm); gm.connect(sum); h2.connect(t1); t2.connect(gh); gh.connect(sum);
    this.lp = bq('lowpass', 22000, 0.9); this.hp = bq('highpass', 16, 0.9);
    this.vol = ctx.createGain(); this.xf = ctx.createGain();
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 512;
    sum.connect(this.lp); this.lp.connect(this.hp);
    this.hp.connect(this.vol); this.vol.connect(this.xf); this.xf.connect(master); this.vol.connect(this.meter);
    this.meterBuf = new Float32Array(this.meter.fftSize);
  }
  get rate() { return (1 + this.pitch / 100) * this.bend * this.rpm; }
  get bpm() { return this.track ? this.track.bpm * (1 + this.pitch / 100) * this.rpm : 0; }
  get beatLen() { return 60 / this.track.bpm; }
  pos() {
    if (!this.playing) return this.offset;
    let p = this.offset + Math.max(0, T() - this.t0) * this.rate;
    if (this.loop && p >= this.loop[1]) p = this.loop[0] + (p - this.loop[0]) % (this.loop[1] - this.loop[0]);
    return Math.min(p, this.buf ? this.buf.duration : p);
  }
  phase() { if (!this.track) return 0; const x = (this.pos() - this.track.firstBeat) / this.beatLen; return ((x % 1) + 1) % 1; }
  beatIndex() { return this.track ? Math.floor((this.pos() - this.track.firstBeat) / this.beatLen + 1e-6) : 0; }
  level() { this.meter.getFloatTimeDomainData(this.meterBuf); let s = 0; for (const v of this.meterBuf) s += v * v; return Math.sqrt(s / this.meterBuf.length); }

  async load(track) {
    const seq = ++this.loadSeq;
    this.stopSrc(); this.playing = false; this.pendingPlay = false; this.loop = null;
    this.track = track; this.buf = null; this.rev = null; this.peaks = null; this.loading = true;
    this.cues = Array(8).fill(null); this.held = false; this.offset = track.firstBeat; this.cue = track.firstBeat;
    const buf = await fetchBuffer(track);
    if (seq !== this.loadSeq) return;
    this.buf = buf; this.peaks = computePeaks(buf); this.loading = false;
    emit('load', this.name);
    if (this.pendingPlay) { this.pendingPlay = false; this.start(); }
  }
  // spin＞0：黑胶电机起转，播放速度从 0 线性加到额定（期间走过的距离＝额定速度×spin/2）
  start(spin = 0) {
    if (!this.buf) return;
    unlock();
    if (this.offset >= this.buf.duration - 0.05) this.offset = this.cue;
    const s = ctx.createBufferSource(), t = T(); s.buffer = this.buf; s.playbackRate.value = this.rate;
    if (spin) { s.playbackRate.setValueAtTime(0.001, t); s.playbackRate.linearRampToValueAtTime(this.rate, t + spin); }
    if (this.loop) { s.loop = true; s.loopStart = this.loop[0]; s.loopEnd = this.loop[1]; }
    s.connect(this.input); s.start(0, this.offset); s.onended = () => { if (this.src === s) { this.offset = this.buf.duration; this.src = null; this.playing = false; } };
    this.src = s; this.t0 = t + spin / 2; this.playing = true;
  }
  // 黑胶刹车：速度在 dur 秒内降到 0，再停
  brake(dur) {
    if (!this.playing || !this.src) return;
    const s = this.src, t = T(), p = this.pos();
    this.src = null; this.playing = false;
    this.offset = Math.min(this.buf.duration - 0.05, p + this.rate * dur / 2);
    s.onended = () => s.disconnect();
    s.playbackRate.cancelScheduledValues(t); s.playbackRate.setValueAtTime(this.rate, t); s.playbackRate.linearRampToValueAtTime(0.001, t + dur);
    try { s.stop(t + dur + 0.02); } catch { }
  }
  hold() { if (this.playing) { this.brake(0.06); this.held = true; } } // 黑胶：手按住唱片
  release() { if (this.held) { this.held = false; this.start(0.1); } }
  stopSrc() { if (this.src) { const s = this.src; this.src = null; try { s.stop(); } catch { } s.disconnect(); } }
  toggle() {
    if (!this.buf) { if (this.track) this.pendingPlay = !this.pendingPlay; return; }
    if (this.vinyl) { if (this.playing || this.held) { this.held = false; this.brake(0.5); } else this.start(0.35); }
    else if (this.playing) { this.offset = this.pos(); this.stopSrc(); this.playing = false; } else this.start();
    emit(this.playing ? 'play' : 'pause', this.name);
  }
  cueBtn() { // CDJ 习惯：播放中按 = 回到 CUE 点并停；停着按 = 把当前位置设为 CUE 点
    if (!this.buf) return;
    if (this.playing) { this.stopSrc(); this.playing = false; this.offset = this.cue; }
    else this.cue = this.offset;
    emit('cue', this.name);
  }
  seek(p) {
    if (!this.buf) { this.offset = p; return; }
    p = Math.max(0, Math.min(p, this.buf.duration - 0.05));
    if (this.loop && (p < this.loop[0] || p >= this.loop[1])) this.setLoop(false);
    const was = this.playing; if (was) { this.stopSrc(); this.playing = false; }
    this.offset = p; if (was) this.start();
  }
  rebase() { if (this.playing) { this.offset = this.pos(); this.t0 = T(); } }
  applyRate() { if (this.src) this.src.playbackRate.setValueAtTime(this.rate, T()); }
  setPitch(v) { this.rebase(); this.pitch = v; this.applyRate(); }
  setBend(b) { this.rebase(); this.bend = b; this.applyRate(); }
  setLoop(on) {
    if (on && this.buf) {
      // 循环起点对齐到拍（不足 1 拍的循环对齐到对应的细分）
      const P = this.beatLen, g = P * Math.min(1, this.loopBeats), p = this.pos(), k = Math.floor((p - this.track.firstBeat) / g + 1e-6), s = Math.max(0, this.track.firstBeat + k * g);
      const e = s + this.loopBeats * P;
      this.rebase(); this.loop = [s, e];
      if (this.src) { this.src.loopStart = s; this.src.loopEnd = e; this.src.loop = true; }
      emit('loop', this.name);
    } else if (this.loop) { this.rebase(); this.loop = null; if (this.src) this.src.loop = false; }
  }
  setLoopBeats(b) {
    this.loopBeats = b;
    if (this.loop) { this.rebase(); const s = this.loop[0], e = s + b * this.beatLen; this.loop = [s, e]; if (this.src) this.src.loopEnd = e; if (this.offset >= e) this.seek(s); }
  }
  snap(p) { if (!this.quantize || !this.track) return p; const P = this.beatLen, fb = this.track.firstBeat; return Math.max(0, fb + Math.round((p - fb) / P) * P); }
  hotcue(n) {
    if (!this.buf) return;
    if (this.cues[n] == null) { this.cues[n] = this.snap(this.pos()); emit('hotcue-set', this.name, n); }
    else { this.seek(this.cues[n]); if (!this.playing) this.start(); emit('hotcue-jump', this.name, n); }
  }
  clearHotcue(n) { this.cues[n] = null; }
  sync(other) {
    if (!other.track || !this.track) return false;
    const target = (other.bpm / (this.track.bpm * this.rpm) - 1) * 100;
    if (Math.abs(target) > this.pitchRange + 0.001) return false;
    this.setPitch(target);
    if (this.playing && other.playing && this.buf) {
      const ph = other.phase(), P = this.beatLen, k = Math.round((this.pos() - this.track.firstBeat) / P - ph);
      let p = this.track.firstBeat + (k + ph) * P; if (p < 0) p += P;
      const loop = this.loop; this.stopSrc(); this.playing = false; this.offset = p; this.loop = loop && p >= loop[0] && p < loop[1] ? loop : null; this.start();
    }
    emit('sync', this.name); return true;
  }
  // 暂停时搓碟：按拖动的角度把一小段音频正放或倒放出来
  scratch(dAngle, dt) {
    if (!this.buf) return;
    const dPos = dAngle / (2 * Math.PI) * SEC_PER_TURN; if (!dPos) return;
    if (!this.rev) {
      const b = ctx.createBuffer(this.buf.numberOfChannels, this.buf.length, this.buf.sampleRate);
      for (let c = 0; c < b.numberOfChannels; c++) { const src = this.buf.getChannelData(c), dst = b.getChannelData(c), n = src.length; for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i]; } // 不用 slice，免得产生大块临时内存
      this.rev = b;
    }
    const fwd = dPos > 0, from = fwd ? this.offset : this.buf.duration - this.offset, len = Math.abs(dPos);
    const speed = Math.max(0.05, Math.min(4, len / Math.max(dt, 0.004)));
    const g = ctx.createBufferSource(), env = ctx.createGain(), t = T(), dur = len / speed;
    g.buffer = fwd ? this.buf : this.rev; g.playbackRate.value = speed;
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(1, t + 0.004); env.gain.setValueAtTime(1, t + Math.max(0.004, dur - 0.004)); env.gain.linearRampToValueAtTime(0, t + dur + 0.006);
    g.connect(env); env.connect(this.input); g.start(t, Math.max(0, Math.min(from, this.buf.duration - 0.01)), len + 0.01);
    g.onended = () => { g.disconnect(); env.disconnect(); };
    this.offset = Math.max(0, Math.min(this.buf.duration - 0.05, this.offset + dPos));
  }
  setEq(band, v) { ramp(this[band].gain, eqGain(v), 0.008); }
  setFilter(v) {
    if (v < 0.5) { ramp(this.lp.frequency, 120 * Math.pow(22000 / 120, v / 0.5)); ramp(this.hp.frequency, 16); }
    else { ramp(this.lp.frequency, 22000); ramp(this.hp.frequency, 16 * Math.pow(7000 / 16, (v - 0.5) / 0.5)); }
    const r = 0.9 + 3 * Math.abs(v - 0.5); this.lp.Q.value = this.hp.Q.value = Math.min(r, 1.8);
  }
  setVol(v) { ramp(this.vol.gain, v * v, 0.006); }
}
// EQ：中点 0dB；左半一路降到拧到底＝完全切掉；右半最多 +6dB
export const eqGain = v => v <= 0.005 ? 0 : v < 0.5 ? Math.pow(10, -30 * Math.pow((0.5 - v) / 0.5, 1.5) / 20) * Math.min(1, v / 0.08) : Math.pow(10, 6 * (v - 0.5) / 0.5 / 20);

// 波形：每 10ms 一格，存整体峰值和低频峰值
function computePeaks(buf) {
  const sr = buf.sampleRate, step = Math.round(sr / 100), n = Math.ceil(buf.length / step);
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const amp = new Float32Array(n), low = new Float32Array(n); const k = 1 - Math.exp(-2 * Math.PI * 180 / sr); let lp = 0;
  for (let i = 0; i < n; i++) {
    let a = 0, b = 0; const e = Math.min(buf.length, (i + 1) * step);
    for (let j = i * step; j < e; j++) { const m = (L[j] + R[j]) * 0.5; lp += k * (m - lp); const x = m < 0 ? -m : m, y = lp < 0 ? -lp : lp; if (x > a) a = x; if (y > b) b = y; }
    amp[i] = a; low[i] = b;
  }
  let mx = 0; for (const v of amp) if (v > mx) mx = v; mx = mx || 1;
  for (let i = 0; i < n; i++) { amp[i] /= mx; low[i] = Math.min(1, low[i] / mx * 1.3); }
  return { amp, low, rate: 100 };
}

export const A = new Deck('a'), B = new Deck('b');
export const decks = { a: A, b: B };
// 交叉推子曲线：smooth＝等功率（默认）；cut＝搓碟用的硬切，推离边上一点点就满音量
export const mix = { curve: 'smooth', x: 0.5 };
const CURVES = { smooth: x => [Math.cos(x * Math.PI / 2), Math.sin(x * Math.PI / 2)], cut: x => [x >= 0.97 ? Math.max(0, (1 - x) / 0.03) : 1, x <= 0.03 ? x / 0.03 : 1] };
export function setXfader(x) { mix.x = x; const [a, b] = CURVES[mix.curve](x); ramp(A.xf.gain, a, 0.006); ramp(B.xf.gain, b, 0.006); }
export function setCurve(c) { mix.curve = c; setXfader(mix.x); }

// ───── 节拍效果器（俱乐部机型）：从总线取一路送进效果，湿声回到 out；关掉时尾音自然消失 ─────
// 整套节点第一次切到俱乐部机型时才创建，别的机型不接进链路——不占音频线程，也不改变标准机型的声音路径
let F = null, fxLinked = false;
function buildFx() {
  const send = ctx.createGain(), wet = ctx.createGain(); send.gain.value = 0; wet.gain.value = 0.5;
  const outs = { echo: ctx.createGain(), reverb: ctx.createGain(), flanger: ctx.createGain() };
  for (const g of Object.values(outs)) { g.gain.value = 0; g.connect(wet); }
  const dly = ctx.createDelay(4), fb = ctx.createGain(), tone = ctx.createBiquadFilter(); fb.gain.value = 0.42; tone.type = 'lowpass'; tone.frequency.value = 5000;
  send.connect(dly); dly.connect(tone); tone.connect(fb); fb.connect(dly); dly.connect(outs.echo);
  const conv = ctx.createConvolver(), n = Math.round(ctx.sampleRate * 2.6), ir = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
  conv.buffer = ir; conv.connect(outs.reverb);
  const fl = ctx.createDelay(0.05), flFb = ctx.createGain(), lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
  fl.delayTime.value = 0.004; flFb.gain.value = 0.55; lfo.frequency.value = 0.25; lfoAmt.gain.value = 0.0028; lfo.connect(lfoAmt); lfoAmt.connect(fl.delayTime); lfo.start();
  send.connect(fl); fl.connect(flFb); flFb.connect(fl); fl.connect(outs.flanger);
  return { send, wet, outs, dly, conv, convOn: false, lfo };
}
export function linkFx(on) {
  if (on === fxLinked) return; fxLinked = on;
  if (on && !F) F = buildFx();
  if (!F) return;
  if (on) { master.connect(F.send); F.wet.connect(out); } else { master.disconnect(F.send); F.wet.disconnect(out); }
}
export const fx = { on: false, kind: 'echo', beats: 0.5, wet: 0.5 };
export const FX_BEATS = [0.125, 0.25, 0.5, 0.75, 1, 2];
// 效果跟着「正在出声的那台」的速度走
function fxTempo() {
  let best = null, lv = -1;
  for (const d of [A, B]) { if (!d.playing || !d.track) continue; const g = d.vol.gain.value * d.xf.gain.value; if (g > lv) { lv = g; best = d; } }
  return best ? best.bpm : (A.track ? A.bpm : 120);
}
let fxLast = '';
export function updateFx(force) {
  if (!F) return;
  const beat = 60 / fxTempo(), key = `${fx.on}|${fx.kind}|${fx.beats}|${fx.wet}|${beat.toFixed(4)}`;
  if (key === fxLast && !force) return; fxLast = key;
  if ((fx.kind === 'reverb') !== F.convOn) { F.convOn = !F.convOn; if (F.convOn) F.send.connect(F.conv); else F.send.disconnect(F.conv); }
  ramp(F.send.gain, fx.on ? 1 : 0, 0.01); ramp(F.wet.gain, fx.wet, 0.02);
  for (const [k, g] of Object.entries(F.outs)) ramp(g.gain, k === fx.kind ? (k === 'reverb' ? 0.9 : 1) : 0, 0.02);
  F.dly.delayTime.setTargetAtTime(Math.min(3.9, beat * fx.beats), T(), 0.02);
  F.lfo.frequency.setTargetAtTime(1 / Math.max(0.2, beat * fx.beats * 8), T(), 0.05);
}
const mBuf = new Float32Array(masterAnalyser.fftSize);
export function masterLevel() { const b = mBuf; masterAnalyser.getFloatTimeDomainData(b); let s = 0; for (const v of b) s += v * v; return Math.sqrt(s / b.length); }

// 过关提示音：两个柔和的正弦音
export function chime(kind = 'step') {
  unlock(); const t = T() + 0.01; const notes = kind === 'win' ? [523.25, 659.25, 783.99, 1046.5] : kind === 'bad' ? [220, 196] : [659.25, 987.77];
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = kind === 'bad' ? 'triangle' : 'sine'; o.frequency.value = f;
    const s = t + i * (kind === 'win' ? 0.09 : 0.07); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(kind === 'bad' ? 0.18 : 0.28, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
    o.connect(g); g.connect(fxBus); o.start(s); o.stop(s + 0.55); o.onended = () => { o.disconnect(); g.disconnect(); };
  });
}
