/* ============================================================
   MADEMOISELLE BOBÙN — LE COMPTOIR
   Un plat = un écran (scroll-snap natif). Vidéos de bols
   tournants (ou visuel zénithal en rotation lente à défaut),
   rail vermicelle, compteur, badge ouvert/fermé.
   ============================================================ */

(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = s => document.querySelector(s);

  /* ---------- badge ouvert / fermé (Europe/Paris) ---------- */

  const DAY_SLOTS = d => (d === 5 || d === 6)
    ? [[18 * 60, 22 * 60 + 30]]
    : [[11 * 60 + 45, 15 * 60], [18 * 60 + 30, 22 * 60]];

  function parisNow() {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t).value;
    const names = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
    return {
      min: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
      day: names.findIndex(n => get('weekday').toLowerCase().startsWith(n))
    };
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
    badge.textContent = next
      ? `FERMÉ · OUVRE À ${fmtH(next[0])}`
      : `FERMÉ · OUVRE DEMAIN À ${fmtH(DAY_SLOTS((day + 1) % 7)[0][0])}`;
  }

  updateBadge();
  setInterval(updateBadge, 60000);

  /* ---------- vidéos disponibles par plat ---------- */

  const VIDEO = {
    'bobun-boeuf': '/assets/video/choix/bobun-boeuf.mp4',
    'bobun-poulet': '/assets/video/choix/bobun-poulet.mp4',
    'bobun-crevette': '/assets/video/carte/bobun-crevette.mp4',
    'bobun-veggie': '/assets/video/choix/bobun-veggie.mp4',
    'loclac-boeuf': '/assets/video/carte/loclac.mp4',
    'loclac-poulet': '/assets/video/carte/loclac-poulet.mp4',
    'loclac-veggie': '/assets/video/carte/loclac-veggie.mp4',
    'nems': '/assets/video/carte/nems.mp4',
    'rouleaux': '/assets/video/carte/rouleaux.mp4'
  };

  /* ---------- construction des écrans ---------- */

  fetch('/assets/menu.json').then(r => r.json()).then(build).catch(() => {
    $('.intro-sub').textContent = 'Carte indisponible — retrouvez-nous sur mademoisellebobun.com';
  });

  function build(menu) {
    const fin = $('#fin');
    const catLabel = id => (menu.categories.find(c => c.id === id) || {}).label || '';

    menu.items.forEach((item, idx) => {
      const sec = document.createElement('section');
      sec.className = 'plat-screen';
      sec.id = 'p-' + item.id;
      sec.dataset.cat = item.cat;
      const media = VIDEO[item.id] && !REDUCED
        ? `<video src="${VIDEO[item.id]}" muted loop playsinline preload="metadata" aria-hidden="true"></video>`
        : `<img src="/${item.img}" alt="" class="${REDUCED ? '' : 'spin'}" loading="lazy">`;
      sec.innerHTML = `
        <div class="plat-in">
          <div class="plat-media">${media}</div>
          <div class="plat-txt">
            <p class="eyebrow">${catLabel(item.cat)} · ${String(idx + 1).padStart(2, '0')}</p>
            <h2>${item.nom}</h2>
            <p class="plat-desc">${item.desc}</p>
            <p class="plat-prix">${item.prix ? item.prix + ' €' : ''}</p>
            <a class="plat-cta" href="${item.url}" target="_blank" rel="noopener" aria-label="Commander ${item.nom}">COMMANDER</a>
          </div>
        </div>`;
      fin.before(sec);
    });

    const screens = Array.from(document.querySelectorAll('.plat-screen'));
    const platScreens = screens.filter(s => s.dataset.cat);

    /* ---------- dots ---------- */
    const dots = $('#dots');
    let lastCat = null;
    platScreens.forEach(sec => {
      if (lastCat && sec.dataset.cat !== lastCat) {
        const gap = document.createElement('span');
        gap.className = 'gap';
        dots.appendChild(gap);
      }
      lastCat = sec.dataset.cat;
      const a = document.createElement('a');
      a.href = '#' + sec.id;
      a.dataset.for = sec.id;
      a.setAttribute('aria-label', sec.querySelector('h2').textContent);
      dots.appendChild(a);
    });

    /* ---------- rail vermicelle ---------- */
    const W = 12, H = 400, waves = 7, amp = 4;
    let d = `M 6 0`;
    for (let i = 1; i <= 140; i++) {
      const t = i / 140;
      d += ` L ${(6 + amp * Math.sin(t * waves * Math.PI * 2)).toFixed(2)} ${(t * H).toFixed(1)}`;
    }
    $('#rail-base').setAttribute('d', d);
    const prog = $('#rail-prog');
    prog.setAttribute('d', d);
    const len = prog.getTotalLength();
    prog.style.strokeDasharray = len;
    prog.style.strokeDashoffset = len;

    /* ---------- observation : écran actif ---------- */
    const count = $('#rail-count');
    const total = platScreens.length;

    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        const sec = en.target;
        const vid = sec.querySelector('video');
        if (en.isIntersecting && en.intersectionRatio > .5) {
          sec.classList.add('seen');
          if (vid) vid.play().catch(() => {});
          const i = platScreens.indexOf(sec);
          if (i >= 0) {
            count.textContent = `${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
            prog.style.strokeDashoffset = len * (1 - (i + 1) / total);
            document.documentElement.style.setProperty('--acc',
              { bobun: '#E8912D', loclac: '#C6402B', rolls: '#86B27A' }[sec.dataset.cat] || '#E8912D');
            dots.querySelectorAll('a').forEach(a =>
              a.classList.toggle('on', a.dataset.for === sec.id));
          } else if (sec.id === 'intro') {
            count.textContent = `— / ${String(total).padStart(2, '0')}`;
            prog.style.strokeDashoffset = len;
            dots.querySelectorAll('a').forEach(a => a.classList.remove('on'));
          }
        } else if (vid && !en.isIntersecting) {
          vid.pause();
        }
      });
    }, { threshold: [0, .55] });

    screens.forEach(s => io.observe(s));
  }
})();
