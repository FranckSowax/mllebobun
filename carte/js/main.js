/* ============================================================
   MADEMOISELLE BOBÙN — rails horizontaux cinématiques
   scroll vertical → défilement horizontal, catégorie par catégorie
   ============================================================ */

(async () => {
  'use strict';

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOBILE = matchMedia('(max-width: 820px)').matches;
  const $ = s => document.querySelector(s);

  /* ---------- données ---------- */
  // en prod le menu est inliné dans le HTML (zéro requête avant la 1re peinture) ;
  // en dev on retombe sur le fichier.
  const inline = document.getElementById('menu-data');
  const menu = inline ? JSON.parse(inline.textContent)
    : await fetch('/carte/data/menu.json').then(r => r.json());

  // synchro des prix sur le dashboard, en différé : ne retarde jamais le rendu
  function syncPrices() {
    fetch('https://www.mademoisellebobun.com/api/menu/public', { signal: AbortSignal.timeout(3500) })
      .then(r => r.json())
      .then(pub => {
        const live = {};
        (pub.items || []).forEach(m => { live[m.id] = m.amount; });
        menu.items.forEach(it => {
          if (it.sync && live[it.sync] != null) {
            const prix = (live[it.sync] / 100).toFixed(2).replace('.', ',') + ' €';
            it.prix = prix;
            const el = document.querySelector(`.card[data-id="${it.id}"] .card-prix`);
            if (el) el.textContent = prix;
          }
        });
      })
      .catch(() => { /* prix embarqués conservés */ });
  }

  /* ---------- badge OUVERT / FERMÉ (Europe/Paris) ---------- */

  (function badge() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const day = now.getDay(); // 0 dim … 6 sam
    const mins = now.getHours() * 60 + now.getMinutes();
    const week = day >= 1 && day <= 5;
    const windows = week
      ? [[11 * 60 + 45, 15 * 60], [18 * 60 + 30, 22 * 60]]
      : [[18 * 60, 22 * 60 + 30]];
    const open = windows.some(([a, b]) => mins >= a && mins < b);
    const el = $('#open-badge');
    const fmt = m => `${Math.floor(m / 60)}H${String(m % 60).padStart(2, '0')}`;
    if (open) {
      const until = windows.find(([a, b]) => mins >= a && mins < b)[1];
      el.textContent = `● OUVERT · JUSQU'À ${fmt(until)}`;
      el.classList.add('open');
    } else {
      const next = windows.find(([a]) => mins < a);
      el.textContent = next ? `○ FERMÉ · OUVRE À ${fmt(next[0])}` : `○ FERMÉ · OUVRE ${week && day !== 5 ? 'DEMAIN 11H45' : 'DEMAIN 18H'}`;
      el.classList.add('closed');
    }
  })();

  /* ---------- construction des rails ---------- */

  const railsEl = $('#rails');
  const cats = menu.categories;
  const byCat = id => menu.items.filter(i => i.cat === id);

  cats.forEach((cat, ci) => {
    const items = byCat(cat.id);
    const sec = document.createElement('section');
    sec.className = 'rail';
    sec.dataset.cat = cat.id;
    sec.style.setProperty('--acc', cat.accent);
    sec.innerHTML = `
      <div class="rail-pin">
        <div class="rail-title" aria-hidden="true">${cat.label}&nbsp;&nbsp;·&nbsp;&nbsp;${cat.label}</div>
        <div class="rail-head">
          <p class="eyebrow">${String(ci + 1).padStart(2, '0')} — LA CARTE</p>
          <h2>${cat.label}</h2>
        </div>
        <div class="rail-track" role="list" tabindex="0" aria-label="${cat.label} — ${items.length} plats. Flèches gauche et droite pour naviguer.">
          ${items.map((it, ii) => `
            <article class="card" role="listitem" data-id="${it.id}">
              <div class="card-media ${it.shape}">
                <img src="/carte/assets/plats/${it.id}.webp"
                     srcset="/carte/assets/plats/${it.id}@sm.webp 320w, /carte/assets/plats/${it.id}.webp 640w"
                     sizes="(max-width:820px) 78vw, 24vw"
                     alt="${it.nom} à emporter — Mademoiselle Bobùn, Bordeaux" width="640" height="640"
                     loading="lazy">
              </div>
              <h3>${it.nom}</h3>
              <p class="card-prix">${it.prix}</p>
              <p class="card-desc">${it.desc}</p>
              <a class="card-cta" href="${it.url}" ${it.url.startsWith('http') && !it.url.includes('mademoisellebobun') ? 'target="_blank" rel="noopener"' : ''}>COMMANDER</a>
            </article>`).join('')}
        </div>
        <div class="rail-foot">
          <div class="rail-progress"><i></i></div>
          <span class="rail-count">01 / ${String(items.length).padStart(2, '0')}</span>
        </div>
      </div>`;
    railsEl.appendChild(sec);

    if (ci < cats.length - 1) {
      const band = document.createElement('div');
      band.className = 'band';
      band.dataset.from = cat.accent;
      band.dataset.to = cats[ci + 1].accent;
      band.style.setProperty('--band-acc', cats[ci + 1].accent);
      band.setAttribute('aria-hidden', 'true');
      band.innerHTML = `<svg viewBox="0 0 560 60" preserveAspectRatio="none">
        <path d="M0,30 C60,6 110,54 170,30 C230,6 280,54 340,30 C400,6 450,54 510,30 L560,30"/>
      </svg>`;
      railsEl.appendChild(band);
    }
  });

  /* ---------- marquee footer ---------- */

  const seq = `<span>CLICK'N'COLLECT</span><span>·</span><span><em>WHATSAPP</em></span><span>·</span><span>DELIVEROO</span><span>·</span><span>UBER EATS</span><span>·</span>`;
  $('#marquee-track').innerHTML = seq + seq;

  syncPrices(); // après la construction du DOM — met à jour les prix en place

  /* ---------- HERO — film scrub (wok flambé -> bol dressé) ---------- */

  const HERO_N = 121;
  const heroCanvas = $('#hero-film');
  const hctx = heroCanvas.getContext('2d');
  const heroFrames = new Array(HERO_N);
  let heroCur = 0;
  const heroSrc = i => `/carte/assets/hero/f_${String(i).padStart(3, '0')}.webp`;

  function heroDraw(i) {
    // frame chargée la plus proche (vers l'arrière d'abord, sinon vers l'avant)
    let img = null;
    for (let k = i; k >= 0; k--) if (heroFrames[k] && heroFrames[k].ok) { img = heroFrames[k]; break; }
    if (!img) for (let k = i + 1; k < HERO_N; k++) if (heroFrames[k] && heroFrames[k].ok) { img = heroFrames[k]; break; }
    if (!img) return;
    const cw = heroCanvas.width, ch = heroCanvas.height;
    const s = Math.max(cw / img.width, ch / img.height);
    const dw = img.width * s, dh = img.height * s;
    hctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  function heroSize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    heroCanvas.width = heroCanvas.clientWidth * dpr;
    heroCanvas.height = heroCanvas.clientHeight * dpr;
    heroDraw(heroCur);
  }

  function heroLoad(i, cb) {
    if (heroFrames[i]) return;
    const im = new Image();
    heroFrames[i] = im;
    im.onload = () => { im.ok = true; if (cb) cb(i); };
    im.src = heroSrc(i);
  }

  heroSize();
  heroLoad(0, () => heroDraw(heroCur));
  if (!REDUCED) {
    // passes progressives : grossière (1/6) puis complète — sans peser sur la 1re peinture
    const warm = () => {
      for (let i = 0; i < HERO_N; i += 6) heroLoad(i, k => { if (Math.abs(k - heroCur) < 9) heroDraw(heroCur); });
      setTimeout(() => { for (let i = 0; i < HERO_N; i++) heroLoad(i); }, 1400);
    };
    (window.requestIdleCallback || (f => setTimeout(f, 350)))(warm);
  }
  addEventListener('resize', heroSize);

  /* ---------- état partagé (un seul rAF pour tout) ---------- */

  const state = {
    activeTrack: null,   // piste du rail actuellement en scène
    activeAccent: '#E8912D',
    hotCard: null,       // card au centre (émettrice de vapeur)
    velocity: 0
  };

  const tracks = [...document.querySelectorAll('.rail-track')];
  const railSecs = [...document.querySelectorAll('.rail')];

  /* ---------- canvas : vapeur + particules ambiantes + bursts ---------- */

  const canvas = $('#fx');
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(devicePixelRatio || 1, 2);
  let CW = 0, CH = 0;
  function sizeCanvas() {
    CW = innerWidth; CH = innerHeight;
    canvas.width = CW * DPR; canvas.height = CH * DPR;
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  sizeCanvas();

  // sprite doux pré-rendu (halo blanc)
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const sctx = sprite.getContext('2d');
  const g = sctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, 64, 64);

  const vapor = [];    // filet de vapeur de la card centrale
  const ambient = [];  // poussières ambiantes
  const burst = [];    // éclats colorés à l'entrée d'un rail

  for (let i = 0; i < 22; i++) {
    ambient.push({
      x: Math.random() * CW, y: Math.random() * CH,
      vy: -(.08 + Math.random() * .2), drift: Math.random() * Math.PI * 2,
      s: 1.5 + Math.random() * 3, a: .04 + Math.random() * .07
    });
  }

  function emitBurst(x, y, color) {
    for (let i = 0; i < 40; i++) {
      const an = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 4.5;
      burst.push({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 1.2, life: 1, s: 1.6 + Math.random() * 3, color });
    }
  }

  function drawFx() {
    ctx.clearRect(0, 0, CW, CH);

    // vapeur : émise du bord haut de la card centrale
    if (state.hotCard && !REDUCED) {
      const r = state.hotCard.getBoundingClientRect();
      if (r.bottom > 0 && r.top < CH && vapor.length < 46) {
        vapor.push({
          x: r.left + r.width * (.32 + Math.random() * .36),
          y: r.top + 6,
          vy: -(.5 + Math.random() * .7), sway: Math.random() * Math.PI * 2,
          life: 1, s: 9 + Math.random() * 16
        });
      }
    }
    for (let i = vapor.length - 1; i >= 0; i--) {
      const p = vapor[i];
      p.life -= .009; p.y += p.vy; p.sway += .045;
      p.x += Math.sin(p.sway) * .5; p.s += .12;
      if (p.life <= 0) { vapor.splice(i, 1); continue; }
      ctx.globalAlpha = p.life * .13;
      ctx.drawImage(sprite, p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
    }

    // poussières ambiantes
    for (const p of ambient) {
      p.y += p.vy; p.drift += .01; p.x += Math.sin(p.drift) * .25;
      if (p.y < -10) { p.y = CH + 10; p.x = Math.random() * CW; }
      ctx.globalAlpha = p.a;
      ctx.drawImage(sprite, p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
    }

    // bursts colorés
    for (let i = burst.length - 1; i >= 0; i--) {
      const p = burst[i];
      p.life -= .022; p.x += p.vx; p.y += p.vy; p.vy += .07; p.vx *= .985;
      if (p.life <= 0) { burst.splice(i, 1); continue; }
      ctx.globalAlpha = p.life * .8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- centre-scène : interpolation continue ---------- */

  function stageTrack(track) {
    const vw = innerWidth, center = vw / 2;
    let best = null, bestD = 1e9;
    for (const card of track.children) {
      const r = card.getBoundingClientRect();
      if (r.right < -80 || r.left > vw + 80) { continue; }
      const d = (r.left + r.width / 2 - center) / center;   // -1 … 1
      const t = Math.max(0, 1 - Math.min(Math.abs(d), 1));  // 1 au centre
      const scale = .94 + t * .14;
      const sat = .85 + t * .15;
      card.style.transform = `scale(${scale.toFixed(4)})`;
      card.style.filter = `saturate(${sat.toFixed(3)})`;
      card.style.setProperty('--sh', t.toFixed(3));
      card.style.zIndex = t > .5 ? 2 : 1;
      // parallaxe interne du visuel, en opposition au rail
      const img = card.querySelector('img');
      if (img) img.style.transform = `translateX(${(d * 14).toFixed(1)}px)`;
      const ad = Math.abs(d);
      if (ad < bestD) { bestD = ad; best = card; }
    }
    if (best && best !== state.hotCard) {
      state.hotCard = best;
      const idx = [...track.children].indexOf(best) + 1;
      const count = track.closest('.rail-pin').querySelector('.rail-count');
      if (count) count.textContent = `${String(idx).padStart(2, '0')} / ${String(track.children.length).padStart(2, '0')}`;
    }
  }

  function tick() {
    if (state.activeTrack && !REDUCED) stageTrack(state.activeTrack);
    drawFx();
  }

  /* ============================================================
     DESKTOP — Lenis + rails pinnés GSAP
     ============================================================ */

  if (!MOBILE && !REDUCED && window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    const lenis = new Lenis({ smoothWheel: true, lerp: .1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => {
      lenis.raf(t * 1000);
      tick();
    });
    gsap.ticker.lagSmoothing(0);

    // hero : UN SEUL trigger pinné qui pilote les frames (onUpdate) ET les textes (timeline)
    gsap.timeline({
      scrollTrigger: {
        trigger: '#hero', start: 'top top', end: '+=260%',
        pin: true, scrub: .6, anticipatePin: 1,
        onUpdate(self) {
          heroCur = Math.round(self.progress * (HERO_N - 1));
          heroDraw(heroCur);
        }
      }
    })
      .to('.hero-cue', { autoAlpha: 0, duration: .08, ease: 'none' }, .06)
      .to('#hero-s1', { autoAlpha: 0, y: -44, duration: .2, ease: 'none' }, .24)
      .fromTo('#hero-s2', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: .16, ease: 'none' }, .58)
      .to('#hero-s2', { autoAlpha: 0, duration: .1, ease: 'none' }, .9);

    railSecs.forEach(sec => {
      const track = sec.querySelector('.rail-track');
      const title = sec.querySelector('.rail-title');
      const bar = sec.querySelector('.rail-progress i');
      const cards = [...track.children];
      const n = cards.length;
      const dist = () => Math.max(160, n * 55) * innerHeight / 100;
      const maxX = () => Math.max(0, track.scrollWidth - innerWidth + innerWidth * .12);

      gsap.to(track, {
        x: () => -maxX(),
        ease: 'none',
        scrollTrigger: {
          trigger: sec,
          start: 'top top',
          end: () => '+=' + dist(),
          scrub: .6,
          pin: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onToggle(self) {
            if (self.isActive) {
              state.activeTrack = track;
              state.activeAccent = getComputedStyle(sec).getPropertyValue('--acc').trim();
              $('#tint').style.background = state.activeAccent;
            } else if (state.activeTrack === track) {
              state.activeTrack = null;
              state.hotCard = null;
            }
          },
          onUpdate(self) {
            if (bar) bar.style.width = (self.progress * 100).toFixed(2) + '%';
          }
        }
      });

      // titre géant en contre-défilement (parallaxe inverse)
      gsap.fromTo(title,
        { x: () => -innerWidth * .15 },
        {
          x: () => maxX() * .3,
          ease: 'none',
          scrollTrigger: { trigger: sec, start: 'top top', end: () => '+=' + dist(), scrub: .6 }
        });

      // entrée en cascade + burst aux couleurs de la catégorie
      ScrollTrigger.create({
        trigger: sec,
        start: 'top 60%',
        once: true,
        onEnter() {
          gsap.from(cards, { x: 120, autoAlpha: 0, duration: .8, stagger: .06, ease: 'power3.out', clearProps: 'opacity,visibility' });
          const acc = getComputedStyle(sec).getPropertyValue('--acc').trim();
          emitBurst(innerWidth * .72, innerHeight * .5, acc);
        }
      });
    });

    // bandes de transition : ligne-vermicelle dessinée + contamination du tint
    document.querySelectorAll('.band').forEach(band => {
      const path = band.querySelector('path');
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      gsap.to(path, {
        strokeDashoffset: 0,
        ease: 'none',
        scrollTrigger: { trigger: band, start: 'top 90%', end: 'bottom 40%', scrub: .5 }
      });
      ScrollTrigger.create({
        trigger: band,
        start: 'top bottom',
        end: 'bottom top',
        onUpdate(self) {
          $('#tint').style.background = gsap.utils.interpolate(band.dataset.from, band.dataset.to)(self.progress);
        }
      });
    });

    // clavier : ←/→ quand un rail a le focus → avance d'une card
    tracks.forEach(track => {
      track.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const card = track.children[0].getBoundingClientRect();
        const st = ScrollTrigger.getAll().find(s => s.pin && s.trigger.contains(track));
        if (!st) return;
        const total = st.end - st.start;
        const mx = Math.max(1, track.scrollWidth - innerWidth + innerWidth * .12);
        const step = (card.width + 30) / mx * total;
        lenis.scrollTo(lenis.scroll + (e.key === 'ArrowRight' ? step : -step));
      });
    });

    addEventListener('resize', () => { sizeCanvas(); ScrollTrigger.refresh(); });
  }

  /* ============================================================
     MOBILE / REDUCED — carrousels natifs + effets légers
     ============================================================ */

  else {
    // rAF unique (vapeur + particules) — coupé si reduced-motion
    if (!REDUCED) {
      (function loop() { tick(); requestAnimationFrame(loop); })();
    }

    tracks.forEach(track => {
      const bar = track.closest('.rail-pin').querySelector('.rail-progress i');
      const count = track.closest('.rail-pin').querySelector('.rail-count');
      const cards = [...track.children];

      // card centrée : IntersectionObserver sur l'axe du carrousel
      const io = new IntersectionObserver(entries => {
        entries.forEach(en => {
          en.target.classList.toggle('is-center', en.isIntersecting);
          if (en.isIntersecting) {
            state.hotCard = en.target;
            if (count) count.textContent =
              `${String(cards.indexOf(en.target) + 1).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`;
          }
        });
      }, { root: track, rootMargin: '0% -36% 0% -36%', threshold: .25 });
      cards.forEach(c => io.observe(c));

      // barre de progression du carrousel
      track.addEventListener('scroll', () => {
        const mx = track.scrollWidth - track.clientWidth;
        if (bar && mx > 0) bar.style.width = (track.scrollLeft / mx * 100).toFixed(1) + '%';
      }, { passive: true });

      // clavier
      track.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const w = cards[0].getBoundingClientRect().width + 20;
        track.scrollBy({ left: e.key === 'ArrowRight' ? w : -w, behavior: 'smooth' });
      });
    });

    // tint : couleur de la catégorie visible + titres en parallaxe léger
    const titles = [...document.querySelectorAll('.rail-title')];
    addEventListener('scroll', () => {
      let current = null;
      railSecs.forEach(sec => {
        const r = sec.getBoundingClientRect();
        if (r.top < innerHeight * .5 && r.bottom > innerHeight * .5) current = sec;
        const t = sec.querySelector('.rail-title');
        if (t && r.bottom > 0 && r.top < innerHeight) {
          const p = 1 - r.top / innerHeight;
          t.style.transform = `translateX(${(p * -60).toFixed(1)}px)`;
        }
      });
      if (current) $('#tint').style.background = getComputedStyle(current).getPropertyValue('--acc').trim();
    }, { passive: true });

    addEventListener('resize', sizeCanvas);
  }
})();
