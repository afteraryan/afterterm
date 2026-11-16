/*
 * "Fix the bug": a 15 second film of the mascot, and the worked example for making another.
 * One story, two shapes. A page picks the shape before loading this script:
 *
 *   <script>window.FILM_LAYOUT = 'portrait'</script>     (leave it out for landscape)
 *
 * The story (the timing, the emotions, the hops) is the same in both. A layout only says
 * how big the stage is, where the props sit and where the mascot walks to.
 */
(() => {
  const { COLORS: C, track, at, hops, EASE } = Mascot;

  const LAYOUTS = {
    // 16:9, renders at 1920 x 1080. The task sits top right, the terminal top left.
    landscape: {
      width: 800, height: 450, ground: 372, home: 400, scale: 1.15,
      task: [0, 0], terminal: [0, 0], mark: [0, 0], // how far each prop is moved from where it is drawn below
      walk: { task: 240, work: 70, terminal: -200, dot: -55 }, // where the mascot stands for each beat, from home
      jump: { task: 100, terminal: 70 }, // how high it must jump to headbutt each prop
    },
    // 9:16, renders at 1080 x 1920. The mascot is bigger and the props stack above it.
    portrait: {
      width: 450, height: 800, ground: 590, home: 225, scale: 1.5,
      task: [-358, 150], terminal: [-10, 154], mark: [-350, 350],
      walk: { task: 60, work: 75, terminal: -35, dot: 105 },
      jump: { task: 135, terminal: 85 },
    },
  };
  const L = LAYOUTS[window.FILM_LAYOUT] || LAYOUTS.landscape;
  const { width: W, height: H, ground: GROUND, home: HOME, scale: SCALE } = L;
  const DURATION = 15.4;
  const stage = document.getElementById('stage');
  stage.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // ---- the props: backgrounds, a task notification, a terminal, confetti ----
  // The terminal's rows: [y, [[block width, the second it is typed, is it the failing block]]]
  const ROWS = [
    [76, [[60, 6.3], [40, 6.5], [80, 6.7]]],
    [104, [[36, 7.0], [90, 7.2], [50, 7.4]]],
    [132, [[70, 7.7], [30, 7.9], [60, 8.2, true]]],
  ];
  const blocks = [];
  ROWS.forEach(([y, list]) => { let x = 96; list.forEach(([w, time, fails]) => { blocks.push({ x, y, w, time, fails }); x += w + 8; }); });
  const SPREAD = SCALE / 1.15;
  const CONFETTI = Array.from({ length: 14 }, (_, i) => { const a = (Math.PI * 2 * i) / 14, r = (110 + (i % 3) * 34) * SPREAD; return [Math.cos(a) * r, Math.sin(a) * r * 0.7 - 50 * SPREAD, (7 + (i % 3) * 3) * SPREAD, [C.teal, C.orange, C.purple][i % 3]]; });
  const gradient = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  stage.innerHTML = `
    <defs>${gradient('bg-calm', C.stageTop, C.stageBottom)}${gradient('bg-angry', '#ffa1ae', '#ec3a5a')}${gradient('bg-sad', '#c3cdea', '#5f72ad')}</defs>
    <rect width="${W}" height="${H}" fill="url(#bg-calm)"/>
    <rect id="angry-layer" width="${W}" height="${H}" fill="url(#bg-angry)"/>
    <rect id="sad-layer" width="${W}" height="${H}" fill="url(#bg-sad)"/>
    <ellipse id="shadow" cx="0" cy="0" rx="${74 * SPREAD}" ry="${10 * SPREAD}"/>
    <g id="terminal">
      <rect x="50" y="36" width="300" height="132" rx="22" fill="#212121"/>
      <circle cx="72" cy="56" r="5" fill="${C.teal}"/><circle cx="88" cy="56" r="5" fill="${C.orange}"/><circle cx="104" cy="56" r="5" fill="${C.purple}"/>
      ${ROWS.map(([y]) => `<polygon class="chevron" points="68,${y} 74,${y} 80,${y + 7} 74,${y + 14} 68,${y + 14} 74,${y + 7}" fill="#8e8e8e"/>`).join('')}
      ${blocks.map(() => `<rect class="block" height="14" rx="5"/>`).join('')}
      <rect id="cursor" width="10" height="14" rx="3" fill="#ffffff"/>
    </g>
    <g id="task">
      <rect x="540" y="40" width="236" height="76" rx="20" fill="#212121"/>
      <rect x="560" y="63" width="30" height="30" rx="9" fill="${C.orange}"/><rect x="568" y="71" width="14" height="14" rx="4" fill="#212121"/>
      <text x="604" y="71" font-size="13" font-weight="500" fill="#a8a8a8">New task</text>
      <text x="604" y="96" font-size="19" font-weight="600" fill="#f2f2f2">Fix the bug</text>
    </g>
    ${CONFETTI.map(c => `<circle class="confetti" r="${c[2].toFixed(1)}" fill="${c[3]}"/>`).join('')}
    <g id="actor"></g>
    <circle id="loose-dot" r="${(6.5 * SCALE).toFixed(1)}" fill="${C.purple}"/>
    <g opacity="0.6" transform="translate(${L.mark[0]} ${L.mark[1]})">
      <g transform="translate(650 398) scale(0.12)"><path d="M70 122 L162 166 L70 210" fill="none" stroke="#ffffff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><rect x="174" y="146" width="14" height="42" fill="#ffffff"/></g>
      <text x="772" y="424" text-anchor="end" font-size="18" font-weight="600" letter-spacing="-0.2" fill="#ffffff">afterterm</text>
    </g>`;
  const $ = id => document.getElementById(id);
  const blockEls = [...stage.querySelectorAll('.block')], chevronEls = [...stage.querySelectorAll('.chevron')], confettiEls = [...stage.querySelectorAll('.confetti')];
  const bot = Mascot.create($('actor'), { x: HOME, y: GROUND, scale: SCALE });

  // ---- the story, as tracks of [second, value, how it arrives] ----
  const X = L.walk;
  // The purple dot is knocked off at the top of the jump under the terminal, and lands where the mascot fetches it.
  const dotFrom = [HOME + X.terminal + SCALE, GROUND - 100 * SCALE - L.jump.terminal], dotGround = GROUND - 8;
  const K = {
    x: [[3.75, 0], [4.4, X.task, 'linear'], [5.5, X.task], [6.1, X.work, 'linear'], [8.8, X.work], [9.3, X.terminal, 'linear'], [11.2, X.terminal], [11.9, X.dot, 'linear'], [12.6, X.dot], [13.15, 0, 'linear']],
    y: [[0, -(GROUND + 190)], [0.38, 0, 'in'], [14.25, 0], [14.8, -(GROUND + 250), 'in']],
    scaleX: [[0.38, 1], [0.46, 1.3, 'out'], [0.62, 0.92], [0.8, 1], [2.1, 1], [2.25, 1.03], [2.4, 1], [8.4, 1], [8.55, 1.14], [9.6, 1.14], [9.8, 1], [10.0, 1], [10.3, 1.06], [11.9, 1.06], [11.98, 1.2], [12.1, 0.92], [12.3, 1], [13.15, 1], [13.22, 1.18], [13.4, 1], [14.0, 1], [14.2, 1.16], [14.33, 0.9], [14.8, 0.95]],
    scaleY: [[0, 1.12], [0.38, 1.12], [0.46, 0.66, 'out'], [0.62, 1.12], [0.8, 1], [2.1, 1], [2.25, 0.95], [2.4, 1], [8.4, 1], [8.55, 1.14], [9.6, 1.14], [9.8, 1], [10.0, 1], [10.3, 0.9], [11.9, 0.9], [11.98, 0.74], [12.1, 1.12], [12.3, 1], [13.15, 1], [13.22, 0.82], [13.4, 1], [14.0, 1], [14.2, 0.8], [14.33, 1.16], [14.8, 1.08]],
    rotate: [[0.9, 0], [1.2, -5], [1.75, 5], [2.1, 0], [13.4, 0], [13.52, 7], [13.9, 7], [14.0, 0]],
    hairScale: [[8.4, 1], [8.55, 1.8], [9.6, 1.8], [9.8, 1], [10.0, 1], [10.3, 0.55], [12.05, 0.55], [12.2, 1.35], [12.45, 1], [14.25, 1], [14.45, 1.5]],
    hairRotate: [[10.0, 0], [10.3, 22], [12.05, 22], [12.2, 0]],
    eyeX: [[1.0, 0], [1.12, -12], [1.4, -12], [1.55, 12], [1.95, 12], [2.1, 0], [2.6, 0], [2.7, 9], [3.1, 9], [3.2, 0], [3.7, 0], [3.85, 6], [4.9, 6], [5.05, -11], [6.1, -11], [6.2, -8], [8.8, -8], [8.9, -4], [9.6, -4], [9.8, 10], [11.95, 11], [12.1, 0]],
    eyeY: [[1.0, 0], [1.12, 2], [1.95, 2], [2.1, 0], [2.6, 0], [2.7, -7], [3.1, -7], [3.2, -3], [4.9, -4], [8.8, -5], [9.6, -6], [9.8, -2], [10.2, 7], [11.95, 7], [12.1, -3], [13.2, -3], [13.4, 0]],
    wink: [[13.5, 1], [13.58, 0.2, 'in'], [13.72, 0.2], [13.82, 1, 'out']],
    smile: [[3.1, 0], [3.25, 1, 'back'], [4.75, 1], [4.9, 0], [12.3, 0], [12.45, 1, 'back']],
    frown: [[10.0, 0], [10.2, 1, 'back'], [11.95, 1], [12.05, 0]],
    working: [[6.2, 0], [6.35, 1], [8.2, 1], [8.3, 0]], // the dots leave the forehead and orbit like a spinner
    dotBack: [[0, 1], [12.07, 1], [12.08, 1.9, 'linear'], [12.35, 1]],
    angry: [[8.3, 0], [8.5, 1], [9.6, 1], [9.9, 0]],
    sad: [[10.0, 0], [10.3, 1], [11.6, 1], [11.9, 0]],
    taskX: [[2.4, 320], [2.7, 0, 'back']],
    taskY: [[4.675, 0], [4.75, -26, 'out'], [5.05, -(L.task[1] + 260), 'in']],
    terminalScale: [[4.95, 0], [5.25, 1, 'back'], [14.2, 1], [14.45, 0, 'in']],
    terminalY: [[9.575, 0], [9.645, -16, 'out'], [9.875, 0]],
    terminalRotate: [[9.575, 0], [9.645, -3, 'out'], [9.925, 0]],
    looseX: [[9.575, dotFrom[0]], [10.45, HOME + X.dot, 'out']],
    looseY: [[9.575, dotFrom[1]], [9.775, dotFrom[1] - 37, 'out'], [10.15, dotGround, 'in'], [10.28, dotGround - 24, 'out'], [10.42, dotGround, 'in']],
  };
  const HOPS = [[2.62, 1, 0.3, 45], [3.15, 2, 0.3, 50], [3.75, 3, 0.2167, 26], [4.45, 1, 0.45, L.jump.task], [5.5, 3, 0.2, 22], [8.8, 3, 0.1667, 18], [9.35, 1, 0.45, L.jump.terminal], [11.2, 4, 0.175, 9], [12.1, 1, 0.32, 40], [12.6, 1, 0.55, 90]];
  const MOODS = [[0, 'surprised'], [0.9, 'neutral'], [2.6, 'surprised'], [3.1, 'happy'], [4.9, 'surprised'], [5.5, 'neutral'], [6.2, 'suspicious'], [8.2, 'surprised'], [8.4, 'angry'], [9.65, 'surprised'], [10.0, 'sad'], [12.05, 'surprised'], [12.35, 'neutral']];
  const CAPTIONS = [[0, 'Drops in'], [0.9, 'Has nothing to do'], [2.4, 'A task arrives'], [3.1, 'Is happy about it'], [3.75, 'Goes and opens it'], [4.95, 'A terminal opens'], [6.2, 'Gets to work'], [8.2, 'The work fails'], [8.4, 'Loses its temper'], [9.35, 'Hits the terminal, which fixes it, but knocks a dot off its head'], [10.0, 'Is sad about the dot'], [11.2, 'Goes to get it back'], [12.08, 'Has its dot back'], [12.6, 'Jumps to the centre'], [13.4, 'Winks'], [14.0, 'Floats off']];
  const BURSTS = [[3.15, HOME, GROUND - 71 * SCALE], [12.1, HOME + X.dot, GROUND - 71 * SCALE]]; // [second, x, y] of each confetti burst
  const FAILS_AT = 8.2, FIXED_AT = 9.6, DOT_OFF = 9.575, DOT_ON = 12.08, LIFT_OFF = 14.25;
  const TERMINAL_PIVOT = [200 + L.terminal[0], 102 + L.terminal[1]];
  const n = v => v.toFixed(2);

  function draw(t) {
    const hop = hops(HOPS, t), working = track(K.working, t), angry = track(K.angry, t), sad = track(K.sad, t);
    const x = track(K.x, t), y = track(K.y, t) + hop.y, dotOff = t >= DOT_OFF && t < DOT_ON;
    bot.set({
      x, y,
      scaleX: track(K.scaleX, t) * hop.scaleX, scaleY: track(K.scaleY, t) * hop.scaleY,
      rotate: track(K.rotate, t) + (t > LIFT_OFF ? 8 * Math.sin((t - LIFT_OFF) * 16) : 0),
      shakeX: t > 8.45 && t < FIXED_AT ? (Math.sin(t * 62) > 0 ? 2.4 : -2.4) : 0,
      shakeY: working > 0.5 ? 1.2 * Math.sin(t * 30) : 0,
      hairScale: track(K.hairScale, t), hairRotate: track(K.hairRotate, t),
      eyeX: track(K.eyeX, t), eyeY: track(K.eyeY, t),
      mood: at(MOODS, t), wink: track(K.wink, t),
      smile: track(K.smile, t), frown: track(K.frown, t),
      dots: 1 - working, dotScale: [1, 1, dotOff ? 0 : track(K.dotBack, t)],
      orbit: working, orbitAngle: t * 330,
    });
    $('loose-dot').setAttribute('transform', dotOff ? `translate(${n(track(K.looseX, t))} ${n(track(K.looseY, t))})` : 'translate(-50 -50)');
    $('angry-layer').setAttribute('opacity', n(angry)); $('sad-layer').setAttribute('opacity', n(sad));
    const height = Math.min(1, Math.max(0.25, 1 + y / 520));
    $('shadow').setAttribute('transform', `translate(${n(HOME + x)} ${GROUND + 14 * SPREAD}) scale(${n(height)})`);
    $('shadow').setAttribute('fill', angry > 0.5 ? '#b3243f' : sad > 0.5 ? '#4d5d94' : C.shadow);
    $('task').setAttribute('transform', `translate(${n(L.task[0] + track(K.taskX, t))} ${n(L.task[1] + track(K.taskY, t))})`);
    const jolt = t > FAILS_AT && t < 8.4 ? 3 * Math.sin(t * 70) : 0;
    $('terminal').setAttribute('transform', `translate(${n(TERMINAL_PIVOT[0] + jolt)} ${n(TERMINAL_PIVOT[1] + track(K.terminalY, t))}) rotate(${n(track(K.terminalRotate, t))}) scale(${n(Math.max(0, track(K.terminalScale, t)))}) translate(-200 -102)`);
    let cx = 96, cy = ROWS[0][0];
    blocks.forEach((b, i) => {
      const grown = Math.min(1, Math.max(0, (t - b.time) / 0.14)), e = blockEls[i];
      e.setAttribute('x', b.x); e.setAttribute('y', b.y); e.setAttribute('width', n(b.w * grown));
      e.setAttribute('fill', b.fails ? (t >= FIXED_AT ? C.teal : '#ec3a5a') : '#ececec');
      if (grown > 0) { cx = b.x + b.w * grown + 8; cy = b.y; }
    });
    ROWS.forEach(([rowY, list], i) => {
      const started = i === 0 || t >= list[0][1] - 0.2;
      chevronEls[i].setAttribute('opacity', started ? 1 : 0);
      if (started && cy < rowY) { cx = 96; cy = rowY; }
    });
    $('cursor').setAttribute('x', n(cx)); $('cursor').setAttribute('y', cy);
    $('cursor').setAttribute('opacity', t < FAILS_AT && (t * 2) % 1 < 0.62 ? 1 : 0);
    confettiEls.forEach((c, i) => {
      let tf = 'translate(-60 -60) scale(0)';
      for (const [t0, ox, oy] of BURSTS) {
        const u = (t - t0 - (i % 4) * 0.04) / 1.1;
        if (u > 0 && u < 1) { const e = EASE.out(u), [dx, dy] = CONFETTI[i]; tf = `translate(${n(ox + dx * e)} ${n(oy + dy * e + 130 * SPREAD * u * u)}) scale(${n(Math.sin(Math.PI * Math.min(1, u * 1.15)))})`; }
      }
      c.setAttribute('transform', tf);
    });
  }

  let caption = '';
  Mascot.player({
    duration: DURATION, draw, poster: 3.3,
    bar: $('bar'), playButton: $('play'), restartButton: $('restart'),
    onTime: t => {
      const c = at(CAPTIONS, t); if (c !== caption) { caption = c; $('cap').textContent = c; }
      $('clock').textContent = `${t.toFixed(1)}s of ${DURATION.toFixed(1)}s`;
    },
  });
})();
