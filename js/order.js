/* ============================================================
   MADEMOISELLE BOBÙN — commande à emporter (panier + Stripe)
   Module partagé par les deux pages. Les prix affichés ici sont
   indicatifs : le serveur (server.js) fait foi au paiement.
   ============================================================ */

(() => {
  'use strict';

  /* la page peut définir son propre catalogue via window.ORDER_ITEMS */
  const ITEMS = window.ORDER_ITEMS || [
    { id: 'boeuf', price: 1390 },
    { id: 'poulet', price: 1290 },
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
  const state = {};
  ITEMS.concat(SUPS).forEach(i => { state[i.id] = 0; });

  const grid = document.querySelector('.choix-grid');
  const platformRow = document.querySelector('.platform-row');
  if (!grid || !platformRow) return;

  const PAGE = location.pathname.includes('/bobunbeef') ? '/bobunbeef/'
    : location.pathname.includes('/loclac') ? '/loclac/'
    : '/';

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

  /* --- panier --- */
  const box = document.createElement('div');
  box.id = 'commander';
  box.className = 'order-box';
  box.hidden = true;
  box.innerHTML = `
    <p class="eyebrow">À EMPORTER · PAIEMENT EN LIGNE</p>
    <p class="order-pickup-note">🥡 Commande <strong>à emporter</strong>&nbsp;: vous venez la récupérer au
      <strong>200 bis rue Malbec, Bordeaux</strong>. Votre code de retrait arrive sur WhatsApp.</p>
    <div class="order-lines" aria-live="polite"></div>
    <p class="order-sups-label">SUPPLÉMENTS</p>
    <div class="order-sups">
      ${SUPS.map(s => `
        <div class="order-sup">
          <span class="sup-name">${s.name} <em>+${eur(s.price)}</em></span>
          <div class="qty qty-s" data-id="${s.id}">
            <button type="button" class="qty-btn" data-d="-1" aria-label="Retirer ${s.name}">−</button>
            <span class="qty-n">0</span>
            <button type="button" class="qty-btn" data-d="1" aria-label="Ajouter ${s.name}">+</button>
          </div>
        </div>`).join('')}
    </div>
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

  function bowlName(id) {
    const card = grid.querySelector(`.choix-card[data-id="${id}"] h3`);
    return card ? card.textContent : id;
  }

  function bowlsCount() {
    return ITEMS.reduce((s, it) => s + state[it.id], 0);
  }

  function render() {
    let total = 0;
    const lines = [];
    ITEMS.forEach(it => {
      const q = state[it.id];
      const el = grid.querySelector(`.qty[data-id="${it.id}"] .qty-n`);
      if (el) el.textContent = q;
      const card = grid.querySelector(`.choix-card[data-id="${it.id}"]`);
      if (card) card.classList.toggle('in-cart', q > 0);
      if (q > 0) {
        total += q * it.price;
        lines.push(`<div class="order-line"><span>${q} × ${bowlName(it.id)}</span><span>${eur(q * it.price)}</span></div>`);
      }
    });
    SUPS.forEach(su => {
      const q = state[su.id];
      const el = box.querySelector(`.qty[data-id="${su.id}"] .qty-n`);
      if (el) el.textContent = q;
      if (q > 0) {
        total += q * su.price;
        lines.push(`<div class="order-line order-line-sup"><span>${q} × ${su.name}</span><span>${eur(q * su.price)}</span></div>`);
      }
    });
    box.hidden = bowlsCount() === 0;
    linesEl.innerHTML = lines.join('');
    totalEl.textContent = eur(total);
  }

  function onQtyClick(e) {
    const btn = e.target.closest('.qty-btn');
    if (!btn) return;
    const id = btn.closest('.qty').dataset.id;
    state[id] = Math.max(0, Math.min(MAX_QTY, state[id] + (+btn.dataset.d)));
    errorEl.hidden = true;
    render();
  }

  grid.addEventListener('click', onQtyClick);
  box.addEventListener('click', onQtyClick);

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  payBtn.addEventListener('click', async () => {
    const items = ITEMS.concat(SUPS).filter(it => state[it.id] > 0)
      .map(it => ({ id: it.id, qty: state[it.id] }));
    if (!bowlsCount()) return;

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
          items,
          note: document.getElementById('order-note').value,
          wa: waInput.value,
          page: PAGE
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
