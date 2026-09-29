/*
 * Playful ML/CV touches on top of the CV page.
 *  1. splat-name — the hero name is drawn as soft 2D gaussians that scatter
 *     away from the cursor and spring back.
 *  2. detector  — hovering a card/chip/photo draws a YOLO-style bounding box
 *     with a class label + confidence that glides between targets.
 * Both bail out on reduced-motion; the detector also skips touch-only devices.
 */
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ─── 1. splat-name ──────────────────────────────────────────────────────
  function splatName() {
    const h1 = document.querySelector('.hero-name');
    if (!h1 || reduced) return;
    const line = h1.querySelector('.hero-name-line') || h1;
    const text = line.textContent.trim();

    const canvas = document.createElement('canvas');
    canvas.className = 'splat-name-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    h1.classList.add('is-splatted');
    h1.appendChild(canvas);

    const hud = document.createElement('p');
    hud.className = 'splat-name-hud';
    h1.insertAdjacentElement('afterend', hud);

    const ctx = canvas.getContext('2d');
    let dpr, W, H, pts = [], sprite = null, spriteAccent = null;
    const mouse = { x: -1e4, y: -1e4, active: false };
    const R = 70; // cursor influence radius (css px)

    // Pre-rendered gaussian blob, tinted per theme.
    function makeSprite(color) {
      const s = document.createElement('canvas');
      const n = 32; s.width = s.height = n;
      const g = s.getContext('2d');
      const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      grad.addColorStop(0, color);
      grad.addColorStop(0.45, color + 'aa');
      grad.addColorStop(1, color + '00');
      g.fillStyle = grad; g.fillRect(0, 0, n, n);
      return s;
    }
    const toHex = (c) => {
      const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d);
      const m = getComputedStyle(d).color.match(/\d+/g); d.remove();
      return '#' + m.slice(0, 3).map((v) => (+v).toString(16).padStart(2, '0')).join('');
    };

    function build() {
      const rect = line.getBoundingClientRect();
      const hr = h1.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      // canvas spans the whole h1 box plus some room for scattered splats
      W = hr.width; H = hr.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

      // rasterize the text offscreen at the exact position the real text sits
      const off = document.createElement('canvas');
      off.width = W; off.height = H;
      const o = off.getContext('2d');
      const cs = getComputedStyle(line);
      o.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      o.textBaseline = 'alphabetic';
      o.fillStyle = '#000';
      // measure baseline from the DOM so canvas letters overlay the real ones
      const m = o.measureText(text);
      const x0 = rect.left - hr.left;
      const y0 = rect.top - hr.top + (rect.height + m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      o.fillText(text, x0, y0);

      const data = o.getImageData(0, 0, W, H).data;
      const step = Math.max(2, Math.round(parseFloat(cs.fontSize) / 30));
      const old = pts;
      pts = [];
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          if (data[(y * W + x) * 4 + 3] > 128) {
            const p = old[pts.length];
            pts.push({
              hx: x, hy: y,
              x: p ? p.x : x + (Math.random() - 0.5) * W * 0.6,
              y: p ? p.y : y + (Math.random() - 0.5) * H * 2,
              vx: 0, vy: 0,
              s: step * (1.8 + Math.random() * 1.6),      // splat scale
              a: Math.random() < 0.08,                    // accent-tinted splat
            });
          }
        }
      }
      tint();
      hud.innerHTML = `<span class="kbd">render</span> ${pts.length.toLocaleString()} gaussians · hover to perturb`;
    }

    function tint() {
      sprite = makeSprite(toHex(css('--ink-0')));
      spriteAccent = makeSprite(toHex(css('--accent')));
    }

    let raf = null, idle = 0;
    function frame() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      let energy = 0;
      for (const p of pts) {
        if (mouse.active) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R * R) {
            const d = Math.sqrt(d2) || 1;
            const f = (1 - d / R) * 2.4;
            p.vx += (dx / d) * f; p.vy += (dy / d) * f;
          }
        }
        p.vx += (p.hx - p.x) * 0.045; p.vy += (p.hy - p.y) * 0.045;
        p.vx *= 0.84; p.vy *= 0.84;
        p.x += p.vx; p.y += p.vy;
        energy += Math.abs(p.vx) + Math.abs(p.vy);
        // stretch splats along their velocity — anisotropic gaussians
        const sp = Math.min(3, Math.hypot(p.vx, p.vy) * 0.25);
        const w = p.s * (1 + sp), h = p.s / (1 + sp * 0.5);
        ctx.save();
        ctx.translate(p.x, p.y);
        if (sp > 0.05) ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.drawImage(p.a ? spriteAccent : sprite, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
      // sleep when settled and the cursor is away
      idle = energy < 0.5 && !mouse.active ? idle + 1 : 0;
      raf = idle > 30 ? null : requestAnimationFrame(frame);
    }
    const wake = () => { if (!raf) { idle = 0; raf = requestAnimationFrame(frame); } };

    const move = (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
      mouse.active = mouse.x > -R && mouse.y > -R && mouse.x < W + R && mouse.y < H + R;
      if (mouse.active) wake();
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', move, { passive: true });
    document.addEventListener('pointerleave', () => { mouse.active = false; });

    // re-sample on resize; re-tint on theme switch
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { build(); wake(); }, 120); });
    new MutationObserver(() => { tint(); wake(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const go = () => { build(); wake(); };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go);
  }

  // ─── 2. detector ────────────────────────────────────────────────────────
  function detector() {
    if (!canHover || reduced) return;
    const CLASSES = [
      ['.hero-portrait', 'person'],
      ['.hero-name-line', 'human.name'],
      ['.pub-card', 'paper'],
      ['.project-card', 'project'],
      ['.news-item', 'news'],
      ['.timeline-item', 'experience'],
      ['.edu-node', 'school'],
      ['.skill-item', 'tool'],
      ['.chip', 'interest'],
      ['.btn', 'button'],
      ['.splat-card', 'gaussians'],
      ['.contact-card', 'friend?'],
    ];
    const sel = CLASSES.map((c) => c[0]).join(',');

    const box = document.createElement('div');
    box.className = 'det-box';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<span class="det-c tl"></span><span class="det-c tr"></span><span class="det-c bl"></span><span class="det-c br"></span><span class="det-label"></span>';
    document.body.appendChild(box);
    const label = box.querySelector('.det-label');

    // deterministic "confidence" per element so it doesn't flicker
    const conf = new WeakMap();
    const score = (el, name) => {
      if (!conf.has(el)) {
        let h = 0; const s = name + (el.textContent || '').slice(0, 40);
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        conf.set(el, (0.86 + (Math.abs(h) % 1300) / 10000).toFixed(2));
      }
      return conf.get(el);
    };

    let target = null;
    const place = () => {
      if (!target) return;
      const r = target.getBoundingClientRect();
      const pad = 6;
      box.style.transform = `translate(${r.left - pad}px, ${r.top - pad}px)`;
      box.style.width = r.width + pad * 2 + 'px';
      box.style.height = r.height + pad * 2 + 'px';
    };

    document.addEventListener('pointerover', (e) => {
      // innermost match wins, so a chip inside a card gets its own box
      const el = e.target.closest(sel);
      if (el === target) return;
      target = el;
      if (!el) { box.classList.remove('on'); return; }
      const name = CLASSES.find((c) => el.matches(c[0]))[1];
      label.textContent = `${name} ${score(el, name)}`;
      place();
      box.classList.add('on');
    });
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
  }

  // ─── 3. diffusion titles ────────────────────────────────────────────────
  // Section titles start as glyph noise and denoise to text as they scroll in,
  // with a DDPM-style timestep counter ticking t=1000 → 0 beside them.
  function diffusionTitles() {
    if (reduced) return;
    const NOISE = '░▒▓#%&@$*+=?/\\<>~^01';
    const T = 28; // frames
    const titles = document.querySelectorAll('.section-title');

    const run = (el) => {
      const text = el.textContent;
      el.setAttribute('aria-label', text);
      // each char denoises at its own random step; spaces stay spaces
      const at = [...text].map((ch) => (ch === ' ' ? -1 : Math.random() * 0.85));
      const tag = document.createElement('span');
      tag.className = 'diff-t';
      el.insertAdjacentElement('afterend', tag);
      let f = 0;
      const step = () => {
        const p = f / T; // 0 = pure noise, 1 = clean
        el.textContent = [...text].map((ch, i) =>
          at[i] < 0 || p >= at[i] + 0.15 ? ch : NOISE[(Math.random() * NOISE.length) | 0]
        ).join('');
        tag.textContent = `t=${Math.round((1 - p) * 1000)}`;
        if (f++ < T) setTimeout(step, 38);
        else { el.textContent = text; tag.classList.add('done'); }
      };
      step();
    };

    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); run(e.target); } });
    }, { threshold: 0.6 });
    titles.forEach((t) => io.observe(t));
  }

  // ─── 4. flow-matching portrait ──────────────────────────────────────────
  // On hover (and once on load) the photo re-generates: pixels travel along
  // straight rectified-flow paths x_t = (1-t)·x0 + t·x1 from gaussian noise.
  function flowPortrait() {
    const wrap = document.querySelector('.hero-portrait');
    const img = wrap && wrap.querySelector('img');
    if (!img || reduced) return;

    const size = () => wrap.getBoundingClientRect().width;
    const canvas = document.createElement('canvas');
    canvas.className = 'flow-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    wrap.appendChild(canvas);
    const tag = document.createElement('span');
    tag.className = 'flow-tag';
    wrap.appendChild(tag);
    const ctx = canvas.getContext('2d');

    let pts = null, S = 0, dpr = 1, playing = false;
    const gauss = () => {
      let u = 0, v = 0;
      while (!u) u = Math.random();
      while (!v) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    function sample() {
      S = size(); dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.height = S * dpr;
      canvas.style.width = canvas.style.height = S + 'px';
      const off = document.createElement('canvas');
      off.width = off.height = S;
      const o = off.getContext('2d');
      // object-fit: cover
      const r = Math.max(S / img.naturalWidth, S / img.naturalHeight);
      const w = img.naturalWidth * r, h = img.naturalHeight * r;
      o.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      let data;
      try { data = o.getImageData(0, 0, S, S).data; } catch (e) { return false; } // tainted canvas
      const step = 3;
      pts = [];
      for (let y = 0; y < S; y += step) {
        for (let x = 0; x < S; x += step) {
          const k = (y * S + x) * 4;
          pts.push({
            x1: x, y1: y,
            x0: S / 2 + gauss() * S * 0.22, y0: S / 2 + gauss() * S * 0.22,
            c: `rgb(${data[k]},${data[k + 1]},${data[k + 2]})`,
            trail: Math.random() < 0.025,
          });
        }
      }
      return true;
    }

    function play() {
      if (playing || !img.complete) return;
      if (!pts && !sample()) return;
      playing = true;
      wrap.classList.add('is-flowing');
      const DUR = 1100, t0 = performance.now();
      const ease = (t) => 1 - Math.pow(1 - t, 3);
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / DUR), e = ease(t);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, S, S);
        // a few straight trajectories, the whole point of rectified flow
        ctx.strokeStyle = css('--accent');
        ctx.globalAlpha = 0.35 * (1 - e);
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (const p of pts) if (p.trail) { ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x1, p.y1); }
        ctx.stroke();
        ctx.globalAlpha = 1;
        const r = 1.2 + e * 2.2;
        for (const p of pts) {
          ctx.fillStyle = p.c;
          ctx.fillRect(p.x0 + (p.x1 - p.x0) * e - r / 2, p.y0 + (p.y1 - p.y0) * e - r / 2, r, r);
        }
        tag.textContent = `flow · t=${e.toFixed(2)}`;
        if (t < 1) requestAnimationFrame(frame);
        else {
          playing = false;
          wrap.classList.remove('is-flowing');
          // resample the noise so every replay is a new draw from N(0, I)
          pts.forEach((p) => { p.x0 = S / 2 + gauss() * S * 0.22; p.y0 = S / 2 + gauss() * S * 0.22; });
        }
      };
      requestAnimationFrame(frame);
    }

    wrap.addEventListener('pointerenter', play);
    window.addEventListener('resize', () => { pts = null; });
    const first = () => setTimeout(play, 500);
    if (img.complete) first(); else img.addEventListener('load', first, { once: true });
  }

  // ─── 5. online HD map (BEV minimap) ─────────────────────────────────────
  // A fixed bird's-eye-view HUD. Scrolling drives the ego car forward; lane
  // dividers / boundaries are "predicted" as vectorized polylines inside the
  // perception range and accumulate behind the car. Sections are crosswalks.
  function onlineMap() {
    if (!window.matchMedia('(min-width: 1100px)').matches) return;

    const hud = document.createElement('aside');
    hud.className = 'bev-hud';
    hud.setAttribute('aria-hidden', 'true');
    hud.innerHTML =
      '<div class="bev-head"><span>online map · BEV</span><button type="button" class="bev-min" tabindex="-1">–</button></div>' +
      '<canvas class="bev-canvas"></canvas>' +
      '<div class="bev-foot"><span class="bev-sec"></span><span class="bev-n"></span></div>';
    document.body.appendChild(hud);
    const canvas = hud.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const secEl = hud.querySelector('.bev-sec');
    const nEl = hud.querySelector('.bev-n');
    hud.querySelector('.bev-min').addEventListener('click', () => hud.classList.toggle('is-min'));

    const W = 176, H = 212, dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

    const PX = 2.0;          // bev px per "meter"
    const K = 0.09;          // meters travelled per scrolled px
    const EGO_Y = H * 0.72;  // ego position on the canvas
    const RANGE = 62;        // perception range ahead (m)
    const LANE = 8;          // lane width (m, exaggerated for legibility)

    // road centerline as a smooth function of distance s
    const cx = (s) => 14 * Math.sin(s / 60) + 6 * Math.sin(s / 23 + 1.3);
    const toScreen = (s, off, egoS) => [W / 2 + (cx(s) - cx(egoS) + off) * PX, EGO_Y - (s - egoS) * PX];

    // sections → crosswalks at their document position
    let crossings = [];
    const layout = () => {
      crossings = [...document.querySelectorAll('.section, .hero')].map((el) => {
        const t = el.querySelector('.section-title');
        return {
          s: (el.getBoundingClientRect().top + window.scrollY) * K,
          name: t ? t.getAttribute('aria-label') || t.textContent : 'about',
        };
      });
    };
    // a few other agents parked along the road (meters, lane offset)
    const agents = [[60, LANE], [140, -LANE], [230, LANE], [320, LANE * 2], [410, -LANE], [520, LANE]];
    let seen = 0; // furthest s the map has been built to

    function draw() {
      const egoS = (window.scrollY + window.innerHeight * 0.35) * K; // ego sits 35% down the viewport
      seen = Math.max(seen, egoS + RANGE);
      const accent = css('--accent'), ink = css('--ink-2'), warn = css('--accent-warn');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // grid
      ctx.strokeStyle = css('--border'); ctx.lineWidth = 1;
      const g = 20, shift = (egoS * PX) % g;
      ctx.beginPath();
      for (let y = shift; y < H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      for (let x = (W / 2) % g; x < W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      ctx.stroke();

      const s0 = egoS - (H - EGO_Y) / PX - 5, s1 = Math.min(seen, egoS + EGO_Y / PX);
      let instances = 0;
      // polyline with vertex dots; points near the range edge jitter like fresh predictions
      const poly = (off, color, dash, width) => {
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.beginPath();
        const verts = [];
        for (let s = s0; s <= s1; s += 3) {
          const fresh = Math.max(0, (s - (egoS + RANGE * 0.6)) / (RANGE * 0.4));
          const [x, y] = toScreen(s, off + (Math.random() - 0.5) * fresh * 2.4, egoS);
          verts.push([x, y, fresh]);
          s === s0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        verts.forEach(([x, y, f], i) => { if (i % 2 === 0) { ctx.globalAlpha = 0.9 - f * 0.5; ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4); } });
        ctx.globalAlpha = 1;
        instances++;
      };
      poly(-LANE * 1.5, ink, [], 1.4);          // road boundaries
      poly(LANE * 2.5, ink, [], 1.4);
      poly(-LANE * 0.5, accent, [5, 4], 1.2);   // lane dividers
      poly(LANE * 0.5, accent, [5, 4], 1.2);
      poly(LANE * 1.5, accent, [5, 4], 1.2);

      // crosswalks + section labels
      let current = crossings[0];
      ctx.font = '9px "JetBrains Mono", monospace';
      crossings.forEach((c) => {
        if (c.s <= egoS) current = c;
        if (c.s < s0 || c.s > s1) return;
        instances++;
        const [xl, y] = toScreen(c.s, -LANE * 1.5, egoS);
        const [xr] = toScreen(c.s, LANE * 2.5, egoS);
        ctx.fillStyle = warn; ctx.globalAlpha = 0.55;
        for (let x = xl + 2; x < xr - 2; x += 5) ctx.fillRect(x, y - 4, 2.5, 8);
        ctx.globalAlpha = 1;
        ctx.fillText(c.name.toLowerCase(), Math.min(xr + 3, W - 60), y + 3);
      });

      // other agents: little boxes with a heading tick
      agents.forEach(([s, off]) => {
        if (s < s0 || s > s1) return;
        instances++;
        const [x, y] = toScreen(s, off, egoS);
        ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
        ctx.strokeRect(x - 3.5, y - 7, 7, 14);
        ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x, y - 11); ctx.stroke();
      });

      // perception range fan
      ctx.fillStyle = accent; ctx.globalAlpha = 0.07;
      ctx.beginPath(); ctx.moveTo(W / 2, EGO_Y);
      ctx.arc(W / 2, EGO_Y, RANGE * PX, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;

      // ego
      ctx.fillStyle = accent;
      ctx.fillRect(W / 2 - 4, EGO_Y - 8, 8, 16);
      ctx.fillStyle = css('--bg-0');
      ctx.fillRect(W / 2 - 2.5, EGO_Y - 5, 5, 3);

      secEl.textContent = current ? '→ ' + current.name.toLowerCase() : '';
      nEl.textContent = `${instances} inst`;
    }

    let queued = false;
    const tick = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };
    window.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', () => { layout(); tick(); });
    new MutationObserver(tick).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // give titles a moment to settle (diffusion swaps their text) before labeling crossings
    layout(); draw();
    setTimeout(() => { layout(); draw(); }, 1500);
  }

  splatName();
  detector();
  diffusionTitles();
  flowPortrait();
  onlineMap();
})();
