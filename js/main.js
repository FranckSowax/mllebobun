/* ============================================================
   MADEMOISELLE BOBÙN — la descente du bol
   Scroll-scrub cinématique : GSAP + ScrollTrigger + Lenis
   ============================================================ */

(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CLIP_NAMES = ['clip01', 'st01', 'st02', 'st03', 'st04', 'st05', 'clip07'];
  const FRAME_DIR = 'assets/frames';

  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));

  let manifest = {};
  const frames = {};       // frames[name] = Array<Image|undefined>
  const clipDone = {};     // clip entièrement chargé

  /* ---------- Canvas helpers ---------- */

  const canvases = {};     // name -> {cv, ctx, w, h, last}

  function registerCanvas(name, cv) {
    canvases[name] = { cv, ctx: cv.getContext('2d'), w: 0, h: 0, last: -1 };
    fitCanvas(name);
  }

  function fitCanvas(name) {
    const c = canvases[name];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = c.cv.getBoundingClientRect();
    if (r.width === 0) return;
    c.cv.width = Math.round(r.width * dpr);
    c.cv.height = Math.round(r.height * dpr);
    c.w = r.width;
    c.h = r.height;
    c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function nearestLoaded(name, i) {
    const arr = frames[name];
    if (!arr) return null;
    if (arr[i] && arr[i].complete) return arr[i];
    for (let d = 1; d < arr.length; d++) {
      if (arr[i - d] && arr[i - d].complete) return arr[i - d];
      if (arr[i + d] && arr[i + d].complete) return arr[i + d];
    }
    return null;
  }

  function drawFrame(name, i) {
    const c = canvases[name];
    if (!c || c.w === 0) return;
    const img = nearestLoaded(name, i);
    if (!img) return;
    const ir = img.naturalWidth / img.naturalHeight;
    const cr = c.w / c.h;
    let dw, dh;
    if (ir > cr) { dh = c.h; dw = c.h * ir; } else { dw = c.w; dh = c.w / ir; }
    c.ctx.clearRect(0, 0, c.w, c.h);
    c.ctx.drawImage(img, (c.w - dw) / 2, (c.h - dh) / 2, dw, dh);
    c.last = i;
  }

  /* ---------- Préchargement ---------- */

  function loadClip(name, onProgress) {
    const count = manifest[name];
    frames[name] = new Array(count);
    let loaded = 0;
    return new Promise(resolve => {
      for (let i = 0; i < count; i++) {
        const img = new Image();
        img.onload = img.onerror = () => {
          loaded++;
          if (onProgress) onProgress(loaded / count);
          if (loaded === count) { clipDone[name] = true; resolve(); }
        };
        img.src = `${FRAME_DIR}/${name}/f_${String(i + 1).padStart(3, '0')}.webp`;
        frames[name][i] = img;
      }
    });
  }

  /* ---------- Bol : états 1→6 ---------- */

  const bowlImgs = $$('.bowl-img');
  let bowlState = 1;

  function setBowlState(n, withBurst) {
    n = Math.max(1, Math.min(6, n));
    if (n === bowlState) return;
    bowlState = n;
    bowlImgs.forEach(im => im.classList.toggle('on', +im.dataset.state === n));
    if (!REDUCED) {
      gsap.fromTo('#bowl-ring',
        { scale: 1 },
        { scale: 1.14, duration: .22, ease: 'power2.out', yoyo: true, repeat: 1 });
      if (withBurst) burst();
    }
  }

  /* ---------- Burst de particules caramel ---------- */

  function burst() {
    const host = $('#burst');
    const COUNT = 22;
    for (let i = 0; i < COUNT; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      host.appendChild(s);
      const a = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 120;
      const vx = Math.cos(a) * speed;
      const vy = Math.sin(a) * speed - 40;
      const g = 260;
      const dur = .7 + Math.random() * .5;
      const proxy = { p: 0 };
      gsap.to(proxy, {
        p: 1,
        duration: dur,
        ease: 'none',
        onUpdate() {
          const t = proxy.p * dur;
          const x = vx * t;
          const y = vy * t + .5 * g * t * t;
          s.style.transform = `translate(${x}px, ${y}px) scale(${1 - proxy.p * .6})`;
          s.style.opacity = String(1 - proxy.p);
        },
        onComplete() { s.remove(); }
      });
    }
  }

  /* ---------- Ligne-vermicelle SVG ---------- */

  const WAVES = 9;

  function noodleX(t, W) {
    const amp = W * .012;
    return W * .18 + amp * Math.sin(t * WAVES * Math.PI * 2);
  }

  function buildNoodle() {
    const sec = $('#timeline');
    const svg = $('#noodle-svg');
    const W = sec.clientWidth;
    const H = sec.scrollHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const SAMPLES = WAVES * 24;
    let d = `M ${noodleX(0, W).toFixed(1)} 0`;
    for (let i = 1; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      d += ` L ${noodleX(t, W).toFixed(1)} ${(t * H).toFixed(1)}`;
    }
    $('#noodle-base').setAttribute('d', d);
    const prog = $('#noodle-progress');
    prog.setAttribute('d', d);
    const len = prog.getTotalLength();
    prog.style.strokeDasharray = len;
    if (!REDUCED) prog.style.strokeDashoffset = len;

    // points des stations
    const dots = $('#noodle-dots');
    dots.innerHTML = '';
    $$('.station').forEach(st => {
      const cy = st.offsetTop + st.offsetHeight / 2;
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', noodleX(cy / H, W).toFixed(1));
      c.setAttribute('cy', cy.toFixed(1));
      c.setAttribute('r', 5);
      c.dataset.for = st.dataset.clip;
      dots.appendChild(c);
    });
    return len;
  }

  /* ---------- Particules ambiantes ---------- */

  function spawnMotes() {
    const host = $('#ambient');
    for (let i = 0; i < 26; i++) {
      const m = document.createElement('span');
      m.className = 'mote';
      const size = 2 + Math.random() * 3;
      const dur = 14 + Math.random() * 20;
      m.style.width = size + 'px';
      m.style.height = size + 'px';
      m.style.left = (Math.random() * 100) + 'vw';
      m.style.opacity = (.2 + Math.random() * .35).toFixed(2);
      m.style.animationDuration = dur + 's';
      m.style.animationDelay = (-Math.random() * dur) + 's';
      host.appendChild(m);
    }
  }

  /* ---------- Loader ---------- */

  function loaderProgress(p) {
    $('#loader-fill').style.width = Math.round(p * 100) + '%';
  }

  function hideLoader() {
    const done = () => {
      $('#loader').remove();
      document.body.classList.remove('is-loading');
    };
    if (REDUCED) { done(); return; }
    gsap.to('#loader', {
      autoAlpha: 0, duration: .7, ease: 'power2.inOut', delay: .25,
      onComplete: done
    });
  }

  /* ---------- Mode reduced-motion ---------- */

  async function reducedInit() {
    // frame médiane statique sur chaque canvas, bol complet, pas d'animations
    const jobs = CLIP_NAMES.map(name => new Promise(res => {
      const count = manifest[name];
      const mid = Math.floor(count / 2);
      frames[name] = new Array(count);
      const img = new Image();
      img.onload = img.onerror = () => res();
      img.src = `${FRAME_DIR}/${name}/f_${String(mid + 1).padStart(3, '0')}.webp`;
      frames[name][mid] = img;
    }));
    await Promise.all(jobs);
    buildNoodle();
    CLIP_NAMES.forEach(name => {
      fitCanvas(name);
      drawFrame(name, Math.floor(manifest[name] / 2));
    });
    bowlImgs.forEach(im => im.classList.toggle('on', +im.dataset.state === 6));
    bowlState = 6;
    const panel = $('#cta-panel');
    panel.style.opacity = '1';
    panel.style.visibility = 'visible';
    $$('#noodle-dots circle').forEach(c => c.classList.add('active'));
    hideLoader();
  }

  /* ---------- Init complet ---------- */

  let lenis = null;

  function setupLenis() {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    lenis = new Lenis({
      duration: 1.35,
      easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true
    });
    lenis.stop();
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    window.lenis = lenis;
  }

  function setupHero() {
    const proxy = { f: 0 };
    const n = manifest.clip01;
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        end: '+=220%',
        pin: true,
        scrub: .6,
        anticipatePin: 1
      }
    });
    tl.to(proxy, {
      f: n - 1, ease: 'none', duration: 1,
      onUpdate() {
        const i = Math.round(proxy.f);
        if (i !== canvases.clip01.last) drawFrame('clip01', i);
      }
    }, 0);
    tl.to('.hero-scrollhint', { opacity: 0, duration: .06, ease: 'none' }, .04);
    tl.to('.hero-copy', { opacity: 0, y: -80, duration: .6, ease: 'power1.in' }, .3);
    return tl.scrollTrigger;
  }

  /* Steam wipe : un seul contrôleur par transition (pas de tweens
     concurrents sur la même propriété) — opacité en triangle,
     pic exactement à la couture entre les deux sections. */
  function steamWipe(getStart, getEnd, peak) {
    const steam = $('#steam');
    ScrollTrigger.create({
      start: getStart,
      end: getEnd,
      onUpdate(self) {
        const p = self.progress;
        const o = p <= peak ? p / peak : (1 - p) / (1 - peak);
        steam.style.opacity = (o * .95).toFixed(3);
      },
      onLeave() { steam.style.opacity = 0; },
      onLeaveBack() { steam.style.opacity = 0; }
    });
  }

  function setupTimeline() {
    const noodleLen = buildNoodle();

    // tracé de la ligne au scroll
    gsap.to('#noodle-progress', {
      strokeDashoffset: 0,
      ease: 'none',
      scrollTrigger: {
        trigger: '#timeline',
        start: 'top 50%',
        end: 'bottom 50%',
        scrub: true
      }
    });

    // reveal de l'intro
    gsap.from('.timeline-intro > *', {
      opacity: 0, y: 40, duration: .8, stagger: .12, ease: 'power2.out',
      scrollTrigger: {
        trigger: '.timeline-intro',
        start: 'top 78%',
        toggleActions: 'play none none reverse'
      }
    });

    $$('.station').forEach(st => {
      const name = st.dataset.clip;
      const state = +st.dataset.state;
      const n = manifest[name];

      // scrub de la fenêtre macro
      ScrollTrigger.create({
        trigger: st,
        start: 'top 80%',
        end: 'bottom 20%',
        scrub: .5,
        onUpdate(self) {
          const i = Math.round(self.progress * (n - 1));
          if (i !== canvases[name].last) drawFrame(name, i);
        }
      });

      // le bol gagne sa couche
      ScrollTrigger.create({
        trigger: st,
        start: 'center 52%',
        onEnter: () => setBowlState(state, true),
        onLeaveBack: () => setBowlState(state - 1, false)
      });

      // point lumineux sur la ligne
      ScrollTrigger.create({
        trigger: st,
        start: 'center 72%',
        end: 'center 28%',
        onToggle(self) {
          const dot = $(`#noodle-dots circle[data-for="${name}"]`);
          if (dot) dot.classList.toggle('active', self.isActive);
        }
      });

      // reveal du texte
      gsap.from($$('.st-text > *', st), {
        opacity: 0, y: 44, duration: .8, stagger: .1, ease: 'power2.out',
        scrollTrigger: {
          trigger: $('.st-text', st),
          start: 'top 72%',
          toggleActions: 'play none none reverse'
        }
      });
    });

    return noodleLen;
  }

  function setupFinale() {
    const proxy = { f: 0 };
    const n = manifest.clip07;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: '#finale',
        start: 'top top',
        end: '+=340%',
        pin: true,
        scrub: true,
        anticipatePin: 1
      }
    });
    tl.to(proxy, {
      f: n - 1, ease: 'none', duration: 1,
      onUpdate() {
        const i = Math.round(proxy.f);
        if (i !== canvases.clip07.last) drawFrame('clip07', i);
      }
    }, 0);
    tl.fromTo('#cta-panel',
      { autoAlpha: 0, y: 46 },
      { autoAlpha: 1, y: 0, duration: .35, ease: 'power2.out' }, .6);
    return tl.scrollTrigger;
  }

  function setupTint() {
    const tint = $('#tint');
    const interp = gsap.utils.interpolate(['#3D8BFF', '#E8912D', '#E8912D', '#8C5A2E']);
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate(self) { tint.style.backgroundColor = interp(self.progress); }
    });
  }

  function fullInit() {
    gsap.registerPlugin(ScrollTrigger);
    // Chrome mobile : ignorer les resize verticaux de la barre d'adresse
    ScrollTrigger.config({ ignoreMobileResize: true });
    setupLenis();
    spawnMotes();
    const heroST = setupHero();
    setupTimeline();
    const finaleST = setupFinale();
    setupTint();

    const vh = () => window.innerHeight;
    // wipe sortie du hero : monte sur les ~15% finaux du pin, retombe sur le début de la timeline
    steamWipe(() => heroST.end - vh() * .35, () => heroST.end + vh() * .5, .42);
    // wipe entrée de la finale : monte à l'approche, retombe sur les ~10% initiaux du pin
    steamWipe(() => finaleST.start - vh() * .8, () => finaleST.start + vh() * .45, .64);

    // recalcule la ligne à chaque refresh (resize, pins…)
    ScrollTrigger.addEventListener('refreshInit', buildNoodle);

    // préchargement : hero d'abord, le reste en tâche de fond
    loadClip('clip01', loaderProgress).then(() => {
      drawFrame('clip01', 0);
      hideLoader();
      lenis.start();
      ScrollTrigger.refresh();
      // tâche de fond : stations puis finale
      const rest = ['st01', 'st02', 'st03', 'st04', 'st05', 'clip07'];
      rest.reduce((p, name) => p.then(() =>
        loadClip(name).then(() => {
          const c = canvases[name];
          if (c && c.last >= 0) drawFrame(name, c.last);
          else if (name !== 'clip07') drawFrame(name, 0);
        })
      ), Promise.resolve());
    });

    // resize : recadre les canvas, redessine, refresh
    let lastW = window.innerWidth;
    let rid = null;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(rid);
      rid = setTimeout(() => {
        CLIP_NAMES.forEach(name => {
          fitCanvas(name);
          if (canvases[name].last >= 0) drawFrame(name, canvases[name].last);
        });
        ScrollTrigger.refresh();
      }, 220);
    });
  }

  /* ---------- Boot ---------- */

  async function boot() {
    try {
      const res = await fetch(`${FRAME_DIR}/manifest.json`);
      manifest = await res.json();
    } catch (e) {
      // repli : 73 frames par clip (pipeline par défaut)
      CLIP_NAMES.forEach(n => { manifest[n] = 73; });
    }

    registerCanvas('clip01', $('#hero-canvas'));
    registerCanvas('clip07', $('#finale-canvas'));
    $$('.station').forEach(st => registerCanvas(st.dataset.clip, $('canvas', st)));

    if (REDUCED) {
      $$('.choix-media video').forEach(v => { v.removeAttribute('autoplay'); v.pause(); });
      reducedInit();
    } else {
      fullInit();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
