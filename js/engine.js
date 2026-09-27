// 音频引擎：两台唱机 + 混音台，全部走 Web Audio，一个 AudioContext。
export const ctx = new AudioContext({ latencyHint: 'interactive' });
const unlock = () => { if (ctx.state !== 'running') ctx.resume(); };
addEventListener('pointerdown', unlock, true);
addEventListener('keydown', unlock, true);

// 总线：不用压缩/限幅（它会随底鼓一压一放，把鼓点形状弄糊），靠留足余量防削波：两台满音量叠加也不过 0dBFS 太多
const master = ctx.createGain(); master.gain.value = 0.6;
const limiter = master; master.connect(ctx.destination);
export const masterOut = master; // 录音从这里接
export const masterAnalyser = ctx.createAnalyser(); masterAnalyser.fftSize = 1024; master.connect(masterAnalyser);
export const fxBus = ctx.createGain(); fxBus.gain.value = 0.5; fxBus.connect(limiter); // 提示音，不经过推子

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
    Object.assign(this, { name, track: null, buf: null, rev: null, peaks: null, playing: false, pitch: 0, bend: 1, offset: 0, t0: 0, src: null, loop: null, cues: [null, null, null, null], cue: 0, loading: false, pendingPlay: false, loadSeq: 0 });
    const bq = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
    this.input = ctx.createGain();
    // 三段隔离式 EQ（DJ 混音台那种）：250Hz / 2.5kHz 两个 24dB/倍频程分频点，每段一个增益，拧到底就是真的切掉
    const LR = (type, f) => { const a = bq(type, f, Math.SQRT1_2), b = bq(type, f, Math.SQRT1_2); a.connect(b); return [a, b]; };
    const [l1, l2] = LR('lowpass', 250), [h1, h2] = LR('highpass', 250), [m1, m2] = LR('lowpass', 2500), [t1, t2] = LR('highpass', 2500);
    const ap = bq('allpass', 2500, 0.5); // 低频路补一个同相位的全通，三段加起来才平
    const gl = ctx.createGain(), gm = ctx.createGain(), gh = ctx.createGain(), sum = ctx.createGain();
    this.low = { gain: gl.gain }; this.mid = { gain: gm.gain }; this.hi = { gain: gh.gain };
    this.input.connect(l1); l2.connect(ap); ap.connect(gl); gl.connect(sum);
    this.input.connect(h1); h2.connect(m1); m2.connect(gm); gm.connect(sum); h2.connect(t1); t2.connect(gh); gh.connect(sum);
    this.lp = bq('lowpass', 22000, 0.9); this.hp = bq('highpass', 16, 0.9);
    this.vol = ctx.createGain(); this.xf = ctx.createGain();
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 512;
    sum.connect(this.lp); this.lp.connect(this.hp);
    this.hp.connect(this.vol); this.vol.connect(this.xf); this.xf.connect(master); this.vol.connect(this.meter);
    this.meterBuf = new Float32Array(this.meter.fftSize);
  }
  get rate() { return (1 + this.pitch / 100) * this.bend; }
  get bpm() { return this.track ? this.track.bpm * (1 + this.pitch / 100) : 0; }
  get beatLen() { return 60 / this.track.bpm; }
  pos() {
    if (!this.playing) return this.offset;
    let p = this.offset + (T() - this.t0) * this.rate;
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
    this.cues = [null, null, null, null]; this.offset = track.firstBeat; this.cue = track.firstBeat;
    const buf = await fetchBuffer(track);
    if (seq !== this.loadSeq) return;
    this.buf = buf; this.peaks = computePeaks(buf); this.loading = false;
    emit('load', this.name);
    if (this.pendingPlay) { this.pendingPlay = false; this.start(); }
  }
  start() {
    if (!this.buf) return;
    unlock();
    if (this.offset >= this.buf.duration - 0.05) this.offset = this.cue;
    const s = ctx.createBufferSource(); s.buffer = this.buf; s.playbackRate.value = this.rate;
    if (this.loop) { s.loop = true; s.loopStart = this.loop[0]; s.loopEnd = this.loop[1]; }
    s.connect(this.input); s.start(0, this.offset); s.onended = () => { if (this.src === s) { this.offset = this.buf.duration; this.src = null; this.playing = false; } };
    this.src = s; this.t0 = T(); this.playing = true;
  }
  stopSrc() { if (this.src) { const s = this.src; this.src = null; try { s.stop(); } catch { } s.disconnect(); } }
  toggle() {
    if (!this.buf) { if (this.track) this.pendingPlay = !this.pendingPlay; return; }
    if (this.playing) { this.offset = this.pos(); this.stopSrc(); this.playing = false; } else this.start();
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
      const P = this.beatLen, p = this.pos(), k = Math.floor((p - this.track.firstBeat) / P + 1e-6), s = Math.max(0, this.track.firstBeat + k * P);
      this.rebase(); this.loop = [s, s + 4 * P];
      if (this.src) { this.src.loopStart = s; this.src.loopEnd = s + 4 * P; this.src.loop = true; }
      emit('loop', this.name);
    } else if (this.loop) { this.rebase(); this.loop = null; if (this.src) this.src.loop = false; }
  }
  hotcue(n) {
    if (!this.buf) return;
    if (this.cues[n] == null) { this.cues[n] = this.pos(); emit('hotcue-set', this.name, n); }
    else { this.seek(this.cues[n]); if (!this.playing) this.start(); emit('hotcue-jump', this.name, n); }
  }
  clearHotcue(n) { this.cues[n] = null; }
  sync(other) {
    if (!other.track || !this.track) return false;
    const target = (other.bpm / this.track.bpm - 1) * 100;
    if (Math.abs(target) > 8.001) return false;
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
export function setXfader(x) { ramp(A.xf.gain, Math.cos(x * Math.PI / 2), 0.006); ramp(B.xf.gain, Math.sin(x * Math.PI / 2), 0.006); }
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
