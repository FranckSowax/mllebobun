/* ============================================================
   MADEMOISELLE BOBÙN — commande à emporter (panier + Stripe)
   Module partagé par les deux pages. Les prix affichés ici sont
   indicatifs : le serveur (server.js) fait foi au paiement.
   ============================================================ */

(() => {
  'use strict';

  const ITEMS = [
    { id: 'boeuf', price: 1390 },
    { id: 'poulet', price: 1290 },
    { id: 'veggie', price: 1190 }
  ];
  const MAX_QTY = 20;

  const eur = c => (c / 100).toFixed(2).replace('.', ',') + ' €';
  const state = { boeuf: 0, poulet: 0, veggie: 0 };

  const grid = document.querySelector('.choix-grid');
  const platformRow = document.querySelector('.platform-row');
  if (!grid || !platformRow) return;

  const PAGE = location.pathname.includes('/bobunbeef') ? '/bobunbeef/' : '/';

  /* --- steppers dans chaque carte --- */
  ITEMS.forEach(item => {
    const card = grid.querySelector(`.choix-card[data-id="${item.id}"]`);
    if (!card) return;
    const row = document.createElement('div');
    row.className = 'order-row';
    row.innerHTML = `
      <span class="choix-price">${eur(item.price)}</span>
      <div class="qty" data-id="${item.id}">
        <button type="button" class="qty-btn" data-d="-1" aria-label="Retirer un ${item.id}">−</button>
        <span class="qty-n" aria-live="polite">0</span>
        <button type="button" class="qty-btn" data-d="1" aria-label="Ajouter un ${item.id}">+</button>
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
    <div class="order-lines" aria-live="polite"></div>
    <label class="order-note-label" for="order-note">UNE NOTE POUR LA CUISINE&nbsp;? (ALLERGIES, HEURE DE RETRAIT…)</label>
    <textarea id="order-note" maxlength="400" rows="2" placeholder="Ex. : sans cacahuètes, retrait vers 20h…"></textarea>
    <button type="button" id="order-pay" class="btn-brand btn-stripe">Payer — <span class="order-total"></span></button>
    <p class="order-hint">PAIEMENT SÉCURISÉ STRIPE · RETRAIT 200 BIS RUE MALBEC, BORDEAUX</p>
    <p class="order-error" role="alert" hidden></p>`;
  platformRow.parentNode.insertBefore(box, platformRow);

  const linesEl = box.querySelector('.order-lines');
  const totalEl = box.querySelector('.order-total');
  const errorEl = box.querySelector('.order-error');
  const payBtn = box.querySelector('#order-pay');

  function names(id) {
    const card = grid.querySelector(`.choix-card[data-id="${id}"] h3`);
    return card ? card.textContent : id;
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
        lines.push(`<div class="order-line"><span>${q} × ${names(it.id)}</span><span>${eur(q * it.price)}</span></div>`);
      }
    });
    box.hidden = total === 0;
    linesEl.innerHTML = lines.join('');
    totalEl.textContent = eur(total);
  }

  grid.addEventListener('click', e => {
    const btn = e.target.closest('.qty-btn');
    if (!btn) return;
    const id = btn.closest('.qty').dataset.id;
    state[id] = Math.max(0, Math.min(MAX_QTY, state[id] + (+btn.dataset.d)));
    errorEl.hidden = true;
    render();
  });

  payBtn.addEventListener('click', async () => {
    const items = ITEMS.filter(it => state[it.id] > 0)
      .map(it => ({ id: it.id, qty: state[it.id] }));
    if (!items.length) return;
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
          page: PAGE
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'indisponible');
      window.location.href = data.url;
    } catch (e) {
      errorEl.textContent = 'Le paiement en ligne est indisponible pour le moment — commandez via WhatsApp, Uber Eats ou Deliveroo ci-dessous.';
      errorEl.hidden = false;
      payBtn.disabled = false;
      payBtn.classList.remove('is-loading');
    }
  });

  render();
})();
