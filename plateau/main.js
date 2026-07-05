/* ============================================================
   MADEMOISELLE BOBÙN — LE PLATEAU
   Lazy susan interactif : drag + inertie + snap magnétique,
   permutation de catégories avec bursts, vapeur canvas,
   badge ouvert/fermé temps réel, curseur baguettes.
   ============================================================ */

(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = window.matchMedia('(pointer: fine)').matches;
  const $ = s => document.querySelector(s);

  /* ================= BADGE OUVERT / FERMÉ ================= */

  // horaires réels : lun–ven 11h45–15h & 18h30–22h · sam–dim 18h–22h30
  const DAY_SLOTS = d => (d === 5 || d === 6)
    ? [[18 * 60, 22 * 60 + 30]]
    : [[11 * 60 + 45, 15 * 60], [18 * 60 + 30, 22 * 60]];

  function parisNow() {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t).value;
    const names = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
    const day = names.findIndex(n => get('weekday').toLowerCase().startsWith(n));
    return { min: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10), day };
  }

  const fmtH = m => `${Math.floor(m / 60)}H${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;

  function updateBadge() {
    const badge = $('#badge-ouvert');
    const { min, day } = parisNow();
    const today = DAY_SLOTS(day);
    const open = today.find(([a, b]) => min >= a && min < b);
    if (open) {
      badge.textContent = `OUVERT · FERME À ${fmtH(open[1])}`;
      badge.classList.add('on');
      return;
    }
    badge.classList.remove('on');
    const next = today.find(([a]) => min < a);
    if (next) {
      badge.textContent = `FERMÉ · OUVRE À ${fmtH(next[0])}`;
    } else {
      const tomorrow = DAY_SLOTS((day + 1) % 7);
      badge.textContent = `FERMÉ · OUVRE DEMAIN À ${fmtH(tomorrow[0][0])}`;
    }
  }

  updateBadge();
  setInterval(updateBadge, 60000);

  /* ================= MARQUEE ================= */

  const LINKS = [
    ['DELIVEROO', 'https://deliveroo.fr/fr/menu/bordeaux/gare-st-jean-nansouty/mademoiselle-bobun'],
    ['UBER EATS', 'https://www.ubereats.com/fr/store/mademoiselle-bo-bun/TKMPA668Xsyp7tIMrtloPw']
  ];

  const track = $('#marquee-track');
  track.innerHTML = Array(2).fill(
    Array(3).fill(LINKS.map(([t, u]) =>
      `<a href="${u}" target="_blank" rel="noopener">${t}&nbsp;&nbsp;·</a>`).join('')).join('')
  ).join('');

  /* ================= TICKET (impression au scroll) ================= */

  const ticket = $('#ticket');
  if (!REDUCED && 'IntersectionObserver' in window) {
    ticket.style.clipPath = 'inset(0 0 100% 0)';
    new IntersectionObserver((entries, obs) => {
      if (entries[0].isIntersecting) {
        gsap.to(ticket, { clipPath: 'inset(0 0 0% 0)', duration: .8, ease: 'power2.inOut' });
        obs.disconnect();
      }
    }, { threshold: .3 }).observe(ticket);
  }

  /* ================= DONNÉES + MODES ================= */

  fetch('/assets/menu.json').then(r => r.json()).then(menu => {
    if (REDUCED) buildGrid(menu); else initWheel(menu);
  }).catch(() => buildGridFallback());

  function buildGridFallback() {
    $('#hero').querySelector('.hero-hint').textContent = 'CARTE INDISPONIBLE — RETROUVEZ-NOUS SUR MADEMOISELLEBOBUN.COM';
  }

  /* ================= MODE GRILLE (reduced motion) ================= */

  function buildGrid(menu) {
    const g = $('#grille');
    $('#stage').hidden = true;
    $('#fiche').hidden = true;
    $('#tabs').hidden = true;
    $('.hero-hint').hidden = true;
    $('#hero').style.minHeight = 'auto';
    g.hidden = false;
    g.innerHTML = menu.categories.map(cat =>
      `<h2>${cat.label}</h2>` +
      menu.items.filter(i => i.cat === cat.id).map(i => `
        <article class="gcard">
          <img src="/${i.imgSm}" alt="${i.nom}" loading="lazy">
          <h3>${i.nom}</h3>
          <p>${i.desc}</p>
          <a href="${i.url}" target="_blank" rel="noopener">COMMANDER${i.prix ? ' · ' + i.prix + ' €' : ''}</a>
        </article>`).join('')
    ).join('');
  }

  /* ================= LA ROUE ================= */

  function initWheel(menu) {
    const stage = $('#stage');
    const disc = $('#disc');
    const wheel = $('#wheel');
    const fx = $('#fx');
    const ctx = fx.getContext('2d');
    const MOBILE = () => window.innerWidth <= 820;

    /* Lenis (scroll doux) */
    const lenis = new Lenis({ duration: 1.2, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    const raf0 = t => { lenis.raf(t); };
    gsap.ticker.add(t => raf0(t * 1000));

    const state = {
      theta: 0, vel: 0, dragging: false,
      cat: menu.categories[0].id,
      items: [], els: [],
      active: -1, snapping: false, switching: false,
      R: 200, cx: 0, cy: 0, platSize: 148
    };

    const particles = [];
    let lastSteam = 0;

    /* ---------- tabs ---------- */
    const tabs = $('#tabs');
    tabs.innerHTML = menu.categories.map(c =>
      `<button class="tab" role="tab" data-cat="${c.id}" aria-selected="${c.id === state.cat}">${c.label}</button>`).join('');
    tabs.addEventListener('click', e => {
      const b = e.target.closest('.tab');
      if (b && b.dataset.cat !== state.cat) switchCategory(b.dataset.cat);
    });

    /* ---------- zone de drag circulaire ---------- */
    const hit = document.createElement('div');
    hit.id = 'hitzone';
    Object.assign(hit.style, {
      position: 'absolute', borderRadius: '50%', touchAction: 'none',
      zIndex: 9, left: '0', top: '0'
    });
    stage.appendChild(hit);

    /* ---------- layout ---------- */
    function layout() {
      const sr = stage.getBoundingClientRect();
      const dr = disc.getBoundingClientRect();
      state.cx = dr.left - sr.left + dr.width / 2;
      state.cy = dr.top - sr.top + dr.height / 2;
      state.R = dr.width / 2 * (MOBILE() ? .66 : .60);
      state.platSize = Math.max(96, Math.min(190, dr.width * (MOBILE() ? .20 : .22)));
      document.documentElement.style.setProperty('--platSize', state.platSize + 'px');
      wheel.style.left = state.cx + 'px';
      wheel.style.top = state.cy + 'px';
      Object.assign(hit.style, {
        width: dr.width + 'px', height: dr.height + 'px',
        left: (state.cx - dr.width / 2) + 'px', top: (state.cy - dr.height / 2) + 'px'
      });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fx.width = Math.round(sr.width * dpr);
      fx.height = Math.round(sr.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* ---------- plats ---------- */
    function angleOf(i) { return i * 360 / state.items.length; }
    const normDelta = a => ((a % 360) + 540) % 360 - 180;

    function buildPlats(catId, dropIn) {
      state.items = menu.items.filter(i => i.cat === catId);
      wheel.innerHTML = '';
      state.els = state.items.map((item, i) => {
        const el = document.createElement('div');
        el.className = 'plat';
        el.id = 'plat-' + item.id;
        el.setAttribute('role', 'option');
        el.setAttribute('aria-label', item.nom);
        el.dataset.i = i;
        el.innerHTML = `<div class="plat-inner"><img src="/${item.img}" alt="" draggable="false"></div>`;
        el._drop = dropIn ? -60 : 0;
        el._dropS = dropIn ? .8 : 1;
        el._rx = 0;
        wheel.appendChild(el);
        return el;
      });
      $('#fiche-total').textContent = String(state.items.length).padStart(2, '0');
      state.active = -1;
    }

    /* ---------- rendu ---------- */
    function render() {
      wheel.style.transform = `rotate(${state.theta}deg)`;
      let best = 0, bestD = 1e9;
      state.els.forEach((el, i) => {
        const a = angleOf(i);
        const w = normDelta(a + state.theta);
        const d = Math.abs(w);
        if (d < bestD) { bestD = d; best = i; }
        const f = Math.max(0, 1 - d / 45);
        const blur = Math.min(2, d / 90 * 2);
        el.style.transform = `rotate(${a}deg) translate(${el._rx}px, ${-state.R}px)`;
        const inner = el.firstElementChild;
        inner.style.transform =
          `rotate(${-(a + state.theta)}deg) translateY(${-14 * f + el._drop}px) scale(${(1 + .18 * f) * el._dropS})`;
        inner.style.filter = blur > .15 ? `blur(${blur.toFixed(2)}px)` : 'none';
        el.style.opacity = .85 + .15 * f;
      });
      if (best !== state.active && !state.switching) setActive(best);
    }

    /* ---------- plat actif + fiche ---------- */
    function setActive(i) {
      state.active = i;
      state.els.forEach((el, k) => {
        el.classList.toggle('is-active', k === i);
        el.setAttribute('aria-selected', k === i ? 'true' : 'false');
      });
      wheel.setAttribute('aria-activedescendant', state.els[i] ? state.els[i].id : '');
      updateFiche(state.items[i], i);
    }

    let ficheTl = null;
    function updateFiche(item, i) {
      if (!item) return;
      const fiche = $('#fiche');
      if (ficheTl) ficheTl.kill();
      ficheTl = gsap.timeline();
      ficheTl.to(fiche, { opacity: 0, y: 8, duration: .2, ease: 'power1.in' });
      ficheTl.add(() => {
        $('#fiche-pos').textContent = String(i + 1).padStart(2, '0');
        $('#fiche-nom').textContent = item.nom;
        $('#fiche-desc').textContent = item.desc;
        $('#fiche-desc').classList.remove('open');
        $('#fiche-prix').textContent = item.prix ? item.prix + ' €' : '';
        $('#fiche-cta').href = item.url;
        $('#fiche-cta').setAttribute('aria-label', 'Commander ' + item.nom);
        moreBtn();
      });
      ficheTl.to(fiche, { opacity: 1, y: 0, duration: .35, ease: 'power2.out' });
    }

    /* bouton "voir plus" mobile */
    function moreBtn() {
      let btn = $('.fiche-more');
      const desc = $('#fiche-desc');
      if (!MOBILE()) { if (btn) btn.remove(); return; }
      const clamped = desc.scrollHeight > desc.clientHeight + 4;
      if (clamped && !btn) {
        btn = document.createElement('button');
        btn.className = 'fiche-more';
        btn.textContent = 'VOIR PLUS ↓';
        btn.addEventListener('click', () => {
          const open = desc.classList.toggle('open');
          btn.textContent = open ? 'REPLIER ↑' : 'VOIR PLUS ↓';
        });
        desc.after(btn);
      } else if (!clamped && btn) btn.remove();
    }

    /* ---------- snap magnétique ---------- */
    let snapTween = null;
    function killSnap() { if (snapTween) { snapTween.kill(); snapTween = null; } state.snapping = false; }

    function snap(extra = 0) {
      if (state.switching) return;
      const n = state.items.length;
      let best = null, bestD = 1e9;
      for (let i = 0; i < n; i++) {
        const target = Math.round((state.theta + angleOf(i)) / 360) * 360 - angleOf(i);
        const d = Math.abs(target - state.theta);
        if (d < bestD) { bestD = d; best = target; }
      }
      const to = best + extra;
      state.snapping = true;
      snapTween = gsap.to(state, {
        theta: to, duration: .75, ease: 'power3.out', overwrite: true,
        onComplete: () => { state.snapping = false; }
      });
    }

    function step(dir) {
      killSnap();
      state.vel = 0;
      const stepA = 360 / state.items.length;
      const base = Math.round(state.theta / stepA) * stepA;
      state.snapping = true;
      snapTween = gsap.to(state, {
        theta: base + dir * stepA, duration: .6, ease: 'power3.out', overwrite: true,
        onComplete: () => { state.snapping = false; }
      });
    }

    /* ---------- drag + inertie ---------- */
    let lastX = 0, dragDist = 0;
    hit.addEventListener('pointerdown', e => {
      if (state.switching) return;
      hit.setPointerCapture(e.pointerId);
      state.dragging = true;
      dragDist = 0;
      lastX = e.clientX;
      state.vel = 0;
      killSnap();
      sticks.classList.add('pinch');
    });
    hit.addEventListener('pointermove', e => {
      if (!state.dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      dragDist += Math.abs(dx);
      const K = .22;
      state.theta += dx * K;
      state.vel = state.vel * .7 + dx * K * .3;
    });
    const endDrag = () => {
      if (!state.dragging) return;
      state.dragging = false;
      sticks.classList.remove('pinch');
      if (Math.abs(state.vel) < .25) snap();
    };
    hit.addEventListener('pointerup', endDrag);
    hit.addEventListener('pointercancel', endDrag);

    /* clic sur un plat : tourner jusqu'à lui (si pas un drag) */
    hit.addEventListener('click', e => {
      if (dragDist > 8 || state.switching) return;
      const sr = stage.getBoundingClientRect();
      const x = e.clientX - sr.left - state.cx;
      const y = e.clientY - sr.top - state.cy;
      // angle écran → quel plat ?
      const ang = Math.atan2(x, -y) * 180 / Math.PI;   // 0 = midi
      const n = state.items.length;
      let best = 0, bestD = 1e9;
      for (let i = 0; i < n; i++) {
        const w = normDelta(angleOf(i) + state.theta - ang);
        if (Math.abs(w) < bestD) { bestD = Math.abs(w); best = i; }
      }
      if (best !== state.active) {
        killSnap();
        const target = Math.round((state.theta + angleOf(best)) / 360) * 360 - angleOf(best);
        state.snapping = true;
        snapTween = gsap.to(state, { theta: target, duration: .7, ease: 'power3.out', overwrite: true,
          onComplete: () => { state.snapping = false; } });
      }
    });

    /* molette : crans */
    let acc = 0, wheelLock = false;
    hit.addEventListener('wheel', e => {
      e.preventDefault();
      if (state.switching || wheelLock) return;
      acc += e.deltaY + e.deltaX;
      if (Math.abs(acc) > 50) {
        step(acc > 0 ? -1 : 1);
        acc = 0;
        wheelLock = true;
        setTimeout(() => { wheelLock = false; }, 350);
      }
    }, { passive: false });

    /* clavier */
    wheel.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(1); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const it = state.items[state.active];
        if (it) window.open(it.url, '_blank', 'noopener');
      }
    });

    /* ---------- easter egg lúc lắc ---------- */
    let lastTap = 0;
    function tryShake(e) {
      const it = state.items[state.active];
      const el = state.els[state.active];
      if (!it || !it.loclac_shake || !el) return;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left - 20 || e.clientX > r.right + 20 ||
          e.clientY < r.top - 20 || e.clientY > r.bottom + 20) return;
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      const tip = $('#tooltip-luclac');
      const sr = stage.getBoundingClientRect();
      tip.style.left = (r.left - sr.left + r.width / 2 - 80) + 'px';
      tip.style.top = (r.top - sr.top - 46) + 'px';
      tip.hidden = false;
      clearTimeout(tip._t);
      tip._t = setTimeout(() => { tip.hidden = true; }, 1500);
    }
    hit.addEventListener('dblclick', tryShake);
    hit.addEventListener('pointerup', e => {           // double-tap mobile
      if (e.pointerType !== 'touch' || dragDist > 8) return;
      const now = Date.now();
      if (now - lastTap < 340) tryShake(e);
      lastTap = now;
    });

    /* ---------- permutation de catégorie ---------- */
    const BURSTS = {
      peanuts: ['#E8912D', '#d9a45a', '#b9762a'],
      pepper: ['#2a2118', '#C6402B', '#3a2c20'],
      herbs: ['#86B27A', '#5f8f55', '#a8c79b']
    };

    function platScreenPos(el) {
      const r = el.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      return { x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2 };
    }

    function switchCategory(catId) {
      if (state.switching) return;
      state.switching = true;
      state.vel = 0;
      killSnap();
      tabs.querySelectorAll('.tab').forEach(b =>
        b.setAttribute('aria-selected', b.dataset.cat === catId ? 'true' : 'false'));

      const cat = menu.categories.find(c => c.id === catId);
      const exiting = state.els.slice();
      const tl = gsap.timeline();

      // 1. sortie radiale des plats actuels (glissent par la tranche + fade)
      const grow = { r: 0 };
      exiting.forEach((el, i) => {
        tl.to(el, { opacity: 0, duration: .38, ease: 'power2.in' }, i * .04);
      });
      tl.to(grow, {
        r: 320, duration: .48, ease: 'power2.in',
        onUpdate: () => {
          exiting.forEach((el, i) => {
            el.style.transform = `rotate(${angleOf(i)}deg) translate(0px, ${-(state.R + grow.r)}px)`;
          });
        }
      }, 0);

      // 2. quart de tour à vide
      tl.to(state, { theta: state.theta + 90, duration: .45, ease: 'power2.inOut' }, '>-.05');

      // 3. nouveaux plats qui tombent + bursts
      tl.add(() => {
        buildPlats(catId, true);
        render();
        state.els.forEach((el, i) => {
          gsap.to(el, {
            _drop: 0, _dropS: 1, duration: .65, ease: 'back.out(1.8)',
            delay: .06 * i,
            onStart: () => {
              const p = platScreenPos(el);
              burst(p.x, p.y, BURSTS[cat.burst] || BURSTS.peanuts);
            },
            onUpdate: render
          });
        });
        gsap.delayedCall(.06 * state.els.length + .7, () => {
          state.switching = false;
          snap();
        });
      });
    }

    /* ---------- particules (bursts + vapeur) ---------- */
    function burst(x, y, colors) {
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 160;
        particles.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
          g: 300, r: 1.6 + Math.random() * 2.6, life: 0,
          ttl: .6 + Math.random() * .5, c: colors[i % colors.length], type: 'b'
        });
      }
    }

    function steam() {
      const el = state.els[state.active];
      if (!el) return;
      const p = platScreenPos(el);
      particles.push({
        x: p.x + (Math.random() - .5) * state.platSize * .4,
        y: p.y - state.platSize * .42,
        vx: 0, vy: -22 - Math.random() * 14, g: 0,
        r: 5 + Math.random() * 7, life: 0, ttl: 2.4 + Math.random(),
        wig: 6 + Math.random() * 8, ph: Math.random() * 6.28,
        c: '244,237,224', type: 's'
      });
    }

    let lastT = performance.now();
    function frame(now) {
      const dt = Math.min(.05, (now - lastT) / 1000);
      lastT = now;

      // inertie
      if (!state.dragging && !state.snapping && !state.switching && Math.abs(state.vel) > .02) {
        state.theta += state.vel;
        state.vel *= .945;
        if (Math.abs(state.vel) <= .25) { state.vel = 0; snap(); }
      }
      if (!state.switching) render();

      // vapeur du plat actif
      if (!state.switching && now - lastSteam > 420 && particles.length < 130) {
        lastSteam = now;
        steam();
      }

      // dessin particules
      ctx.clearRect(0, 0, fx.width, fx.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life > p.ttl) { particles.splice(i, 1); continue; }
        const t = p.life / p.ttl;
        if (p.type === 'b') {
          p.vy += p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (1 - t * .4), 0, 6.28);
          ctx.fill();
        } else {
          p.y += p.vy * dt;
          const wx = Math.sin(p.ph + p.life * 2.2) * p.wig;
          ctx.globalAlpha = .16 * (1 - t);
          ctx.fillStyle = `rgba(${p.c},1)`;
          ctx.beginPath();
          ctx.arc(p.x + wx, p.y, p.r * (1 + t * 1.6), 0, 6.28);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }

    /* ---------- curseur baguettes ---------- */
    const sticks = $('#chopsticks');
    if (FINE) {
      document.body.classList.add('sticks-on');
      window.addEventListener('pointermove', e => {
        sticks.style.transform = `translate(${e.clientX - 26}px, ${e.clientY - 26}px)`;
        const overStage = document.elementFromPoint(e.clientX, e.clientY);
        const inZone = overStage && stage.contains(overStage) &&
          !overStage.closest('a, button, .fiche');
        sticks.classList.toggle('vis', !!inZone);
      }, { passive: true });
    }

    /* ---------- resize ---------- */
    let lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      layout();
      render();
    });

    /* ---------- préchargement différé des autres catégories ---------- */
    setTimeout(() => {
      menu.items.filter(i => i.cat !== state.cat).forEach(i => { new Image().src = '/' + i.img; });
    }, 2500);

    /* ---------- go ---------- */
    layout();
    buildPlats(state.cat, false);
    render();
    requestAnimationFrame(frame);
  }
})();
