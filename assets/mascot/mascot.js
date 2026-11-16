/*
 * afterterm's mascot: a glossy dark blob with two fangs, three hair strands,
 * the three brand dots on its forehead and flat-topped, slightly annoyed eyes.
 *
 * One plain script, no build step and no dependencies. Load it with a script tag
 * and use the global `Mascot`:
 *
 *   Mascot.svg({ mood: 'happy' })        a complete, standalone SVG string
 *   Mascot.create(svgElement, options)   a posable copy inside your own SVG
 *   Mascot.track / at / hops / EASE      small helpers for time-based animation
 *   Mascot.player(options)               play, pause and scrub a film
 *
 * Everything is drawn in a 200 x 200 box. The feet (the fang tips) stand on y = 172
 * and the body is centred on x = 105. README.md beside this file has the full guide.
 */
(function (root) {
  'use strict';

  const COLORS = {
    teal: '#20b2aa', orange: '#d28c32', purple: '#9467bd', // the three dots, from the app icon
    bodyTop: '#2b2733', bodyMid: '#0d0b12', bodyTint: '#4a2470', // the body's gradient, top to bottom
    eye: '#ffffff',
    stageTop: '#f4c8ff', stageBottom: '#c366f0', // the mascot's own pink stage
    shadow: '#8d3ec0',
  };

  const BODY = 'M52 148 C44 100 56 62 92 52 C128 44 154 66 158 104 C160 124 158 138 154 150 C150 158 140 158 136 150 L130 172 L122 152 H92 L86 170 L78 152 C70 160 56 158 52 148 Z';
  const HAIR = ['M123 61 q-5 -15 -18 -15', 'M128 61 q-2 -19 8 -25', 'M133 61 q9 -11 20 -7'];
  const DOTS = [[74, 78, 'teal'], [90, 72, 'orange'], [106, 72, 'purple']];
  const EYES = [86, 124], EYE_Y = 107, EYE_RX = 15, EYE_RY = 17;
  const FOOT = { x: 105, y: 172 };

  // ---- emotions -----------------------------------------------------------
  // An emotion never redraws the eye. It cuts the same eye with a 26-point polygon
  // (13 points along the top, 13 back along the bottom, in percent of the eye's own
  // box) and moves it. Every polygon has the same number of points, so the lids
  // slide from any emotion to any other.
  const pct = pts => pts.map(([x, y]) => x.toFixed(1) + '% ' + y.toFixed(1) + '%').join(',');
  const sample = (line, n) => Array.from({ length: n }, (_, i) => {
    const u = (i / (n - 1)) * (line.length - 1), a = Math.min(Math.floor(u), line.length - 2), k = u - a;
    return [line[a][0] + (line[a + 1][0] - line[a][0]) * k, line[a][1] + (line[a + 1][1] - line[a][1]) * k];
  });
  const lid = (top, bottom) => pct([...sample(top, 13), ...sample(bottom, 13)]);
  const FLOOR = [[100, 100], [0, 100]];
  const arc = (cx, rx, ry, dir) => Array.from({ length: 13 }, (_, i) => { const t = (Math.PI * i) / 12; return [cx + dir * rx * Math.cos(t), 100 - ry * Math.sin(t)]; });
  const SHAPES = {
    full: lid([[0, 0], [100, 0]], FLOOR),
    arch: pct([...arc(50, 50, 100, -1), ...arc(50, 30, 50, 1)]), // a smooth upturned arch
    slopeUp: lid([[0, 48], [100, 0]], FLOOR), // the top edge rises to the right
    slopeDown: lid([[0, 0], [100, 48]], FLOOR),
    squint: lid([[0, 36], [100, 36]], [[100, 72], [0, 72]]),
    topCut: lid([[0, 38], [100, 38]], FLOOR),
  };
  // For each emotion: [shape, transform] for the left eye, then the right eye.
  const MOODS = {
    neutral: [['full', 'none'], ['full', 'none']],
    happy: [['arch', 'translateY(-8%) scale(1.15)'], ['arch', 'translateY(-8%) scale(1.15)']],
    sad: [['slopeUp', 'translateY(10%)'], ['slopeDown', 'translateY(10%)']],
    angry: [['slopeDown', 'none'], ['slopeUp', 'none']],
    surprised: [['full', 'scale(1.14)'], ['full', 'scale(1.14)']],
    confused: [['topCut', 'scale(0.8)'], ['full', 'scale(1.22) translateY(-10%)']],
    suspicious: [['squint', 'translateX(-14%)'], ['squint', 'translateX(-14%)']],
    cheeky: [['arch', 'translateY(-8%) scale(1.15)'], ['full', 'scaleY(0.2)']], // one eye happy, one shut
  };
  const eyeStyle = (mood, side, animated) => {
    const [shape, move] = (MOODS[mood] || MOODS.neutral)[side];
    return `transform-box:fill-box;transform-origin:center;clip-path:polygon(${SHAPES[shape]});transform:${move};` +
      (animated ? 'transition:clip-path .32s ease,transform .32s ease;' : '');
  };

  // ---- drawing ------------------------------------------------------------
  let serial = 0;
  const eyePath = x => `M${x - EYE_RX} ${EYE_Y - EYE_RY * 0.25} H${x + EYE_RX} V${EYE_Y + EYE_RY * 0.1} A${EYE_RX} ${EYE_RY * 0.9} 0 0 1 ${x - EYE_RX} ${EYE_Y + EYE_RY * 0.1} Z`;
  const MOUTHS = {
    smile: 'M90 128 H120 A15 14 0 0 1 90 128 Z',
    frown: 'M93 144 A12 11 0 0 1 117 144 Q105 136 93 144 Z',
  };

  // The inside of the character, as SVG markup. `id` keeps gradient ids unique.
  function parts(id, o) {
    const c = Object.assign({}, COLORS, o.colors);
    const hair = HAIR.map((d, i) => `<path class="mascot-hair${o.breeze ? ' mascot-breeze' : ''}" style="transform-origin:128px 61px;${o.breeze ? `animation-delay:${i * 0.07}s` : ''}" d="${d}" fill="none" stroke="${c.bodyTop}" stroke-width="5" stroke-linecap="round"/>`).join('');
    const dots = DOTS.map(([x, y, k], i) => `<circle data-dot="${i}" cx="${x}" cy="${y}" r="5.5" fill="${c[k]}"/>`).join('');
    const eyes = EYES.map((x, i) => `<g transform="rotate(${i ? -6 : 6} ${x} ${EYE_Y})"><path data-eye="${i}" style="${eyeStyle(o.mood, i, o.animated)}" d="${eyePath(x)}" fill="${c.eye}"/></g>`).join('');
    const orbit = o.animated ? `<g data-part="orbit" transform="scale(0)"><circle cx="105" cy="22" r="8" fill="${c.teal}"/><circle cx="177.7" cy="148" r="8" fill="${c.orange}"/><circle cx="32.3" cy="148" r="8" fill="${c.purple}"/></g>` : '';
    const mouth = k => `<path data-part="${k}" d="${MOUTHS[k]}" fill="${c.eye}"${o.animated ? ' transform="scale(0)"' : ''}/>`;
    return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.bodyTop}"/><stop offset="0.68" stop-color="${c.bodyMid}"/><stop offset="1" stop-color="${c.bodyTint}"/></linearGradient></defs>
<g data-part="squash"><g data-part="shake">
<g data-part="hair">${hair}</g>
<path d="${BODY}" fill="url(#${id})"/>
<g data-part="dots">${dots}</g>${orbit}
<g data-part="eyes">${eyes}</g>
${o.animated || o.mouth === 'smile' ? mouth('smile') : ''}${o.animated || o.mouth === 'frown' ? mouth('frown') : ''}
</g></g>`;
  }

  const BREEZE_CSS = '@keyframes mascot-breeze{0%,50%,100%{transform:skewX(0deg)}14%{transform:skewX(-20deg)}28%{transform:skewX(12deg)}40%{transform:skewX(-5deg)}}.mascot-breeze{animation:mascot-breeze 4.2s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.mascot-breeze{animation:none}}';

  /**
   * A complete SVG of the mascot, as a string. Use it for a still image.
   * options: mood (see Mascot.MOODS), mouth ('smile' | 'frown'), size (px),
   * background ('none' | 'tile'), colors (overrides for Mascot.COLORS).
   */
  function svg(options) {
    const o = Object.assign({ mood: 'neutral', size: 200, background: 'none' }, options);
    const id = 'mascot-body-' + ++serial, c = Object.assign({}, COLORS, o.colors);
    const tile = o.background === 'tile'
      ? `<defs><linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.stageTop}"/><stop offset="1" stop-color="${c.stageBottom}"/></linearGradient></defs><rect width="200" height="200" rx="46" fill="url(#${id}-bg)"/><ellipse cx="104" cy="186" rx="46" ry="6" fill="${c.shadow}"/>`
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${o.size}" height="${o.size}" role="img" aria-label="afterterm mascot, ${o.mood}">${tile}${parts(id, o)}</svg>`;
  }

  /**
   * Puts a posable mascot inside an existing <svg> (or <g>) and returns its controls.
   * options: x, y (where its feet stand, in the parent's units), scale, breeze (hair
   * moves on its own, default true), colors.
   * The returned object has `el` (the <g>) and `set(pose)`. See README.md for every
   * pose field; any field left out keeps its last value.
   */
  function create(parent, options) {
    const o = Object.assign({ x: 100, y: 172, scale: 1, breeze: true, mood: 'neutral' }, options, { animated: true });
    const doc = parent.ownerDocument, NS = 'http://www.w3.org/2000/svg';
    if (o.breeze && !doc.getElementById('mascot-breeze-css')) {
      const st = doc.createElementNS(NS, 'style'); st.id = 'mascot-breeze-css'; st.textContent = BREEZE_CSS;
      (parent.ownerSVGElement || parent).appendChild(st);
    }
    const el = doc.createElementNS(NS, 'g');
    el.setAttribute('class', 'mascot');
    el.innerHTML = `<g data-part="place">${parts('mascot-body-' + ++serial, o)}</g>`;
    parent.appendChild(el);
    const q = k => el.querySelector(`[data-part="${k}"]`);
    const part = { place: q('place'), squash: q('squash'), shake: q('shake'), hair: q('hair'), dots: q('dots'), orbit: q('orbit'), eyes: q('eyes'), smile: q('smile'), frown: q('frown') };
    const eyeEls = [0, 1].map(i => el.querySelector(`[data-eye="${i}"]`));
    const dotEls = [0, 1, 2].map(i => el.querySelector(`[data-dot="${i}"]`));
    const n = v => (Math.round(v * 100) / 100).toString();
    const about = (cx, cy, inner) => `translate(${cx} ${cy}) ${inner} translate(${-cx} ${-cy})`;
    const pose = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, shakeX: 0, shakeY: 0, hairScale: 1, hairRotate: 0, eyeX: 0, eyeY: 0, mood: o.mood, wink: 1, smile: 0, frown: 0, dots: 1, dotScale: [1, 1, 1], orbit: 0, orbitAngle: 0 };
    let shownMood = o.mood, winking = false;

    function set(next) {
      Object.assign(pose, next);
      el.setAttribute('transform', `translate(${n(o.x + pose.x - FOOT.x * o.scale)} ${n(o.y + pose.y - FOOT.y * o.scale)}) scale(${o.scale})`);
      part.squash.setAttribute('transform', about(FOOT.x, FOOT.y, `rotate(${n(pose.rotate)}) scale(${n(pose.scaleX)} ${n(pose.scaleY)})`));
      part.shake.setAttribute('transform', `translate(${n(pose.shakeX)} ${n(pose.shakeY)})`);
      part.hair.setAttribute('transform', about(128, 60, `rotate(${n(pose.hairRotate)}) scale(1 ${n(pose.hairScale)})`));
      part.eyes.setAttribute('transform', `translate(${n(pose.eyeX)} ${n(pose.eyeY)})`);
      if (pose.mood !== shownMood) {
        shownMood = pose.mood;
        eyeEls.forEach((e, i) => { if (!(i === 1 && winking)) e.setAttribute('style', eyeStyle(shownMood, i, true)); });
      }
      // wink: 1 is open, 0.2 is shut. It squeezes the right eye and ignores the emotion's own move while it does.
      if (pose.wink < 0.99) { winking = true; eyeEls[1].style.transition = 'none'; eyeEls[1].style.transform = `scaleY(${n(pose.wink)})`; }
      else if (winking) { winking = false; eyeEls[1].setAttribute('style', eyeStyle(shownMood, 1, true)); }
      part.smile.setAttribute('transform', about(105, 133, `scale(${n(Math.max(0, pose.smile))})`));
      part.frown.setAttribute('transform', about(105, 140, `scale(${n(Math.max(0, pose.frown))})`));
      part.dots.setAttribute('transform', about(90, 74, `scale(${n(Math.max(0, pose.dots))})`));
      dotEls.forEach((d, i) => d.setAttribute('transform', about(DOTS[i][0], DOTS[i][1], `scale(${n(Math.max(0, pose.dotScale[i]))})`)));
      part.orbit.setAttribute('transform', about(105, 106, `rotate(${n(pose.orbitAngle)}) scale(${n(Math.max(0, pose.orbit))})`));
      return api;
    }
    // Where a point of the character is in the parent's units, for the current x and y (squash and rotation ignored).
    const point = (px, py) => [o.x + pose.x + (px - FOOT.x) * o.scale, o.y + pose.y + (py - FOOT.y) * o.scale];
    const api = { el, set, pose, point, dot: i => point(DOTS[i][0], DOTS[i][1]) };
    return set({});
  }

  // ---- animation helpers --------------------------------------------------
  const EASE = {
    inOut: u => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
    in: u => u * u,
    out: u => 1 - (1 - u) * (1 - u),
    linear: u => u,
    back: u => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); }, // overshoots, then settles
  };

  /**
   * The value of a track at time t. A track is a list of [time, value, ease]:
   * `ease` names how the value arrives at that key (default 'inOut'). The value holds
   * before the first key and after the last one.
   */
  function track(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t < keys[i][0]) { const a = keys[i - 1], b = keys[i]; return a[1] + (b[1] - a[1]) * EASE[b[2] || 'inOut']((t - a[0]) / (b[0] - a[0])); }
    }
    return keys[keys.length - 1][1];
  }

  /** For a list of [time, value] steps: the value of the last step that has started. */
  function at(steps, t) { let v = steps[0][1]; for (const [a, b] of steps) if (t >= a) v = b; return v; }

  /**
   * Hops. Each hop is [start, count, seconds per hop, height]. Returns what to add to
   * a pose at time t: { y, scaleX, scaleY } (y is negative while in the air, and the
   * body stretches in the air and squashes on landing).
   */
  function hops(list, t) {
    const r = { y: 0, scaleX: 1, scaleY: 1 };
    for (const [t0, count, period, height] of list) {
      if (t >= t0 && t < t0 + count * period) {
        const s = Math.sin(Math.PI * (((t - t0) % period) / period)), land = Math.pow(1 - s, 6);
        r.y -= height * s; r.scaleY *= 1 + 0.07 * s - 0.1 * land; r.scaleX *= 1 - 0.04 * s + 0.08 * land;
      }
    }
    return r;
  }

  /**
   * Plays a film whose every frame is drawn from the time alone.
   * options: duration (seconds), draw(t), and optionally bar (an <input type=range>),
   * playButton, restartButton, onTime(t), loop (default true), autoplay (default:
   * true unless the visitor asked for reduced motion), poster (the time to show when
   * not autoplaying).
   * It also sets window.__film = { duration, at(t) }, which render.mjs uses to draw
   * exact frames, and honours ?t=<seconds> in the address to open paused on a moment.
   */
  function player(options) {
    const o = Object.assign({ loop: true, poster: 0 }, options);
    const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t = 0, last = 0, playing = o.autoplay === undefined ? !reduced : o.autoplay;
    const paint = () => {
      o.draw(t);
      if (o.bar) o.bar.value = String(Math.round(t * 100));
      if (o.onTime) o.onTime(t);
    };
    const frame = now => {
      if (!playing) return;
      t += Math.min(0.05, (now - last) / 1000); last = now;
      if (t >= o.duration) { if (o.loop) t = 0; else { t = o.duration; playing = false; label(); } }
      paint();
      if (playing) root.requestAnimationFrame(frame);
    };
    const label = () => { if (o.playButton) o.playButton.textContent = playing ? 'Pause' : 'Play'; };
    const setPlaying = on => { playing = on; label(); if (on) { last = root.performance.now(); root.requestAnimationFrame(frame); } };
    const seek = v => { t = Math.max(0, Math.min(o.duration, v)); paint(); };
    if (o.bar) { o.bar.min = '0'; o.bar.max = String(Math.round(o.duration * 100)); o.bar.addEventListener('input', () => { setPlaying(false); seek(Number(o.bar.value) / 100); }); }
    if (o.playButton) o.playButton.addEventListener('click', () => setPlaying(!playing));
    if (o.restartButton) o.restartButton.addEventListener('click', () => { seek(0); if (!playing) setPlaying(true); });
    const asked = /[?&]t=([\d.]+)/.exec(root.location ? root.location.search : '');
    if (asked) { playing = false; t = Number(asked[1]); } else if (!playing) t = o.poster;
    paint(); setPlaying(playing);
    const api = { seek, play: () => setPlaying(true), pause: () => setPlaying(false), get time() { return t; } };
    root.__film = { duration: o.duration, at: v => { setPlaying(false); seek(v); } };
    return api;
  }

  const Mascot = { COLORS, MOODS: Object.keys(MOODS), FOOT, svg, create, EASE, track, at, hops, player };
  if (typeof module === 'object' && module.exports) module.exports = Mascot;
  else root.Mascot = Mascot;
})(typeof window !== 'undefined' ? window : globalThis);
