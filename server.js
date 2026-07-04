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
const express = require('express');
const Stripe = require('stripe');
const QRCode = require('qrcode');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || '';
const WHAPI_API_URL = (process.env.WHAPI_API_URL || 'https://gate.whapi.cloud').replace(/\/$/, '');
const TEAM_WHATSAPP = (process.env.TEAM_WHATSAPP || '').replace(/\D/g, '');
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || '';
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
  /* suppléments */
  sup_nems: { name: 'Supplément 2 nems', amount: 300, sup: true },
  sup_poulet: { name: 'Supplément poulet', amount: 300, sup: true },
  sup_boeuf: { name: 'Supplément bœuf', amount: 400, sup: true },
  sup_tofu: { name: 'Supplément tofu mariné', amount: 300, sup: true },
  sup_oeuf: { name: 'Supplément œuf au plat', amount: 100, sup: true }
};

const CANCEL_PATHS = ['/', '/bobunbeef/'];

/* ---------- Persistance (JSONL sur volume) ---------- */

let orders = [];
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(ORDERS_FILE)) {
    orders = fs.readFileSync(ORDERS_FILE, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  }
} catch (e) {
  console.error('storage init:', e.message);
}

function saveOrder(order) {
  orders.push(order);
  try {
    fs.appendFileSync(ORDERS_FILE, JSON.stringify(order) + '\n');
  } catch (e) {
    console.error('storage write:', e.message);
  }
  broadcast(order);
}

/* ---------- SSE (dashboard temps réel) ---------- */

const sseClients = new Set();

function broadcast(order) {
  const payload = `event: order\ndata: ${JSON.stringify(order)}\n\n`;
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

/* ---------- Dashboard API (clé requise) ---------- */

function checkKey(req, res, next) {
  const key = req.headers['x-dash-key'] || req.query.key;
  if (!DASHBOARD_KEY || key !== DASHBOARD_KEY) return res.status(401).json({ error: 'clé invalide' });
  next();
}

app.get('/api/orders', checkKey, (req, res) => {
  res.json({ orders: orders.slice(-500).reverse() });
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

/* ---------- Site statique ---------- */

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Mademoiselle Bobùn en ligne sur :${port} · commandes chargées : ${orders.length}`));
