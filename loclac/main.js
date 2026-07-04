/* ============================================================
   MADEMOISELLE BOBÙN — /loclac : L'Œil du Bol, Loc Lac Bœuf
   Une vidéo master continue de 15 s scrubée frame par frame.
   Portails repérés visuellement (frames 1-based, 15 fps) :
     P1  frames 10–16   plongée dans le bol (whiteout vapeur, pic 13)
     P2  frames 90–98   traversée de la rondelle de citron vert (pic 97)
     P3  frames 131–140 montée de vapeur → dôme de riz rouge
   Plateau final (zénithal + couvercle) : frames 195–226.
   ============================================================ */

(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IS_MOBILE = window.matchMedia('(max-width: 820px)').matches;
  const SET = IS_MOBILE ? 'mobile' : 'desktop';
  const FRAME_DIR = `../assets/frames/loclac-${SET}`;
  const PRELOAD_COUNT = 70;
  const LERP = 0.18;

  const $ = s => document.querySelector(s);

  let N = 226;                 // nb de frames (manifest)
  const frames = [];
  let highestLoaded = -1;      // dernière frame contiguë chargée

  /* ---------- Mapping scroll → frame (vitesse non linéaire).
     Anchors [progress, frame 0-based] : les portails et le plateau
     final reçoivent plus de distance de scroll pour « respirer ». */
  const ANCHORS = [
    [0.00, 0],     // hero : bol kraft dans l'ombre
    [0.07, 9],     // approche du portail 1
    [0.14, 16],    // traversée vapeur (P1, ralenti)
    [0.38, 89],    // marinade, wok secoué, cube dans les flammes
    [0.46, 98],    // rondelle de citron vert (P2, ralenti)
    [0.55, 130],   // riz rouge, ail, poivre concassé
    [0.62, 140],   // montée de vapeur (P3, ralenti)
    [0.82, 194],   // composition du bol, grue ascendante
    [1.00, 225]    // plateau final zénithal + couvercle
  ];

  function progressToFrame(p) {
    for (let i = 1; i < ANCHORS.length; i++) {
      const [p1, f1] = ANCHORS[i - 1];
      const [p2, f2] = ANCHORS[i];
      if (p <= p2) return f1 + (f2 - f1) * ((p - p1) / (p2 - p1));
    }
    return N - 1;
  }

  /* ---------- Sections UI par frame affichée (0-based) ---------- */
  const LAYERS = [
    { el: null, id: '#ui-hero',  from: 0,   to: 8 },
    { el: null, id: '#ui-card1', from: 17,  to: 85 },
    { el: null, id: '#ui-card2', from: 98,  to: 127 },
    { el: null, id: '#ui-cta',   from: 196, to: 9999 }
  ];

  function updateUI(frame) {
    LAYERS.forEach(l => {
      const show = frame >= l.from && frame <= l.to;
      if (show !== l.visible) {
        l.visible = show;
        l.el.classList.toggle('show', show);
      }
    });
  }

  /* ---------- Canvas ---------- */

  const cv = $('#film');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, drawnIndex = -1;

  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawnIndex = -1;
  }

  function draw(i) {
    // jamais de trou noir : si la frame manque, on retient la
    // dernière disponible en dessous, sinon la première au-dessus
    let img = frames[i] && frames[i].complete && frames[i].naturalWidth ? frames[i] : null;
    if (!img) {
      for (let d = i; d >= 0; d--) {
        const f = frames[d];
        if (f && f.complete && f.naturalWidth) { img = f; break; }
      }
    }
    if (!img) {
      for (let d = i + 1; d < N; d++) {
        const f = frames[d];
        if (f && f.complete && f.naturalWidth) { img = f; break; }
      }
    }
    if (!img) return;
    const ir = img.naturalWidth / img.naturalHeight;
    const cr = W / H;
    let dw, dh;
    if (ir > cr) { dh = H; dw = H * ir; } else { dw = W; dh = W / ir; }
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    drawnIndex = i;
  }

  /* ---------- Chargement des frames ---------- */

  function frameSrc(i) {
    return `${FRAME_DIR}/f_${String(i + 1).padStart(3, '0')}.webp`;
  }

  function loadRange(from, to, onEach) {
    return new Promise(resolve => {
      let pending = 0;
      for (let i = from; i <= to && i < N; i++) {
        if (frames[i]) continue;
        pending++;
        const img = new Image();
        frames[i] = img;
        img.onload = img.onerror = () => {
          if (onEach) onEach(i);
          if (--pending === 0) resolve();
        };
        img.src = frameSrc(i);
      }
      if (pending === 0) resolve();
    });
  }

  /* ---------- Particules ambiantes ---------- */

  function spawnMotes() {
    const host = $('#ambient');
    for (let i = 0; i < 24; i++) {
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
    const el = $('#loader');
    if (!el) return;
    const done = () => {
      el.remove();
      document.body.classList.remove('is-loading');
    };
    if (REDUCED || document.body.classList.contains('flat')) { done(); return; }
    gsap.to(el, { autoAlpha: 0, duration: .7, ease: 'power2.inOut', delay: .2, onComplete: done });
  }

  /* ---------- Mode « flat » : reduced-motion ou fallback vidéo ---------- */

  function flatMode() {
    document.body.classList.add('flat');
    const video = $('#film-video');
    video.preload = 'auto';
    video.autoplay = true;
    $('#ui-hero').prepend(video);
    video.play().catch(() => {});
    hideLoader();
  }

  /* ---------- Mode film : scrub complet ---------- */

  let lenis = null;

  function filmInit() {
    gsap.registerPlugin(ScrollTrigger);
    // Chrome mobile : la barre d'adresse déclenche des resize verticaux
    // en plein scroll — on les ignore pour éviter refresh et sauts.
    ScrollTrigger.config({ ignoreMobileResize: true });
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

    fitCanvas();
    spawnMotes();

    LAYERS.forEach(l => { l.el = $(l.id); l.visible = false; });

    // un seul ScrollTrigger global sur la piste
    let targetFrame = 0;
    const track = ScrollTrigger.create({
      trigger: '#scrolltrack',
      start: 'top top',
      end: 'bottom bottom',
      scrub: .5,
      onUpdate(self) { targetFrame = progressToFrame(self.progress); }
    });
    window.__dbg = () => ({
      p: +track.progress.toFixed(4),
      start: track.start,
      end: track.end,
      target: +targetFrame.toFixed(1),
      drawn: drawnIndex,
      y: Math.round(window.scrollY)
    });

    // tint interpolé sur la progression globale
    const tint = $('#tint');
    // #3D8BFF (hero) → #E8912D (marinade/feu) → #C6402B (riz rouge) → #8C5A2E (reveal)
    const STOPS = [[0, '#3D8BFF'], [.24, '#E8912D'], [.48, '#C6402B'], [.60, '#C6402B'], [.85, '#8C5A2E'], [1, '#8C5A2E']];
    const segs = STOPS.slice(0, -1).map((s, i) => ({
      a: s[0], b: STOPS[i + 1][0],
      mix: gsap.utils.interpolate(s[1], STOPS[i + 1][1])
    }));
    function tintAt(p) {
      const s = segs.find(s => p <= s.b) || segs[segs.length - 1];
      return s.mix((p - s.a) / (s.b - s.a || 1));
    }
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate(self) { tint.style.backgroundColor = tintAt(self.progress); }
    });

    // boucle de rendu : lerp de l'index affiché vers la cible
    let displayed = 0;
    let lastMoteC = '';
    gsap.ticker.add(() => {
      displayed += (targetFrame - displayed) * LERP;
      if (Math.abs(targetFrame - displayed) < .02) displayed = targetFrame;
      const i = Math.round(displayed);
      if (i !== drawnIndex) draw(i);
      updateUI(i);
      const moteC = (i >= 97 && i <= 139) ? '#C6402B' : '#E8912D';
      if (moteC !== lastMoteC) {
        lastMoteC = moteC;
        document.documentElement.style.setProperty('--mote-c', moteC);
      }
    });

    // préchargement : les PRELOAD_COUNT premières frames ouvrent le site,
    // le reste suit dans l'ordre en tâche de fond
    let loaded = 0;
    loadRange(0, PRELOAD_COUNT - 1, () => {
      loaded++;
      loaderProgress(loaded / PRELOAD_COUNT);
    }).then(() => {
      draw(0);
      updateUI(0);
      hideLoader();
      lenis.start();
      ScrollTrigger.refresh();
      return loadRange(PRELOAD_COUNT, N - 1, i => {
        // si l'utilisateur attend sur une frame pas encore arrivée
        if (i === drawnIndex || (drawnIndex < i && Math.round(displayed) >= i)) draw(Math.round(displayed));
      });
    });

    // resize : uniquement sur vrai changement de largeur (la hauteur
    // bouge en continu sur mobile quand la barre d'adresse se rétracte)
    let lastW = window.innerWidth;
    let rid = null;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(rid);
      rid = setTimeout(() => {
        fitCanvas();
        draw(Math.round(displayed));
        ScrollTrigger.refresh();
      }, 220);
    });
  }

  /* ---------- Boot ---------- */

  async function boot() {
    if (REDUCED) {
      document.querySelectorAll('.choix-media video').forEach(v => { v.removeAttribute('autoplay'); v.pause(); });
      flatMode();
      return;
    }

    let manifest;
    try {
      const res = await fetch('../assets/frames/manifest.json');
      manifest = await res.json();
      N = manifest['loclac_' + SET];
      if (!N || !manifest.fps) throw new Error('manifest incomplet');
    } catch (e) {
      flatMode();               // repli : mp4 1080p en fond
      return;
    }

    // test de la première frame : si elle échoue, repli vidéo
    const probe = new Image();
    probe.onload = () => filmInit();
    probe.onerror = () => flatMode();
    probe.src = frameSrc(0);
    frames[0] = probe;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
