/* ============================================================
   MADEMOISELLE BOBÙN — commande à emporter (panier + Stripe)
   Module partagé par les deux pages. Les prix affichés ici sont
   indicatifs : le serveur (server.js) fait foi au paiement.
   ============================================================ */

(async () => {
  'use strict';

  /* prix à jour depuis le menu Supabase (repli sur les prix par défaut) */
  async function syncPrices(items, sups) {
    try {
      const r = await fetch('/api/menu/public', { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return;
      const map = {};
      (await r.json()).items.forEach(m => { map[m.id] = m; });
      items.forEach(i => { if (map[i.id]) i.price = map[i.id].amount; });
      sups.forEach(s => { if (map[s.id]) { s.price = map[s.id].amount; if (map[s.id].name) s.name = map[s.id].name; } });
    } catch (e) { /* prix par défaut conservés */ }
  }

  /* la page peut définir son propre catalogue via window.ORDER_ITEMS */
  const ITEMS = window.ORDER_ITEMS || [
    { id: 'boeuf', price: 1390 },
    { id: 'poulet', price: 1290 },
    { id: 'crevette', price: 1390 },
    { id: 'veggie', price: 1190 }
  ];
  const SUPS = [
    { id: 'sup_nems', name: 'Supplément 2 nems', price: 300 },
    { id: 'sup_poulet', name: 'Supplément poulet', price: 300 },
    { id: 'sup_boeuf', name: 'Supplément bœuf', price: 400 },
    { id: 'sup_tofu', name: 'Supplément tofu mariné', price: 300 },
    { id: 'sup_oeuf', name: 'Supplément œuf au plat', price: 100 }
  ];
  const MAX_QTY = 20;

  const eur = c => (c / 100).toFixed(2).replace('.', ',') + ' €';

  const grid = document.querySelector('.choix-grid');
  const platformRow = document.querySelector('.platform-row');
  if (!grid || !platformRow) return;

  const PAGE = location.pathname.includes('/bobunbeef') ? '/bobunbeef/'
    : location.pathname.includes('/loclac') ? '/loclac/'
    : location.pathname.includes('/padthai') ? '/padthai/'
    : location.pathname.includes('/film') ? '/film'
    : '/';

  // synchronise les prix affichés avec le menu géré dans le dashboard
  await syncPrices(ITEMS, SUPS);

  /* --- steppers dans chaque carte --- */
  ITEMS.forEach(item => {
    const card = grid.querySelector(`.choix-card[data-id="${item.id}"]`);
    if (!card) return;
    const row = document.createElement('div');
    row.className = 'order-row';
    row.innerHTML = `
      <span class="choix-price">${eur(item.price)}</span>
      <div class="qty" data-id="${item.id}">
        <button type="button" class="qty-btn" data-d="-1" aria-label="Retirer un bol">−</button>
        <span class="qty-n" aria-live="polite">0</span>
        <button type="button" class="qty-btn" data-d="1" aria-label="Ajouter un bol">+</button>
      </div>`;
    card.appendChild(row);
  });

  /* --- panier : un bol = une ligne, avec ses propres suppléments --- */
  const box = document.createElement('div');
  box.id = 'commander';
  box.className = 'order-box';
  box.hidden = true;
  box.innerHTML = `
    <p class="eyebrow">PAIEMENT EN LIGNE</p>
    <div class="order-mode" role="group" aria-label="Mode de retrait">
      <button type="button" class="mode-opt on" data-mode="emporter">🥡 À emporter</button>
      <button type="button" class="mode-opt" data-mode="drive">🚗 Drive</button>
    </div>
    <p class="order-pickup-note" id="order-mode-note">🥡 <strong>À emporter</strong>&nbsp;: vous venez la récupérer au
      <strong>200 bis rue Malbec, Bordeaux</strong>. Votre code de retrait arrive sur WhatsApp.</p>
    <p class="order-sups-hint">Ajoutez un plat, puis choisissez ses suppléments&nbsp;: chaque plat a les siens.</p>
    <div class="order-lines" aria-live="polite"></div>
    <label class="order-note-label" for="order-wa">VOTRE NUMÉRO WHATSAPP · POUR RECEVOIR LE CODE DE RETRAIT ET SON QR CODE</label>
    <input id="order-wa" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="06 12 34 56 78" required>
    <label class="order-note-label" for="order-note">UNE NOTE POUR LA CUISINE&nbsp;? (ALLERGIES, HEURE DE RETRAIT…)</label>
    <textarea id="order-note" maxlength="400" rows="2" placeholder="Ex. : sans cacahuètes, retrait vers 20h…"></textarea>
    <button type="button" id="order-pay" class="btn-brand btn-stripe">Payer — <span class="order-total"></span></button>
    <p class="order-hint">PAIEMENT SÉCURISÉ STRIPE · RETRAIT SUR PLACE UNIQUEMENT</p>
    <p class="order-error" role="alert" hidden></p>`;
  platformRow.parentNode.insertBefore(box, platformRow);

  const linesEl = box.querySelector('.order-lines');
  const totalEl = box.querySelector('.order-total');
  const errorEl = box.querySelector('.order-error');
  const payBtn = box.querySelector('#order-pay');
  const waInput = box.querySelector('#order-wa');

  const dishById = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  const supById = Object.fromEntries(SUPS.map(s => [s.id, s]));
  let lines = [];   // { uid, dishId, sups: { supId: true } }
  let uidSeq = 1;
  let mode = new URLSearchParams(location.search).get('mode') === 'drive' ? 'drive' : 'emporter';

  const modeNote = box.querySelector('#order-mode-note');
  const NOTE = {
    emporter: '🥡 <strong>À emporter</strong>&nbsp;: vous venez la récupérer au <strong>200 bis rue Malbec, Bordeaux</strong>. Votre code de retrait arrive sur WhatsApp.',
    drive: '🚗 <strong>Drive</strong>&nbsp;: restez en voiture, on vous apporte la commande ! Après paiement, WhatsApp vous demandera la description de votre véhicule.'
  };
  function applyMode(m) {
    mode = m;
    box.querySelectorAll('.mode-opt').forEach(o => o.classList.toggle('on', o.dataset.mode === m));
    modeNote.innerHTML = NOTE[m];
    payBtn.firstChild.textContent = (m === 'drive' ? 'Payer (Drive) — ' : 'Payer — ');
  }
  box.querySelector('.order-mode').addEventListener('click', e => {
    const b = e.target.closest('.mode-opt');
    if (b) applyMode(b.dataset.mode);
  });
  if (mode === 'drive') applyMode('drive');

  function bowlName(id) {
    const card = grid.querySelector(`.choix-card[data-id="${id}"] h3`);
    return card ? card.textContent.trim() : id;
  }
  function dishCount(id) { return lines.filter(l => l.dishId === id).length; }
  function lineSubtotal(l) {
    return dishById[l.dishId].price + Object.keys(l.sups)
      .reduce((s, sid) => s + (supById[sid] ? supById[sid].price : 0), 0);
  }
  function supShort(name) { return name.replace(/^Supplément\s+/i, ''); }

  function render() {
    // compteurs sur les cartes de plats
    ITEMS.forEach(it => {
      const n = dishCount(it.id);
      const el = grid.querySelector(`.qty[data-id="${it.id}"] .qty-n`);
      if (el) el.textContent = n;
      const card = grid.querySelector(`.choix-card[data-id="${it.id}"]`);
      if (card) card.classList.toggle('in-cart', n > 0);
    });
    // lignes du panier
    linesEl.innerHTML = lines.map(l => {
      const chips = SUPS.map(s =>
        `<button type="button" class="sup-chip ${l.sups[s.id] ? 'on' : ''}" data-uid="${l.uid}" data-sup="${s.id}">
          ${supShort(s.name)} <em>+${eur(s.price)}</em></button>`).join('');
      return `<div class="cart-line" data-uid="${l.uid}">
        <div class="cart-line-head">
          <span class="cart-line-name">${bowlName(l.dishId)}</span>
          <span class="cart-line-price">${eur(lineSubtotal(l))}</span>
          <button type="button" class="cart-line-del" data-uid="${l.uid}" aria-label="Retirer ce bol">✕</button>
        </div>
        <div class="cart-line-sups"><span class="cart-sup-label">SUPPLÉMENTS</span>${chips}</div>
      </div>`;
    }).join('');
    totalEl.textContent = eur(lines.reduce((s, l) => s + lineSubtotal(l), 0));
    box.hidden = lines.length === 0;
  }

  function showError(msg) { errorEl.textContent = msg; errorEl.hidden = false; }

  // +/- sur une carte de plat : ajoute / retire une ligne de ce bol
  grid.addEventListener('click', e => {
    const btn = e.target.closest('.qty-btn');
    if (!btn) return;
    const id = btn.closest('.qty').dataset.id;
    if (+btn.dataset.d > 0) {
      if (lines.length < MAX_QTY) lines.push({ uid: uidSeq++, dishId: id, sups: {} });
    } else {
      for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].dishId === id) { lines.splice(i, 1); break; } }
    }
    errorEl.hidden = true;
    render();
  });

  // dans le panier : (dé)sélectionner un supplément d'une ligne, ou retirer la ligne
  box.addEventListener('click', e => {
    const chip = e.target.closest('.sup-chip');
    if (chip) {
      const l = lines.find(x => String(x.uid) === chip.dataset.uid);
      if (l) { const sid = chip.dataset.sup; if (l.sups[sid]) delete l.sups[sid]; else l.sups[sid] = true; render(); }
      return;
    }
    const del = e.target.closest('.cart-line-del');
    if (del) { lines = lines.filter(x => String(x.uid) !== del.dataset.uid); render(); }
  });

  payBtn.addEventListener('click', async () => {
    if (!lines.length) return;
    const waDigits = waInput.value.replace(/\D/g, '');
    if (waDigits.length < 10) {
      showError('Indiquez votre numéro WhatsApp — c\'est là que vous recevrez votre code de retrait.');
      waInput.focus();
      return;
    }
    payBtn.disabled = true;
    payBtn.classList.add('is-loading');
    errorEl.hidden = true;
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: lines.map(l => ({ dish: l.dishId, sups: Object.keys(l.sups) })),
          note: document.getElementById('order-note').value,
          wa: waInput.value,
          page: PAGE,
          mode
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'indisponible');
      window.location.href = data.url;
    } catch (e) {
      showError(e.message !== 'indisponible' && e.message
        ? e.message
        : 'Le paiement en ligne est indisponible pour le moment — commandez via Uber Eats ou Deliveroo ci-dessous.');
      payBtn.disabled = false;
      payBtn.classList.remove('is-loading');
    }
  });

  render();
})();
