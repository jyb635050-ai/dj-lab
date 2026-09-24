import { ctx, A, B, decks, events, emit, setXfader, masterLevel, chime } from './engine.js';
import { h, makeSlider, makeJog } from './controls.js';

// ───── 文案 ─────
const STR = {
  zh: {
    nav_learn: '课程', nav_studio: '打碟台', nav_credits: '曲目出处', lang: 'EN',
    hero_kicker: 'BEAT LAB · 律动实验室', hero_title: '玩着玩着，<br>就会打碟了。', hero_sub: '两台唱机、一张混音台、八节闯关课。真实的舞曲，真实的操作——每一步都有即时反馈。',
    cta_learn: '开始第一课', cta_continue: '继续闯关', cta_studio: '自由打碟', map_title: '闯关地图', map_sub: '从按下播放，到完成你的第一次接歌',
    done: '已通关', next: '下一站', steps: '步', lesson_n: n => `第 ${n} 课`, back_map: '← 课程地图', ok: '懂了', try_again: '再想想——', correct: '答对了！',
    complete_title: '通关！', complete_sub: n => `你完成了「${n}」`, next_lesson: '下一课 →', to_map: '回地图', free_play: '去自由打碟',
    library: '曲库', lib_hint: '把歌载入 A 台或 B 台。全部是 CC0 公有领域舞曲，可以随意使用。', load: d => `载入 ${d}`, loaded: '已载入',
    credits_title: '曲目出处', credits_sub: '本站所有音乐都来自 Free Music Archive，作者以 CC0 1.0 放弃了全部版权。感谢这些音乐人。', src: '原曲页面',
    energy: '现场热度', loading: '载入中…', empty: '从曲库载入一首歌', rotate: '把手机横过来，打碟台更好用',
    studio_tip: '小提示：双击任意旋钮回到中间；按住 Shift 拖动可以微调；转盘在暂停时可以搓碟，播放时可以微调节拍。',
    foot: '音乐：CC0 · Free Music Archive　|　BEAT LAB 律动实验室',
  },
  en: {
    nav_learn: 'Lessons', nav_studio: 'Studio', nav_credits: 'Credits', lang: '中文',
    hero_kicker: 'BEAT LAB', hero_title: 'Play around.<br>Leave a DJ.', hero_sub: 'Two decks, one mixer, eight hands-on lessons. Real dance tracks, real controls — instant feedback on every move.',
    cta_learn: 'Start lesson 1', cta_continue: 'Continue', cta_studio: 'Free play', map_title: 'Lesson map', map_sub: 'From pressing play to your very first mix',
    done: 'Cleared', next: 'Up next', steps: 'steps', lesson_n: n => `Lesson ${n}`, back_map: '← Lesson map', ok: 'Got it', try_again: 'Not quite — ', correct: 'Correct!',
    complete_title: 'Cleared!', complete_sub: n => `You finished “${n}”`, next_lesson: 'Next lesson →', to_map: 'Back to map', free_play: 'Free play',
    library: 'Library', lib_hint: 'Load a track onto deck A or B. Every track is CC0 public-domain dance music.', load: d => `Load ${d}`, loaded: 'Loaded',
    credits_title: 'Credits', credits_sub: 'All music comes from the Free Music Archive and was dedicated to the public domain (CC0 1.0) by its creators. Thank you.', src: 'Source page',
    energy: 'Energy', loading: 'Loading…', empty: 'Load a track from the library', rotate: 'Turn your phone sideways for the decks',
    studio_tip: 'Tip: double-click any knob to reset it; hold Shift while dragging for fine control; the jog wheel scratches when paused and nudges when playing.',
    foot: 'Music: CC0 · Free Music Archive　|　BEAT LAB',
  },
};
let lang = (() => { try { return localStorage.getItem('beatlab.lang') === 'en' ? 'en' : 'zh'; } catch { return 'zh'; } })();
const t = (k, ...a) => { const v = STR[lang][k]; return typeof v === 'function' ? v(...a) : v; };
const L = o => (o && typeof o === 'object' ? o[lang] ?? o.zh : o);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

let TRACKS = [], LESSONS = [];
const SL = {};

// ───── 打碟台 ─────
function deckView(d) {
  const n = d.name, N = n.toUpperCase();
  const ui = d.ui = {};
  ui.title = h('div', { class: 'd-title' }); ui.artist = h('div', { class: 'd-artist' });
  ui.bpm = h('div', { class: 'd-bpm num', 'data-testid': `bpm-${n}` }, '0.0');
  ui.pitchOut = h('div', { class: 'd-pitch num' }, '±0.00%');
  ui.wave = h('canvas', { class: 'wave' });
  ui.ovCanvas = h('canvas', { class: 'ov-canvas' }); ui.ovHead = h('div', { class: 'ov-head' });
  ui.overview = h('div', { class: 'overview' }, ui.ovCanvas, ui.ovHead);
  ui.overview.addEventListener('pointerdown', e => {
    if (!d.buf) return; const r = ui.overview.getBoundingClientRect();
    const go = ev => d.seek((ev.clientX - r.left) / r.width * d.buf.duration);
    go(e); ui.overview.setPointerCapture(e.pointerId); ui.overview.onpointermove = go; ui.overview.onpointerup = () => { ui.overview.onpointermove = null; };
  });
  SL[`pitch-${n}`] = makeSlider({ id: `pitch-${n}`, kind: 'v', min: -8, max: 8, step: 0.02, value: 0, label: 'TEMPO', bipolar: true, cls: 'pitch', onInput: v => d.setPitch(v) });
  const flips = []; let dir = 0, touching = false;
  const jog = ui.jog = makeJog({
    id: `jog-${n}`,
    onTouch: on => { touching = on; dir = 0; if (!on && d.bend !== 1) d.setBend(1); },
    onTurn: (da, dt) => {
      const now = performance.now(), s = Math.sign(da);
      if (dir && s !== dir) { flips.push(now); while (flips.length && now - flips[0] > 3000) flips.shift(); if (flips.length >= 4) { emit('scratch', n); flips.length = 0; } }
      dir = s;
      if (d.playing) d.setBend(1 + Math.max(-0.25, Math.min(0.25, da / dt / (2 * Math.PI) * 0.08))); // 播放中：推拉微调
      else d.scratch(da, dt);
    },
  });
  ui.jogTime = h('div', { class: 'jc-time num' }, '0:00'); ui.jogBeat = h('div', { class: 'jc-beat num' }, '—');
  jog.center.append(ui.jogTime, ui.jogBeat);
  const btn = (id, label, fn, cls = '') => h('button', { class: `pad ${cls}`, 'data-testid': id, onclick: fn, type: 'button' }, label);
  ui.play = btn(`play-${n}`, h('span', { class: 'ic-play' }), () => d.toggle(), 'pad-play');
  ui.play.setAttribute('aria-pressed', 'false'); ui.play.setAttribute('aria-label', 'play');
  ui.cue = btn(`cue-${n}`, 'CUE', () => d.cueBtn(), 'pad-cue');
  ui.sync = btn(`sync-${n}`, 'SYNC', () => { const ok = d.sync(n === 'a' ? B : A); flash(ui.sync, ok ? 'ok' : 'bad'); }, 'pad-sync');
  ui.loop = btn(`loop-${n}`, h('span', {}, 'LOOP', h('small', {}, '4')), () => d.setLoop(!d.loop), 'pad-loop'); ui.loop.setAttribute('aria-pressed', 'false');
  ui.hot = [1, 2, 3, 4].map(k => { const b = btn(`hotcue-${n}-${k}`, String(k), () => d.hotcue(k - 1), 'pad-hot'); b.addEventListener('contextmenu', e => { e.preventDefault(); d.clearHotcue(k - 1); }); return b; });
  const body = n === 'a' ? [SL[`pitch-${n}`].el, jog.el] : [jog.el, SL[`pitch-${n}`].el];
  return h('section', { class: `deck deck-${n}`, 'data-deck': n },
    h('header', { class: 'd-head' }, h('div', { class: 'd-badge' }, N), h('div', { class: 'd-meta' }, ui.title, ui.artist), h('div', { class: 'd-tempo' }, ui.bpm, h('div', { class: 'd-bpm-l' }, 'BPM'), ui.pitchOut)),
    h('div', { class: 'wave-wrap' }, ui.wave, h('div', { class: 'playhead' })), ui.overview,
    h('div', { class: 'd-body' }, ...body),
    h('div', { class: 'transport' }, ui.cue, ui.play, ui.sync, ui.loop),
    h('div', { class: 'hotcues' }, h('span', { class: 'hc-l' }, 'HOT CUE'), ...ui.hot));
}
function flash(el, cls) { el.classList.remove('flash-ok', 'flash-bad'); void el.offsetWidth; el.classList.add('flash-' + cls); }
function stripView(d) {
  const n = d.name;
  const knob = (id, label, fn) => (SL[id] = makeSlider({ id, kind: 'knob', min: 0, max: 1, step: 0.01, value: 0.5, label, bipolar: true, onInput: fn })).el;
  return h('div', { class: `strip strip-${n}` },
    knob(`eq-hi-${n}`, 'HI', v => d.setEq('hi', v)), knob(`eq-mid-${n}`, 'MID', v => d.setEq('mid', v)), knob(`eq-low-${n}`, 'LOW', v => d.setEq('low', v)),
    knob(`filter-${n}`, 'FILTER', v => d.setFilter(v)));
}
function mixerView() {
  const vu = d => (d.ui.vu = h('div', { class: 'vu' }, h('i')));
  SL['vol-a'] = makeSlider({ id: 'vol-a', kind: 'v', min: 0, max: 1, step: 0.01, value: 0.8, label: 'VOL', onInput: v => A.setVol(v), cls: 'vol' });
  SL['vol-b'] = makeSlider({ id: 'vol-b', kind: 'v', min: 0, max: 1, step: 0.01, value: 0.8, label: 'VOL', onInput: v => B.setVol(v), cls: 'vol' });
  SL.xfader = makeSlider({ id: 'xfader', kind: 'h', min: 0, max: 1, step: 0.01, value: 0.5, onInput: v => setXfader(v), cls: 'xfader', bipolar: true });
  const lights = d => (d.ui.lights = [0, 1, 2, 3].map(() => h('i')));
  mixerView.energy = h('i');
  mixerView.energyLbl = h('span', {}, t('energy'));
  return h('section', { class: 'mixer' },
    h('div', { class: 'energy' }, mixerView.energyLbl, h('div', { class: 'energy-bar' }, mixerView.energy)),
    h('div', { class: 'beats' }, h('div', { class: 'bl bl-a' }, h('b', {}, 'A'), ...lights(A)), h('div', { class: 'bl bl-b' }, h('b', {}, 'B'), ...lights(B))),
    h('div', { class: 'channels' }, stripView(A), h('div', { class: 'faders' }, vu(A), SL['vol-a'].el, SL['vol-b'].el, vu(B)), stripView(B)),
    h('div', { class: 'xf-row' }, h('b', {}, 'A'), SL.xfader.el, h('b', {}, 'B')));
}
let consoleEl, libEl;
function buildConsole() {
  consoleEl = h('div', { class: 'console' }, deckView(A), mixerView(), deckView(B));
  for (const k of ['vol-a', 'vol-b']) SL[k].set(SL[k].value, false);
  setXfader(0.5);
}
function libraryView() {
  const rows = TRACKS.map(tr => h('div', { class: 'track', 'data-testid': 'track', 'data-id': tr.id },
    h('div', { class: 't-main' }, h('div', { class: 't-title' }, tr.title), h('div', { class: 't-artist' }, tr.artist)),
    h('div', { class: 't-bpm num' }, tr.bpm.toFixed(1)), h('div', { class: 't-len num' }, fmtTime(tr.duration)),
    h('button', { class: 'ld ld-a', type: 'button', 'data-testid': 'load-a', onclick: () => A.load(tr) }, 'A'),
    h('button', { class: 'ld ld-b', type: 'button', 'data-testid': 'load-b', onclick: () => B.load(tr) }, 'B')));
  return h('section', { class: 'library' }, h('div', { class: 'lib-head' }, h('h2', {}, t('library')), h('p', {}, t('lib_hint'))),
    h('div', { class: 'lib-cols' }, h('span', {}, '#'), h('span', {}, 'BPM'), h('span', {}, 'TIME'), h('span', {}, 'LOAD')), h('div', { class: 'lib-rows' }, ...rows), h('p', { class: 'tip' }, t('studio_tip')));
}
const fmtTime = s => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

// ───── 波形 ─────
function sizeCanvas(c) { const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), hh = Math.round(r.height * dpr); if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; c._dirty = true; } return [w, hh, dpr]; }
const COLORS = { a: '#3ee8ff', b: '#b58bff' };
function drawWave(d) {
  const c = d.ui.wave, [W, H] = sizeCanvas(c); if (!W || !H) return;
  const pos = d.pos(), key = `${d.track?.id}|${pos.toFixed(3)}|${W}|${!!d.peaks}|${d.cues.join()}`; if (c._key === key && !c._dirty) return; c._key = key; c._dirty = false;
  const g = c.getContext('2d'); g.clearRect(0, 0, W, H);
  if (!d.peaks) return;
  const SPAN = 8, secPx = SPAN / W, mid = H / 2, { amp, low, rate } = d.peaks, cx = W / 2;
  const t0 = pos - cx * secPx, step = 2;
  g.fillStyle = 'rgba(214,226,255,0.28)'; g.beginPath();
  for (let x = 0; x < W; x += step) { const i = Math.floor((t0 + x * secPx) * rate); if (i < 0 || i >= amp.length) continue; const j = Math.min(amp.length, i + Math.max(1, Math.round(step * secPx * rate))); let m = 0; for (let k = i; k < j; k++) if (amp[k] > m) m = amp[k]; const hh = m * mid * 0.92; g.rect(x, mid - hh, step - 0.5, hh * 2); }
  g.fill();
  g.fillStyle = COLORS[d.name]; g.beginPath();
  for (let x = 0; x < W; x += step) { const i = Math.floor((t0 + x * secPx) * rate); if (i < 0 || i >= low.length) continue; const j = Math.min(low.length, i + Math.max(1, Math.round(step * secPx * rate))); let m = 0; for (let k = i; k < j; k++) if (low[k] > m) m = low[k]; const hh = m * mid * 0.92; g.rect(x, mid - hh, step - 0.5, hh * 2); }
  g.fill();
  // 节拍网格：拍（细）/ 小节（亮）/ 乐句（8 小节，彩色）
  const P = d.beatLen, fb = d.track.firstBeat; let k = Math.ceil((t0 - fb) / P);
  for (let tt = fb + k * P; tt < t0 + W * secPx; tt += P, k++) {
    const x = Math.round((tt - t0) / secPx) + 0.5; const phrase = k % 32 === 0, bar = k % 4 === 0;
    g.fillStyle = phrase ? COLORS[d.name] : bar ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.14)';
    g.fillRect(x, bar ? 0 : H * 0.78, phrase ? 2 : 1, bar ? H : H * 0.22);
  }
  if (d.loop) { const x0 = (d.loop[0] - t0) / secPx, x1 = (d.loop[1] - t0) / secPx; g.fillStyle = 'rgba(62,232,255,0.10)'; g.fillRect(x0, 0, x1 - x0, H); }
  d.cues.forEach((q, i) => { if (q == null) return; const x = (q - t0) / secPx; if (x < 0 || x > W) return; g.fillStyle = '#ffb86b'; g.fillRect(x, 0, 2, H); g.font = `${Math.round(H * 0.18)}px JetBrains Mono, monospace`; g.fillText(String(i + 1), x + 4, H * 0.2); });
}
function drawOverview(d) {
  const c = d.ui.ovCanvas, [W, H] = sizeCanvas(c); const g = c.getContext('2d'); g.clearRect(0, 0, W, H);
  if (!d.peaks) return; const { amp } = d.peaks, n = amp.length; g.fillStyle = 'rgba(214,226,255,0.35)';
  for (let x = 0; x < W; x += 2) { const i = Math.floor(x / W * n), j = Math.floor((x + 2) / W * n); let m = 0; for (let k = i; k < j; k++) if (amp[k] > m) m = amp[k]; const hh = Math.max(1, m * H); g.fillRect(x, (H - hh) / 2, 1.5, hh); }
  c._track = d.track.id;
}

// ───── 每帧刷新 ─────
const last = {};
function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
function setAttr(el, k, v) { v = String(v); if (el.getAttribute(k) !== v) el.setAttribute(k, v); }
function frame() {
  for (const d of [A, B]) {
    const ui = d.ui; if (!ui) continue; const pos = d.pos();
    setText(ui.bpm, d.track ? d.bpm.toFixed(1) : '0.0');
    setText(ui.pitchOut, (d.pitch >= 0 ? '+' : '−') + Math.abs(d.pitch).toFixed(2) + '%');
    setText(ui.title, d.track ? d.track.title : t('empty')); setText(ui.artist, d.track ? (d.loading ? t('loading') : d.track.artist) : '');
    setAttr(ui.play, 'aria-pressed', d.playing); ui.play.classList.toggle('pending', d.pendingPlay);
    setAttr(ui.loop, 'aria-pressed', !!d.loop);
    ui.hot.forEach((b, i) => b.classList.toggle('set', d.cues[i] != null));
    const sl = SL[`pitch-${d.name}`]; if (Math.abs(sl.value - d.pitch) > 1e-6) sl.set(d.pitch, true);
    ui.jog.platter.style.transform = `rotate(${(pos / 1.8 * 360) % 360}deg)`;
    setText(ui.jogTime, d.buf ? '−' + fmtTime(d.buf.duration - pos) : '0:00');
    if (d.track && d.buf) { const bi = d.beatIndex(); setText(ui.jogBeat, bi >= 0 ? `${Math.floor(bi / 4) + 1}.${(bi % 4) + 1}` : '—'); ui.lights.forEach((l, i) => l.classList.toggle('on', d.playing && bi >= 0 && bi % 4 === i)); }
    else { setText(ui.jogBeat, '—'); ui.lights.forEach(l => l.classList.remove('on')); }
    if (d.buf) { ui.ovHead.style.transform = `translate3d(${pos / d.buf.duration * ui.overview.clientWidth}px,0,0)`; if (ui.ovCanvas._track !== d.track.id || ui.ovCanvas._dirty) drawOverview(d); }
    drawWave(d);
    const lv = d.playing ? Math.min(1, d.level() * 3.2) : 0; last[d.name] = (last[d.name] || 0) * 0.8 + lv * 0.2;
    ui.vu.firstChild.style.transform = `scaleY(${Math.max(lv, last[d.name]).toFixed(3)})`;
  }
  const e = Math.min(1, masterLevel() * 3.4); last.m = Math.max(e, (last.m || 0) * 0.94);
  mixerView.energy.style.transform = `scaleX(${last.m.toFixed(3)})`;
  document.documentElement.style.setProperty('--pulse', last.m.toFixed(3));
  if (lesson) lessonTick();
  requestAnimationFrame(frame);
}

// ───── 课程 ─────
let lesson = null;
const progress = () => store.get('beatlab.progress', {});
const HINT = c => ({ play: [`play-${c.deck}`], slider: [c.id], bpmMatch: [`pitch-${c.deck}`], sync: [`sync-${c.deck}`], loop: [`loop-${c.deck}`], hotcue: [`hotcue-${c.deck}-${c.n}`], scratch: [`jog-${c.deck}`] }[c.kind] || []);
function met(c, since) {
  const after = type => events.filter(e => e.type === type && e.t >= since && (c.deck == null || e.deck === c.deck));
  switch (c.kind) {
    case 'play': return decks[c.deck].playing === c.is;
    case 'slider': { const s = SL[c.id]; return Math.abs((s.value - s.min) / (s.max - s.min) - c.to) <= c.tol; }
    case 'bpmMatch': return !!(A.track && B.track) && Math.abs(A.bpm - B.bpm) <= c.tol;
    case 'sync': return after('sync').length > 0 && Math.abs(A.bpm - B.bpm) < 0.1;
    case 'loop': return !!decks[c.deck].loop === c.is;
    case 'hotcue': { const s = after('hotcue-set').find(e => e.n === c.n - 1); return !!s && after('hotcue-jump').some(e => e.n === c.n - 1 && e.t > s.t); }
    case 'scratch': return after('scratch').length > 0;
    case 'quiz': return after('quiz-ok').length > 0;
    case 'ack': return after('ack').length > 0;
  }
  return false;
}
async function resetConsole(setup = {}) {
  for (const d of [A, B]) { if (d.playing) d.toggle(); d.pendingPlay = false; d.setLoop(false); d.setBend(1); }
  const def = { xfader: 0.5, 'vol-a': 0.8, 'vol-b': 0.8, 'pitch-a': 0, 'pitch-b': 0 };
  for (const [k, s] of Object.entries(SL)) s.set(k in (setup.mixer || {}) ? setup.mixer[k] : k in def ? def[k] : 0.5);
  const tr = id => TRACKS.find(x => x.id === id) || TRACKS[0];
  await Promise.all([A.load(tr(setup.a)), B.load(tr(setup.b || TRACKS[1]?.id))]);
}
function lessonTick() {
  const { l, i } = lesson; if (i >= l.steps.length) return;
  const st = l.steps[i];
  if (!met(st.check, lesson.t)) return;
  lesson.items[i].setAttribute('data-state', 'done');
  lesson.i++; lesson.t = performance.now(); chime(lesson.i >= l.steps.length ? 'win' : 'step');
  if (lesson.i < l.steps.length) lesson.items[lesson.i].setAttribute('data-state', 'active');
  drawStepDetail();
  if (lesson.i >= l.steps.length) finishLesson();
}
function drawStepDetail() {
  document.querySelectorAll('.coach-hint').forEach(e => e.classList.remove('coach-hint'));
  const { l, i, items } = lesson;
  items.forEach(li => li.querySelector('.s-extra')?.replaceChildren());
  lesson.bar.style.transform = `scaleX(${i / l.steps.length})`;
  setText(lesson.count, `${Math.min(i + 1, l.steps.length)} / ${l.steps.length}`);
  if (i >= l.steps.length) return;
  const st = l.steps[i], c = st.check, box = items[i].querySelector('.s-extra');
  if (st.hint) box.append(h('p', { class: 's-hint' }, L(st.hint)));
  if (c.kind === 'quiz') {
    const fb = h('p', { class: 's-fb' });
    box.append(h('div', { class: 'choices' }, ...c.choices[lang].map((x, k) => h('button', {
      type: 'button', class: 'choice', 'data-testid': 'choice', onclick: ev => {
        if (k === c.answer) { emit('quiz-ok'); } else { lesson.miss++; chime('bad'); ev.currentTarget.classList.add('wrong'); fb.textContent = t('try_again') + (L(c.why) || ''); }
      },
    }, x))), fb);
  }
  if (c.kind === 'ack') box.append(h('button', { type: 'button', class: 'btn btn-primary ack', 'data-testid': 'ack', onclick: () => emit('ack') }, t('ok')));
  for (const id of HINT(c)) document.querySelector(`[data-testid="${id}"]`)?.classList.add('coach-hint');
  items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function finishLesson() {
  const { l } = lesson; const p = progress(); p[l.id] = { stars: Math.max(1, 3 - lesson.miss) }; store.set('beatlab.progress', p);
  const idx = LESSONS.indexOf(l), nxt = LESSONS[idx + 1], stars = p[l.id].stars;
  const card = h('div', { class: 'complete', 'data-testid': 'lesson-complete', role: 'dialog', 'aria-label': t('complete_title') },
    h('div', { class: 'stars' }, ...[0, 1, 2].map(k => h('i', { class: k < stars ? 'on' : '' , style: `--d:${k * 120}ms` }))),
    h('h2', {}, t('complete_title')), h('p', {}, t('complete_sub', L(l.title))),
    h('div', { class: 'cta' }, nxt ? h('a', { class: 'btn btn-primary', href: '#/lesson/' + nxt.id }, t('next_lesson')) : h('a', { class: 'btn btn-primary', href: '#/studio' }, t('free_play')), h('a', { class: 'btn', href: '#/' }, t('to_map'))));
  lesson.root.append(h('div', { class: 'complete-wrap' }, confetti(), card));
}
function confetti() {
  const c = h('canvas', { class: 'confetti' }); if (matchMedia('(prefers-reduced-motion: reduce)').matches) return c;
  requestAnimationFrame(() => {
    const [W, H] = sizeCanvas(c), g = c.getContext('2d'), cols = ['#3ee8ff', '#b58bff', '#ffffff', '#7dffb2', '#ffb86b'];
    const ps = Array.from({ length: 140 }, () => ({ x: W / 2, y: H * 0.45, vx: (Math.random() - 0.5) * W * 0.018, vy: -Math.random() * H * 0.03 - H * 0.005, r: Math.random() * 6 + 3, c: cols[Math.floor(Math.random() * cols.length)], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3 }));
    const t0 = performance.now();
    (function step(now) {
      const k = (now - t0) / 1000; g.clearRect(0, 0, W, H); if (k > 2.6) return;
      for (const p of ps) { p.vy += H * 0.0009; p.x += p.vx; p.y += p.vy; p.a += p.va; g.save(); g.globalAlpha = Math.max(0, 1 - k / 2.6); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.r, -p.r / 3, p.r * 2, p.r / 1.5); g.restore(); }
      requestAnimationFrame(step);
    })(t0);
  });
  return c;
}

// ───── 页面 ─────
const view = document.getElementById('view');
function nextLesson() { const p = progress(); return LESSONS.find(l => !p[l.id]) || LESSONS[0]; }
function homeView() {
  const p = progress(), nx = nextLesson(), started = Object.keys(p).length > 0;
  const cards = LESSONS.map((l, i) => {
    const done = !!p[l.id], isNext = !done && l === nx;
    return h('a', { class: `lesson-card${done ? ' done' : ''}${isNext ? ' next' : ''}`, href: '#/lesson/' + l.id, 'data-testid': 'lesson-card', 'data-id': l.id, 'data-done': String(done), style: `--i:${i}` },
      h('div', { class: 'lc-top' }, h('span', { class: 'lc-n num' }, String(i + 1).padStart(2, '0')), h('span', { class: 'lc-state' }, done ? '★'.repeat(p[l.id].stars || 3) : isNext ? t('next') : `${l.steps.length} ${t('steps')}`)),
      h('h3', { class: 'lc-title' }, L(l.title)), h('p', { class: 'lc-desc' }, L(l.intro)));
  });
  const count = Object.keys(p).filter(k => LESSONS.some(l => l.id === k)).length;
  return h('div', { class: 'home' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-text' }, h('p', { class: 'kicker' }, t('hero_kicker')), h('h1'), h('p', { class: 'hero-sub' }, t('hero_sub')),
        h('div', { class: 'cta' }, h('a', { class: 'btn btn-primary', href: '#/lesson/' + nx.id }, started ? t('cta_continue') : t('cta_learn')), h('a', { class: 'btn', href: '#/studio' }, t('cta_studio')))),
      h('div', { class: 'hero-art', 'aria-hidden': 'true' }, h('div', { class: 'orb' }, ...[0, 1, 2, 3, 4].map(k => h('i', { style: `--k:${k}` }))), h('div', { class: 'eq' }, ...Array.from({ length: 24 }, (_, k) => h('i', { style: `--k:${k}` }))))),
    h('section', { class: 'map' },
      h('div', { class: 'map-head' }, h('div', {}, h('h2', {}, t('map_title')), h('p', {}, t('map_sub'))), h('div', { class: 'map-prog num' }, `${count} / ${LESSONS.length}`)),
      h('div', { class: 'map-track' }, h('div', { class: 'map-line' }, h('i', { style: `transform:scaleX(${count / LESSONS.length})` })), h('div', { class: 'cards' }, ...cards))));
}
function lessonView(l) {
  const idx = LESSONS.indexOf(l);
  const items = l.steps.map((s, k) => h('li', { class: 'step', 'data-testid': 'step', 'data-state': k ? 'todo' : 'active' }, h('span', { class: 's-dot' }), h('div', { class: 's-body' }, h('p', { class: 's-text' }, L(s.text)), h('div', { class: 's-extra' }))));
  const bar = h('i'), count = h('span', { class: 'num' });
  const coach = h('aside', { class: 'coach' },
    h('a', { class: 'back', href: '#/' }, t('back_map')),
    h('p', { class: 'kicker' }, t('lesson_n', idx + 1)), h('h1', {}, L(l.title)), h('p', { class: 'c-intro' }, L(l.intro)),
    h('div', { class: 'c-prog' }, h('div', { class: 'c-bar' }, bar), count),
    h('ol', { class: 'steps' }, ...items));
  const root = h('div', { class: 'lesson' }, coach, h('div', { class: 'stage' }, consoleEl));
  lesson = { l, i: 0, t: performance.now(), items, bar, count, root, miss: 0 };
  resetConsole(l.setup).then(() => { if (lesson && lesson.l === l) lesson.t = Math.max(lesson.t, 0); });
  requestAnimationFrame(() => drawStepDetail());
  return root;
}
function studioView() {
  if (!A.track && TRACKS[0]) A.load(TRACKS[0]);
  if (!B.track && TRACKS[1]) B.load(TRACKS[1]);
  return h('div', { class: 'studio' }, consoleEl, libraryView());
}
function creditsView() {
  return h('div', { class: 'credits' }, h('h1', {}, t('credits_title')), h('p', { class: 'lead' }, t('credits_sub')),
    h('ul', { class: 'credit-list' }, ...TRACKS.map(tr => h('li', { class: 'credit', 'data-testid': 'credit' },
      h('div', {}, h('b', {}, tr.title), h('span', {}, tr.artist)), h('span', { class: 'lic' }, 'CC0 1.0'), h('a', { href: tr.source, target: '_blank', rel: 'noopener' }, t('src') + ' ↗')))));
}
function render() {
  const hs = location.hash || '#/';
  document.querySelectorAll('.coach-hint').forEach(e => e.classList.remove('coach-hint'));
  lesson = null;
  let v, route = 'home';
  if (hs === '#/studio') { v = studioView(); route = 'studio'; }
  else if (hs.startsWith('#/lesson/')) { const l = LESSONS.find(x => x.id === decodeURIComponent(hs.slice(9))); v = l ? lessonView(l) : homeView(); route = l ? 'lesson' : 'home'; }
  else if (hs === '#/credits') { v = creditsView(); route = 'credits'; }
  else v = homeView();
  document.body.dataset.route = route;
  view.replaceChildren(v);
  if (route === 'home') view.querySelector('.hero h1').innerHTML = t('hero_title');
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === route || (route === 'lesson' && a.dataset.nav === 'home')));
  if (route !== 'lesson') scrollTo(0, 0);
}
function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
  if (mixerView.energyLbl) mixerView.energyLbl.textContent = t('energy');
  document.querySelector('.rotate-hint')?.replaceChildren(t('rotate'));
}
document.querySelector('[data-testid="lang"]').addEventListener('click', () => { lang = lang === 'zh' ? 'en' : 'zh'; store.set('beatlab.lang', lang); applyLang(); render(); });

window.__dj = {
  ready: false,
  state() { const f = d => ({ track: d.track ? d.track.id : null, playing: d.playing, bpm: d.track ? d.bpm * d.bend : 0, pitch: d.pitch, position: d.pos(), phase: d.phase(), loop: !!d.loop }); return { a: f(A), b: f(B) }; },
  seek(d, s) { decks[d].seek(s); },
};
applyLang();
(async () => {
  [TRACKS, LESSONS] = await Promise.all(['data/tracks.json', 'data/lessons.json'].map(f => fetch(f).then(r => r.json())));
  buildConsole(); addEventListener('hashchange', render); render(); requestAnimationFrame(frame);
  window.__dj.ready = true;
})();
