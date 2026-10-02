// 推子 / 旋钮 / 转盘。推子旋钮都是 role=slider，键盘和指针（鼠标、触屏、笔）都能操作。
export const h = (tag, attrs = {}, ...kids) => {
  const svg = ['svg', 'circle', 'path', 'line', 'g', 'defs', 'linearGradient', 'stop', 'rect'].includes(tag);
  const e = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'class' && !svg) e.className = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const roundTo = (v, step) => +(Math.round(v / step) * step).toFixed(6);

// kind: 'h' 横推子 / 'v' 竖推子 / 'knob' 旋钮
export function makeSlider({ id, kind, min, max, step, value, def = value, label, fmt, bipolar = false, onInput, cls = '' }) {
  const o = { min, max, step, value: NaN, def };
  const thumb = h('div', { class: 'thumb' }), fill = h('div', { class: 'fill' });
  let body;
  if (kind === 'knob') {
    const R = 17, C = 2 * Math.PI * R, ARC = C * 0.75;
    const track = h('circle', { cx: 22, cy: 22, r: R, class: 'k-track', 'stroke-dasharray': `${ARC} ${C}`, transform: 'rotate(135 22 22)' });
    const val = h('circle', { cx: 22, cy: 22, r: R, class: 'k-val', 'stroke-dasharray': `0 ${C}`, transform: 'rotate(135 22 22)' });
    o.draw = n => {
      if (bipolar) { const a = Math.abs(n - 0.5) * ARC; const start = n < 0.5 ? n * ARC : ARC / 2; val.setAttribute('stroke-dasharray', `0 ${start} ${a} ${C}`); }
      else val.setAttribute('stroke-dasharray', `${n * ARC} ${C}`);
      thumb.style.transform = `rotate(${-135 + n * 270}deg)`;
    };
    body = h('div', { class: 'knob-body' }, h('svg', { viewBox: '0 0 44 44', class: 'k-svg' }, track, val), h('div', { class: 'k-cap' }, thumb));
  } else {
    body = h('div', { class: 'rail' }, h('div', { class: 'groove' }, fill), thumb);
    let len = 0; const ro = new ResizeObserver(() => { len = kind === 'h' ? body.clientWidth - 18 : body.clientHeight - 18; o.draw((o.value - min) / (max - min)); }); ro.observe(body);
    o.draw = n => {
      const px = n * len;
      thumb.style.transform = kind === 'h' ? `translate3d(${px}px,0,0)` : `translate3d(0,${len - px}px,0)`;
      if (bipolar) { const c = 0.5, a = Math.min(n, c), b = Math.max(n, c); fill.style.cssText = kind === 'h' ? `left:${a * 100}%;width:${(b - a) * 100}%` : `bottom:${a * 100}%;height:${(b - a) * 100}%`; }
      else fill.style.cssText = kind === 'h' ? `left:0;width:${n * 100}%` : `bottom:0;height:${n * 100}%`;
    };
  }
  const out = fmt ? h('div', { class: 'readout' }) : null;
  const el = h('div', { class: `ctl ctl-${kind} ${cls}`, 'data-testid': id, role: 'slider', tabindex: 0, 'aria-label': label || id, 'aria-valuemin': min, 'aria-valuemax': max, 'aria-orientation': kind === 'h' ? 'horizontal' : 'vertical' }, body, label ? h('div', { class: 'lbl' }, label) : null, out);
  o.el = el;
  o.set = (v, silent) => {
    v = clamp(roundTo(v, step), min, max); if (v === o.value) return;
    o.value = v; el.setAttribute('aria-valuenow', v); if (out) out.textContent = fmt(v);
    o.draw((v - min) / (max - min)); if (!silent) onInput(v);
  };
  el.addEventListener('keydown', e => {
    const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (k) o.set(o.value + k * step * (e.shiftKey ? 5 : 1)); else if (e.key === 'Home') o.set(min); else if (e.key === 'End') o.set(max);
    else if (e.key === 'Enter' || e.key === 'Delete') o.set(def); else return;
    e.preventDefault();
  });
  // 指针：推子按到滑块上是相对拖（不跳），按到轨道上先跳到那里；旋钮上下拖 200px 走完全程，双击回中
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return; e.preventDefault(); el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId); el.classList.add('active');
    const r = body.getBoundingClientRect();
    if (kind === 'knob') drag = { y: e.clientY, v: o.value };
    else {
      const travel = (kind === 'h' ? r.width : r.height) - 18;
      const onThumb = e.target === thumb || thumb.contains(e.target);
      if (!onThumb) { const n = kind === 'h' ? (e.clientX - r.left - 9) / travel : 1 - (e.clientY - r.top - 9) / travel; o.set(min + clamp(n, 0, 1) * (max - min)); }
      drag = { x: e.clientX, y: e.clientY, v: o.value, travel };
    }
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    if (kind === 'knob') o.set(drag.v - (e.clientY - drag.y) / (e.shiftKey ? 800 : 200) * (max - min));
    else { const d = kind === 'h' ? e.clientX - drag.x : drag.y - e.clientY; o.set(drag.v + d / drag.travel * (max - min)); }
  });
  const end = () => { drag = null; el.classList.remove('active'); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  el.addEventListener('dblclick', () => o.set(def));
  el.addEventListener('wheel', e => { if (document.activeElement !== el && kind !== 'knob') return; e.preventDefault(); o.set(o.value + (e.deltaY < 0 ? 1 : -1) * step * 2); }, { passive: false });
  // 运行时改量程（如变速范围 ±6/±10/±16%），值夹到新范围内
  o.setRange = (a, b, silent) => {
    min = o.min = a; max = o.max = b; el.setAttribute('aria-valuemin', a); el.setAttribute('aria-valuemax', b);
    const v = o.value; o.value = NaN; o.set(v, silent);
  };
  o.set(value, true); el.setAttribute('aria-valuenow', o.value);
  return o;
}

// 转盘：绕圆心拖。onTurn(弧度增量, 秒)；onTouch(true/false)
export function makeJog({ id, onTurn, onTouch }) {
  const platter = h('div', { class: 'platter' }, h('div', { class: 'grooves' }), h('div', { class: 'mark' }));
  const center = h('div', { class: 'jog-center' });
  const ring = h('div', { class: 'jog-ring' });
  const el = h('div', { class: 'jog', 'data-testid': id, role: 'button', 'aria-label': 'jog wheel' }, ring, platter, center);
  let last = null, lt = 0;
  const ang = e => { const r = el.getBoundingClientRect(); return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2); };
  el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); last = ang(e); lt = performance.now(); el.classList.add('touch'); onTouch(true); });
  el.addEventListener('pointermove', e => {
    if (last == null) return; const a = ang(e); let d = a - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; last = a;
    const now = performance.now(), dt = (now - lt) / 1000; lt = now; if (d) onTurn(d, Math.max(dt, 0.004));
  });
  const end = () => { if (last == null) return; last = null; el.classList.remove('touch'); onTouch(false); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  return { el, platter, center, ring };
}
