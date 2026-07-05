/* ============================================================
   MADEMOISELLE BOBÙN — serveur de commande à emporter
   - Sert le site statique
   - POST /api/checkout          : crée la session Stripe Checkout
   - POST /api/stripe/webhook    : paiement confirmé → enregistre la
     commande, WhatsApp client (code + QR) et équipe (via Whapi)
   - GET  /api/orders (+ /stream): dashboard temps réel (clé requise)
   Variables d'environnement :
     STRIPE_SECRET_KEY      clé secrète Stripe (obligatoire)
     STRIPE_WEBHOOK_SECRET  whsec_… (signature du webhook)
     WHAPI_TOKEN            jeton Whapi (whapi.cloud) — sinon envois ignorés
     WHAPI_API_URL          défaut https://gate.whapi.cloud
     TEAM_WHATSAPP          numéro WhatsApp équipe, chiffres seuls (33612345678)
     DASHBOARD_KEY          clé d'accès au dashboard
     DATA_DIR               répertoire de persistance (volume Railway : /data)
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Stripe = require('stripe');
const QRCode = require('qrcode');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || '';
const WHAPI_API_URL = (process.env.WHAPI_API_URL || 'https://gate.whapi.cloud').replace(/\/$/, '');
const TEAM_WHATSAPP = (process.env.TEAM_WHATSAPP || '').replace(/\D/g, '');
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
// jeton dérivé pour sécuriser le webhook Whapi entrant
const WHAPI_HOOK_T = WHAPI_TOKEN ? crypto.createHash('sha256').update(WHAPI_TOKEN).digest('hex').slice(0, 24) : '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.jsonl');

// Catalogue côté serveur : les prix font foi ici, pas côté client.
const CATALOG = {
  boeuf: {
    name: 'Bo Bún Bœuf',
    amount: 1390,
    description: 'Vermicelles au bœuf citronnelle avec nems au poulet, cacahuètes, oignons frits et crudités.'
  },
  poulet: {
    name: 'Bo Bún Poulet',
    amount: 1290,
    description: 'Poulet mariné à la citronnelle, nems au poulet, cacahuètes, oignons frits et crudités.'
  },
  veggie: {
    name: 'Bo Bún Veggie',
    amount: 1190,
    description: 'Nems végétariens, tofu doré à la citronnelle, cacahuètes, oignons frits et crudités.'
  },
  crevette: {
    name: 'Bo Bún Crevette',
    amount: 1390,
    description: 'Tôm bun avec vermicelles, crevettes décortiquées et nems, cacahuètes et oignons frits et crudités.'
  },
  /* loc lac */
  loclac_boeuf: {
    name: 'Loc Lac Bœuf',
    amount: 1490,
    description: 'Dés de bœuf marinés sautés au wok, riz rouge maison ou riz jasmin, crudités et pickles de carottes.'
  },
  loclac_poulet: {
    name: 'Loc Lac Poulet',
    amount: 1390,
    description: 'Émincés de poulet marinés sautés au wok, riz rouge maison ou riz jasmin, crudités et pickles de carottes.'
  },
  loclac_veggie: {
    name: 'Loc Lac Veggie',
    amount: 1290,
    description: 'Tofu doré sauté au wok, riz rouge maison ou riz jasmin, crudités et pickles de carottes.'
  },
  /* suppléments */
  sup_nems: { name: 'Supplément 2 nems', amount: 300, sup: true },
  sup_poulet: { name: 'Supplément poulet', amount: 300, sup: true },
  sup_boeuf: { name: 'Supplément bœuf', amount: 400, sup: true },
  sup_tofu: { name: 'Supplément tofu mariné', amount: 300, sup: true },
  sup_oeuf: { name: 'Supplément œuf au plat', amount: 100, sup: true }
};

const CANCEL_PATHS = ['/', '/film', '/bobunbeef/', '/loclac/'];

/* ---------- Persistance (JSONL sur volume) ---------- */

let orders = [];
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(ORDERS_FILE)) {
    const lines = fs.readFileSync(ORDERS_FILE, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
    for (const l of lines) {
      if (l._evt === 'drive') {
        const o = orders.find(x => x.sessionId === l.sessionId);
        if (o) o.drive = { vehicle: l.vehicle, at: l.date };
      } else {
        orders.push(l);
      }
    }
  }
} catch (e) {
  console.error('storage init:', e.message);
}

function appendLine(obj) {
  try {
    fs.appendFileSync(ORDERS_FILE, JSON.stringify(obj) + '\n');
  } catch (e) {
    console.error('storage write:', e.message);
  }
}

function saveOrder(order) {
  orders.push(order);
  appendLine(order);
  broadcast('order', order);
}

/* ---------- SSE (dashboard temps réel) ---------- */

const sseClients = new Set();

function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(payload); } catch (e) { /* ignore */ } });
}

/* ---------- Code de retrait ---------- */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I/L
function pickupCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return 'BB-' + s;
}

/* ---------- Whapi (WhatsApp) ---------- */

async function whapi(endpoint, body) {
  if (!WHAPI_TOKEN) { console.log('whapi: jeton absent, envoi ignoré →', endpoint); return null; }
  const res = await fetch(`${WHAPI_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHAPI_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`whapi ${endpoint} ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function frPhoneToWa(phone) {
  // "+33 6 12 34 56 78" → "33612345678"
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length === 10) return '33' + digits.slice(1);
  return digits;
}

const MAPS_URL = 'https://www.google.com/maps/dir/?api=1&destination=200+bis+rue+Malbec+33000+Bordeaux&travelmode=driving';

async function sendCustomerWhatsApp(order) {
  const to = frPhoneToWa(order.phone);
  if (!to) { console.log('whatsapp client: pas de téléphone'); return; }
  const lines = order.items.map(i => `  • ${i.qty} × ${i.name}`).join('\n');
  const caption =
    `🍜 *Mademoiselle Bobùn* — commande confirmée !\n\n` +
    `Code de retrait : *${order.code}*\n${lines}\n` +
    `Total payé : *${(order.amount / 100).toFixed(2).replace('.', ',')} €*\n\n` +
    `Présentez ce QR code (ou votre code) au retrait :\n` +
    `📍 200 bis rue Malbec, 33000 Bordeaux\n\nÀ tout de suite !`;
  const qr = await QRCode.toDataURL(order.code, { width: 480, margin: 2 });
  try {
    await whapi('/messages/image', { to, media: qr, caption });
  } catch (e) {
    console.error(e.message);
    await whapi('/messages/text', { to, body: caption }).catch(err => console.error(err.message));
  }
  await sendDriveProposal(order, to);
}

/* proposition Drive : bouton interactif WhatsApp, repli texte */
async function sendDriveProposal(order, to) {
  const body =
    `🚗 *Option Drive* — on dépose votre commande à votre voiture !\n\n` +
    `Garez-vous à proximité du 200 bis rue Malbec, puis touchez le bouton ` +
    `ci-dessous (ou répondez « GARÉ » suivi de votre véhicule).\n\n` +
    `🧭 Itinéraire : ${MAPS_URL}`;
  try {
    await whapi('/messages/interactive', {
      to,
      type: 'button',
      body: { text: body },
      action: {
        buttons: [{ type: 'quick_reply', title: '🚗 Je suis garé devant', id: `drive_${order.sessionId}` }]
      }
    });
  } catch (e) {
    console.error('drive interactif:', e.message);
    await whapi('/messages/text', { to, body }).catch(err => console.error(err.message));
  }
}

async function sendTeamWhatsApp(order) {
  if (!TEAM_WHATSAPP) { console.log('whatsapp équipe: TEAM_WHATSAPP non défini'); return; }
  const lines = order.items.map(i => `  • ${i.qty} × ${i.name}`).join('\n');
  const body =
    `🔥 *NOUVELLE COMMANDE PAYÉE* — ${order.code}\n\n${lines}\n` +
    `Total : *${(order.amount / 100).toFixed(2).replace('.', ',')} €*\n` +
    `Note : ${order.note || '—'}\n` +
    `Client : ${order.phone || '—'}${order.email ? ' · ' + order.email : ''}`;
  await whapi('/messages/text', { to: TEAM_WHATSAPP, body }).catch(e => console.error(e.message));
}

/* ---------- App ---------- */

const app = express();
app.set('trust proxy', 1);

/* Webhook Stripe : corps brut AVANT express.json pour la signature */
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).end();
  let event;
  try {
    if (WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString()); // dev local uniquement
      console.warn('webhook: signature NON vérifiée (STRIPE_WEBHOOK_SECRET absent)');
    }
  } catch (e) {
    return res.status(400).send(`signature invalide: ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    try {
      const s = event.data.object;
      if (orders.some(o => o.sessionId === s.id)) return res.json({ received: true }); // idempotence
      const li = await stripe.checkout.sessions.listLineItems(s.id, { limit: 20 });
      const order = {
        id: s.id.slice(-10),
        sessionId: s.id,
        code: (s.metadata && s.metadata.code) || pickupCode(),
        date: new Date((s.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        items: li.data.map(l => ({ name: l.description, qty: l.quantity, amount: l.amount_total })),
        amount: s.amount_total,
        note: (s.metadata && s.metadata.note !== '—' && s.metadata.note) || '',
        phone: (s.metadata && s.metadata.wa) || (s.customer_details && s.customer_details.phone) || '',
        email: (s.customer_details && s.customer_details.email) || '',
        status: 'payée'
      };
      saveOrder(order);
      // WhatsApp en arrière-plan — la réponse au webhook ne doit pas attendre
      sendCustomerWhatsApp(order).catch(e => console.error('wa client:', e.message));
      sendTeamWhatsApp(order).catch(e => console.error('wa équipe:', e.message));
    } catch (e) {
      console.error('webhook:', e.message);
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '10kb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    stripe: !!stripe,
    webhook: !!WEBHOOK_SECRET,
    whapi: !!WHAPI_TOKEN,
    team: !!TEAM_WHATSAPP,
    orders: orders.length
  });
});

/* ---------- Checkout ---------- */

app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Paiement non configuré.' });
  try {
    const { items, note, page, wa } = req.body || {};

    const valid = (Array.isArray(items) ? items : [])
      .filter(i => i && CATALOG[i.id] && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 20);

    if (!valid.some(i => !CATALOG[i.id].sup)) {
      return res.status(400).json({ error: 'Ajoutez au moins un bol.' });
    }

    const waDigits = frPhoneToWa(wa);
    if (waDigits.length < 10 || waDigits.length > 15) {
      return res.status(400).json({ error: 'Numéro WhatsApp requis pour le code de retrait.' });
    }

    const line_items = valid.map(i => ({
      quantity: i.qty,
      price_data: {
        currency: 'eur',
        unit_amount: CATALOG[i.id].amount,
        product_data: Object.assign(
          { name: CATALOG[i.id].name },
          CATALOG[i.id].description ? { description: CATALOG[i.id].description } : {}
        )
      }
    }));

    const cleanNote = String(note || '').slice(0, 400).trim();
    const code = pickupCode();
    const origin = `${req.protocol}://${req.get('host')}`;
    const cancelPath = CANCEL_PATHS.includes(page) ? page : '/';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'fr',
      submit_type: 'pay',
      line_items,
      metadata: { source: 'site — à emporter', note: cleanNote || '—', code, wa: waDigits },
      payment_intent_data: {
        description: `Commande à emporter ${code} — Mademoiselle Bobùn`
          + (cleanNote ? ` · Note : ${cleanNote.slice(0, 180)}` : '')
      },
      success_url: `${origin}/merci.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${cancelPath}#commander`
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error('checkout error:', e.message);
    res.status(500).json({ error: 'Paiement indisponible pour le moment.' });
  }
});

/* Code de retrait affiché sur merci.html */
app.get('/api/session/:id', async (req, res) => {
  if (!stripe || !/^cs_(live|test)_/.test(req.params.id)) return res.status(400).json({});
  try {
    const s = await stripe.checkout.sessions.retrieve(req.params.id);
    if (s.payment_status !== 'paid') return res.json({});
    res.json({ code: (s.metadata && s.metadata.code) || '', amount: s.amount_total });
  } catch (e) {
    res.status(404).json({});
  }
});

/* ---------- Option Drive : le client est garé devant ---------- */

function markDrive(order, vehicle) {
  const cleanVehicle = String(vehicle || '').slice(0, 120).trim() || 'véhicule non décrit';
  const evt = { _evt: 'drive', sessionId: order.sessionId, vehicle: cleanVehicle, date: new Date().toISOString() };
  const stored = orders.find(o => o.sessionId === order.sessionId);
  if (stored) stored.drive = { vehicle: cleanVehicle, at: evt.date };
  appendLine(evt);
  broadcast('drive', { code: order.code, vehicle: cleanVehicle, sessionId: order.sessionId, at: evt.date });
}

app.post('/api/drive', async (req, res) => {
  try {
    const { session_id, vehicle } = req.body || {};
    if (!/^cs_(live|test)_/.test(String(session_id || ''))) return res.status(400).json({ error: 'session invalide' });
    let order = orders.find(o => o.sessionId === session_id);
    if (!order && stripe) {
      // le webhook peut ne pas être encore arrivé : on vérifie chez Stripe
      try {
        const s = await stripe.checkout.sessions.retrieve(session_id);
        if (s.payment_status !== 'paid') return res.status(400).json({ error: 'commande introuvable' });
        order = { code: (s.metadata && s.metadata.code) || '—', sessionId: session_id };
      } catch (e) {
        return res.status(404).json({ error: 'commande introuvable' });
      }
    }
    if (!order) return res.status(404).json({ error: 'commande introuvable' });
    markDrive(order, vehicle);
    res.json({ ok: true });
  } catch (e) {
    console.error('drive:', e.message);
    res.status(500).json({ error: 'erreur' });
  }
});

/* ---------- Webhook Whapi entrant : bouton « Je suis garé » + véhicule ---------- */

const pendingVehicle = new Map(); // téléphone -> { sessionId, until }

function findRecentOrderByPhone(digits) {
  const cutoff = Date.now() - 3 * 3600 * 1000;
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i];
    if (frPhoneToWa(o.phone) === digits && new Date(o.date).getTime() > cutoff) return o;
  }
  return null;
}

app.post('/api/whapi/webhook', async (req, res) => {
  res.json({ ok: true }); // répondre vite, traiter ensuite
  try {
    if (!WHAPI_HOOK_T || req.query.t !== WHAPI_HOOK_T) return;
    const messages = (req.body && req.body.messages) || [];
    for (const m of messages) {
      if (!m || m.from_me) continue;
      const from = String(m.from || m.chat_id || '').replace(/\D/g, '');
      if (!from) continue;

      // 1) bouton « Je suis garé devant »
      const btnId = (m.reply && m.reply.buttons_reply && m.reply.buttons_reply.id)
        || (m.interactive && m.interactive.button_reply && m.interactive.button_reply.id) || '';
      if (btnId.startsWith('drive_')) {
        const sid = btnId.slice(6).replace(/^ButtonsV3:/, '');
        const order = orders.find(o => o.sessionId === sid) || findRecentOrderByPhone(from);
        if (order) {
          markDrive(order, '');
          pendingVehicle.set(from, { sessionId: order.sessionId, until: Date.now() + 30 * 60 * 1000 });
          await whapi('/messages/text', {
            to: from,
            body: '🚗 Bien reçu ! Décrivez votre véhicule en réponse (couleur, modèle ou plaque) pour qu\'on vous trouve.'
          }).catch(e => console.error(e.message));
        }
        continue;
      }

      const text = (m.text && m.text.body ? String(m.text.body) : '').trim();
      if (!text) continue;

      // 2) description du véhicule attendue après le bouton
      const pending = pendingVehicle.get(from);
      if (pending && pending.until > Date.now()) {
        pendingVehicle.delete(from);
        const order = orders.find(o => o.sessionId === pending.sessionId);
        if (order) {
          markDrive(order, text);
          await whapi('/messages/text', { to: from, body: '✅ C\'est noté — on vous apporte votre commande !' })
            .catch(e => console.error(e.message));
        }
        continue;
      }

      // 3) « GARÉ Clio grise AB-123-CD » en texte libre
      const g = text.match(/^\s*gar[ée]?e?\b[\s:،-]*(.*)$/i);
      if (g) {
        const order = findRecentOrderByPhone(from);
        if (order) {
          markDrive(order, g[1] || '');
          await whapi('/messages/text', { to: from, body: '✅ C\'est noté — on vous apporte votre commande !' })
            .catch(e => console.error(e.message));
        } else {
          await whapi('/messages/text', { to: from, body: 'Nous ne retrouvons pas de commande récente pour ce numéro — appelez le 05 57 95 54 39.' })
            .catch(e => console.error(e.message));
        }
      }
    }
  } catch (e) {
    console.error('whapi webhook:', e.message);
  }
});

/* ---------- Dashboard API (clé requise) ---------- */

function checkKey(req, res, next) {
  const key = req.headers['x-dash-key'] || req.query.key;
  if (!DASHBOARD_KEY || key !== DASHBOARD_KEY) return res.status(401).json({ error: 'clé invalide' });
  next();
}

app.get('/api/orders', checkKey, (req, res) => {
  res.json({ orders: orders.slice(-500).reverse() });
});

/* catalogue pour la prise de commande sur place */
app.get('/api/catalog', checkKey, (req, res) => {
  res.json({
    items: Object.entries(CATALOG).map(([id, c]) => ({
      id, name: c.name, amount: c.amount, sup: !!c.sup
    }))
  });
});

/* commande prise SUR PLACE depuis le dashboard (encaissement au comptoir) */
app.post('/api/orders/manual', checkKey, (req, res) => {
  try {
    const { items, note } = req.body || {};
    const valid = (Array.isArray(items) ? items : [])
      .filter(i => i && CATALOG[i.id] && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 30);
    if (!valid.length) return res.status(400).json({ error: 'Aucun article.' });
    const now = new Date();
    const order = {
      id: 'sp' + now.getTime().toString(36),
      sessionId: 'surplace_' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
      code: pickupCode(),
      date: now.toISOString(),
      items: valid.map(i => ({
        name: CATALOG[i.id].name, qty: i.qty, amount: CATALOG[i.id].amount * i.qty
      })),
      amount: valid.reduce((s, i) => s + CATALOG[i.id].amount * i.qty, 0),
      note: String(note || '').slice(0, 400).trim(),
      phone: '', email: '',
      status: 'sur place'
    };
    saveOrder(order);
    res.json({ ok: true, code: order.code });
  } catch (e) {
    console.error('manual:', e.message);
    res.status(500).json({ error: 'erreur' });
  }
});

app.get('/api/orders/stream', checkKey, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('retry: 5000\n\n');
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* ignore */ } }, 25000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});

/* ---------- Pages ---------- */

// LE COMPTOIR (un plat = un écran) est la page d'accueil
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'comptoir', 'index.html')));
// l'ancien film « la descente du bol » reste accessible sur /film
app.get('/film', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/film/', (req, res) => res.redirect(301, '/film'));

/* ---------- Site statique ---------- */

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

/* enregistre le webhook entrant chez Whapi (idempotent, au démarrage) */
async function configureWhapiWebhook() {
  if (!WHAPI_TOKEN || !PUBLIC_URL) {
    if (WHAPI_TOKEN) console.log('whapi webhook: PUBLIC_URL absent, configuration ignorée');
    return;
  }
  try {
    const res = await fetch(`${WHAPI_API_URL}/settings`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${WHAPI_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhooks: [{
          url: `${PUBLIC_URL}/api/whapi/webhook?t=${WHAPI_HOOK_T}`,
          events: [{ type: 'messages', method: 'post' }],
          mode: 'body'
        }]
      })
    });
    console.log('whapi webhook:', res.ok ? 'configuré → ' + PUBLIC_URL : 'échec ' + res.status);
  } catch (e) {
    console.error('whapi webhook:', e.message);
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Mademoiselle Bobùn en ligne sur :${port} · commandes chargées : ${orders.length}`);
  configureWhapiWebhook();
});
