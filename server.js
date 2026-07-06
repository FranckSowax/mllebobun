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
const { createClient } = require('@supabase/supabase-js');

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

// Supabase (optionnel) : durable + requêtable. Repli JSONL si non configuré.
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
// Init défensive : une erreur Supabase ne doit jamais faire tomber le site
// (repli transparent sur le volume). WebSocket fournie via 'ws' pour Node < 22.
let sb = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    let WS;
    try { WS = require('ws'); } catch (e) { WS = undefined; }
    sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: WS ? { transport: WS } : undefined
    });
  } catch (e) {
    console.error('supabase init (repli volume):', e.message);
    sb = null;
  }
}

function orderToRow(o) {
  return {
    session_id: o.sessionId, code: o.code, order_date: o.date,
    items: o.items, amount: o.amount, note: o.note || '',
    phone: o.phone || '', email: o.email || '',
    status: o.status || 'payée', drive: o.drive || null
  };
}
function rowToOrder(r) {
  const o = {
    id: (r.session_id || '').slice(-10), sessionId: r.session_id, code: r.code,
    date: r.order_date, items: r.items || [], amount: r.amount,
    note: r.note || '', phone: r.phone || '', email: r.email || '',
    status: r.status || 'payée'
  };
  if (r.drive) o.drive = r.drive;
  return o;
}
async function sbUpsert(o) {
  if (!sb) return;
  try {
    const { error } = await sb.from('orders').upsert(orderToRow(o), { onConflict: 'session_id' });
    if (error) throw error;
  } catch (e) { console.error('supabase upsert:', e.message); }
}
async function sbUpdateDrive(sessionId, drive) {
  if (!sb) return;
  try {
    const { error } = await sb.from('orders').update({ drive }).eq('session_id', sessionId);
    if (error) throw error;
  } catch (e) { console.error('supabase drive:', e.message); }
}
async function sbLoad() {
  if (!sb) return;
  try {
    const before = orders.map(o => o.sessionId);
    const { data, error } = await sb.from('orders').select('*').order('order_date', { ascending: true }).limit(5000);
    if (error) throw error;
    const known = new Set();
    for (const r of (data || [])) {
      const o = rowToOrder(r);
      known.add(o.sessionId);
      const i = orders.findIndex(x => x.sessionId === o.sessionId);
      if (i >= 0) orders[i] = o; else orders.push(o);
    }
    orders.sort((a, b) => new Date(a.date) - new Date(b.date));
    console.log(`supabase: ${(data || []).length} commandes chargées`);
    // back-fill : commandes présentes dans le volume mais pas encore dans Supabase
    const missing = before.filter(sid => !known.has(sid));
    if (missing.length) {
      const rows = orders.filter(o => missing.includes(o.sessionId)).map(orderToRow);
      const { error: e2 } = await sb.from('orders').upsert(rows, { onConflict: 'session_id' });
      console.log(`supabase back-fill: ${e2 ? 'échec ' + e2.message : rows.length + ' commandes importées'}`);
    }
  } catch (e) { console.error('supabase load:', e.message); }
}

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

// Menu piloté par Supabase (prix, descriptions, images). Repli sur CATALOG codé en dur.
let MENU = {};   // id -> { id, cat, name, name_vn, description, amount, image, sup, active }
function catItem(id) {
  const m = MENU[id];
  if (m && m.active !== false) return m;
  const c = CATALOG[id];
  return c ? { id, name: c.name, amount: c.amount, description: c.description || '', sup: !!c.sup, active: true } : null;
}
function effectiveCatalog() {
  const out = {};
  for (const [id, c] of Object.entries(CATALOG)) {
    out[id] = { id, name: c.name, amount: c.amount, description: c.description || '', sup: !!c.sup, active: true, name_vn: '' };
  }
  for (const [id, m] of Object.entries(MENU)) if (m.active !== false) out[id] = m; else delete out[id];
  return out;
}
async function sbLoadMenu() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from('menu_items').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    const m = {};
    for (const r of (data || [])) {
      m[r.id] = {
        id: r.id, cat: r.cat, name: r.name, name_vn: r.name_vn || '',
        description: r.description || '', amount: r.amount, image: r.image || '',
        sup: !!r.is_supplement, active: r.active !== false, sort: r.sort_order || 0
      };
    }
    MENU = m;
    console.log(`supabase: ${Object.keys(m).length} articles de menu chargés`);
  } catch (e) { console.error('supabase menu:', e.message); }
}

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
  sbUpsert(order);
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
    supabase: !!sb,
    orders: orders.length
  });
});

/* ---------- Checkout ---------- */

app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Paiement non configuré.' });
  try {
    const { items, lines, note, page, wa } = req.body || {};

    const waDigits = frPhoneToWa(wa);
    if (waDigits.length < 10 || waDigits.length > 15) {
      return res.status(400).json({ error: 'Numéro WhatsApp requis pour le code de retrait.' });
    }

    const supName = n => n.replace(/^Supplément\s+/i, '').trim();
    let line_items;

    if (Array.isArray(lines) && lines.length) {
      // format « ligne » : un bol + ses propres suppléments
      const valid = lines.slice(0, 30).map(l => {
        const dish = l && catItem(l.dish);
        if (!dish || dish.sup) return null;
        const sups = (Array.isArray(l.sups) ? l.sups : [])
          .map(id => catItem(id)).filter(s => s && s.sup);
        return { dish, sups };
      }).filter(Boolean);
      if (!valid.length) return res.status(400).json({ error: 'Ajoutez au moins un bol.' });

      // regroupe les lignes identiques (même bol + mêmes suppléments)
      const groups = {};
      for (const v of valid) {
        const sig = v.dish.id + '|' + v.sups.map(s => s.id).sort().join(',');
        (groups[sig] || (groups[sig] = { v, qty: 0 })).qty++;
      }
      line_items = Object.values(groups).map(({ v, qty }) => {
        const name = v.dish.name + (v.sups.length ? ` + ${v.sups.map(s => supName(s.name)).join(', ')}` : '');
        const amount = v.dish.amount + v.sups.reduce((s, x) => s + x.amount, 0);
        return { quantity: qty, price_data: { currency: 'eur', unit_amount: amount, product_data: { name } } };
      });
    } else {
      // ancien format « plat » à plat (compat)
      const valid = (Array.isArray(items) ? items : [])
        .filter(i => i && catItem(i.id) && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 20);
      if (!valid.some(i => !catItem(i.id).sup)) {
        return res.status(400).json({ error: 'Ajoutez au moins un bol.' });
      }
      line_items = valid.map(i => {
        const c = catItem(i.id);
        return {
          quantity: i.qty,
          price_data: {
            currency: 'eur',
            unit_amount: c.amount,
            product_data: Object.assign({ name: c.name }, c.description ? { description: c.description } : {})
          }
        };
      });
    }

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

/* ---------- DÉMO : paiement simulé, workflows réels ---------- */
app.post('/api/demo', checkKey, async (req, res) => {
  try {
    const { wa, note, item } = req.body || {};
    const waDigits = frPhoneToWa(wa);
    if (waDigits.length < 10 || waDigits.length > 15) {
      return res.status(400).json({ error: 'Numéro WhatsApp requis (pour recevoir le code de la démo).' });
    }
    const c = item ? catItem(item) : null;
    const items = c
      ? [{ name: c.name + ' — DÉMO', qty: 1, amount: 0 }]
      : [{ name: 'Commande démo — test workflow', qty: 1, amount: 0 }];
    const now = new Date();
    const order = {
      id: 'demo' + now.getTime().toString(36),
      sessionId: 'demo_' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
      code: pickupCode(),
      date: now.toISOString(),
      items, amount: 0,
      note: String(note || '').slice(0, 400).trim(),
      phone: waDigits, email: '',
      status: 'démo'
    };
    saveOrder(order);                                   // dashboard + overlay + impression + Supabase
    sendCustomerWhatsApp(order).catch(e => console.error('demo wa client:', e.message)); // code + QR + Drive
    sendTeamWhatsApp(order).catch(e => console.error('demo wa équipe:', e.message));
    res.json({ ok: true, session_id: order.sessionId, code: order.code });
  } catch (e) {
    console.error('demo:', e.message);
    res.status(500).json({ error: 'erreur' });
  }
});

/* Code de retrait affiché sur merci.html */
app.get('/api/session/:id', async (req, res) => {
  const id = req.params.id;
  // commandes démo / sur place : lues depuis la mémoire
  if (/^(demo|surplace)_/.test(id)) {
    const o = orders.find(x => x.sessionId === id);
    return res.json(o ? { code: o.code, amount: o.amount, demo: id.startsWith('demo_') } : {});
  }
  if (!stripe || !/^cs_(live|test)_/.test(id)) return res.status(400).json({});
  try {
    const s = await stripe.checkout.sessions.retrieve(id);
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
  const drive = { vehicle: cleanVehicle, at: evt.date };
  if (stored) stored.drive = drive;
  appendLine(evt);
  sbUpdateDrive(order.sessionId, drive);
  broadcast('drive', { code: order.code, vehicle: cleanVehicle, sessionId: order.sessionId, at: evt.date });
}

app.post('/api/drive', async (req, res) => {
  try {
    const { session_id, vehicle } = req.body || {};
    if (!/^(cs_(live|test)|demo|surplace)_/.test(String(session_id || ''))) return res.status(400).json({ error: 'session invalide' });
    let order = orders.find(o => o.sessionId === session_id);
    if (!order && /^cs_(live|test)_/.test(session_id) && stripe) {
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

// extrait l'identifiant/titre d'une réponse à un bouton, quel que soit le format Whapi
function extractButton(m) {
  const paths = [
    m.reply && m.reply.buttons_reply, m.reply && m.reply.list_reply,
    m.interactive && m.interactive.button_reply, m.interactive && m.interactive.list_reply,
    m.button, m.action && m.action.button_reply, m.context && m.context.button
  ];
  for (const p of paths) {
    if (p && (p.id || p.title)) return { id: String(p.id || ''), title: String(p.title || '') };
  }
  // certains canaux renvoient le bouton comme un simple texte "quoted"
  if (m.type === 'button' && m.button && m.button.text) return { id: '', title: String(m.button.text) };
  return null;
}

async function handleWhapiBody(body) {
  const messages = (body && body.messages) || (body && body.message ? [body.message] : []);
  console.log('whapi in:', JSON.stringify(body).slice(0, 400));
  for (const m of messages) {
    if (!m || m.from_me) continue;
    const from = String(m.from || m.chat_id || m.sender || '').replace(/\D/g, '');
    if (!from) continue;

    const btn = extractButton(m);
    const text = (m.text && m.text.body ? String(m.text.body) : (typeof m.body === 'string' ? m.body : '')).trim();

    // 1) signal « je suis garé » : bouton drive_ OU tout bouton/texte d'un client avec commande récente
    const btnId = btn ? btn.id : '';
    const btnLabel = (btn ? btn.title : '').toLowerCase();
    const looksDrive = btnId.includes('drive_') || /gar[ée]|arriv|je suis l|devant/i.test(btnLabel);
    if (looksDrive || (btn && findRecentOrderByPhone(from))) {
      let order = null;
      const mDrive = btnId.match(/drive_([A-Za-z0-9_]+)/);
      if (mDrive) order = orders.find(o => o.sessionId === mDrive[1]);
      if (!order) order = findRecentOrderByPhone(from);
      if (order) {
        markDrive(order, '');
        pendingVehicle.set(from, { sessionId: order.sessionId, until: Date.now() + 30 * 60 * 1000 });
        await whapi('/messages/text', {
          to: from,
          body: '🚗 Bien reçu ! Décrivez votre véhicule en réponse (couleur, modèle ou plaque) pour qu\'on vous trouve.'
        }).catch(e => console.error(e.message));
      } else {
        console.log('whapi drive: aucune commande récente pour', from);
      }
      continue;
    }

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
}

// jeton dans le CHEMIN (toujours conservé) ou en query (compat)
app.post('/api/whapi/webhook/:t', async (req, res) => {
  res.json({ ok: true });
  if (WHAPI_HOOK_T && req.params.t !== WHAPI_HOOK_T) { console.log('whapi: jeton chemin invalide'); return; }
  handleWhapiBody(req.body).catch(e => console.error('whapi webhook:', e.message));
});

app.post('/api/whapi/webhook', async (req, res) => {
  res.json({ ok: true }); // répondre vite, traiter ensuite
  try {
    if (WHAPI_HOOK_T && req.query.t !== WHAPI_HOOK_T) { console.log('whapi: jeton query invalide/absent'); return; }
    await handleWhapiBody(req.body);
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

/* traduction des notes clients (fr → vi) pour la cuisine — cache mémoire */
const trCache = new Map();
app.get('/api/translate', checkKey, async (req, res) => {
  const text = String(req.query.text || '').slice(0, 400).trim();
  const tl = /^[a-z]{2}$/.test(req.query.tl) ? req.query.tl : 'vi';
  if (!text) return res.json({ vi: '' });
  const key = tl + '|' + text;
  if (trCache.has(key)) return res.json({ vi: trCache.get(key) });
  try {
    const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
    const data = await r.json();
    const vi = (data[0] || []).map(seg => seg[0]).join('');
    if (trCache.size > 2000) trCache.clear();
    trCache.set(key, vi);
    res.json({ vi });
  } catch (e) {
    res.json({ vi: '', error: true });
  }
});

/* statistiques : historique par jour + KPIs (fuseau Europe/Paris) */
const dayFmt = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const parisDay = iso => dayFmt.format(new Date(iso)); // 'YYYY-MM-DD'
const isBowl = name => !/^suppl[ée]ment/i.test(name || '');
const bowlsOf = o => o.items.reduce((s, i) => s + (isBowl(i.name) ? i.qty : 0), 0);

app.get('/api/stats', checkKey, (req, res) => {
  const today = parisDay(new Date().toISOString());
  const days = {};       // 'YYYY-MM-DD' -> {orders, ca, bowls}
  const dishes = {};     // name -> qty (plats uniquement)
  let online = 0, surplace = 0, drive = 0;
  const now = Date.now();
  let ca7 = 0, ord7 = 0, ca30 = 0, ord30 = 0;

  for (const o of orders) {
    if (o.status === 'démo') continue;   // les commandes démo ne comptent pas dans les stats
    const d = parisDay(o.date);
    const day = days[d] || (days[d] = { orders: 0, ca: 0, bowls: 0 });
    day.orders++; day.ca += o.amount; day.bowls += bowlsOf(o);
    if (o.status === 'sur place') surplace++; else online++;
    if (o.drive) drive++;
    o.items.forEach(i => { if (isBowl(i.name)) dishes[i.name] = (dishes[i.name] || 0) + i.qty; });
    const age = now - new Date(o.date).getTime();
    if (age <= 7 * 864e5) { ca7 += o.amount; ord7++; }
    if (age <= 30 * 864e5) { ca30 += o.amount; ord30++; }
  }

  const td = days[today] || { orders: 0, ca: 0, bowls: 0 };
  const byDay = Object.entries(days)
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 30);
  const topDishes = Object.entries(dishes)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty).slice(0, 8);

  res.json({
    today: { orders: td.orders, ca: td.ca, bowls: td.bowls, avg: td.orders ? Math.round(td.ca / td.orders) : 0 },
    week: { ca: ca7, orders: ord7 },
    month: { ca: ca30, orders: ord30 },
    totals: { orders: online + surplace, online, surplace, drive },
    byDay, topDishes, source: sb ? 'supabase' : 'volume'
  });
});

/* catalogue pour la prise de commande sur place (piloté par le menu) */
app.get('/api/catalog', checkKey, (req, res) => {
  const cat = effectiveCatalog();
  res.json({
    items: Object.values(cat)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map(c => ({ id: c.id, name: c.name, name_vn: c.name_vn || '', amount: c.amount, sup: !!c.sup }))
  });
});

/* menu public (pour synchroniser les prix affichés sur le site) */
app.get('/api/menu/public', (req, res) => {
  const cat = effectiveCatalog();
  res.json({
    items: Object.values(cat).map(c => ({
      id: c.id, cat: c.cat || (c.sup ? 'supplement' : ''), name: c.name,
      name_vn: c.name_vn || '', description: c.description || '',
      amount: c.amount, image: c.image || '', sup: !!c.sup
    }))
  });
});

/* ---------- Gestion du menu (dashboard, Supabase requis) ---------- */

app.get('/api/menu', checkKey, (req, res) => {
  const items = Object.values(effectiveCatalog())
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
  res.json({ items, editable: !!sb });
});

app.post('/api/menu', checkKey, async (req, res) => {
  if (!sb) return res.status(503).json({ error: 'Activez Supabase (clé service_role) pour modifier le menu.' });
  try {
    const b = req.body || {};
    let id = String(b.id || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
    if (!id) id = 'plat_' + Date.now().toString(36);
    const name = String(b.name || '').slice(0, 80).trim();
    if (!name) return res.status(400).json({ error: 'Le nom est requis.' });
    const amount = Math.max(0, Math.round(Number(b.amount) || 0));
    const row = {
      id, cat: ['bobun', 'loclac', 'supplement'].includes(b.cat) ? b.cat : 'bobun',
      name, name_vn: String(b.name_vn || '').slice(0, 80),
      description: String(b.description || '').slice(0, 400),
      amount, image: String(b.image || '').slice(0, 400),
      is_supplement: b.cat === 'supplement' || !!b.sup,
      active: b.active !== false, sort_order: Number(b.sort) || 0,
      updated_at: new Date().toISOString()
    };
    const { error } = await sb.from('menu_items').upsert(row, { onConflict: 'id' });
    if (error) throw error;
    await sbLoadMenu();
    res.json({ ok: true, id });
  } catch (e) {
    console.error('menu save:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/menu/delete', checkKey, async (req, res) => {
  if (!sb) return res.status(503).json({ error: 'Supabase requis.' });
  try {
    const id = String((req.body || {}).id || '');
    const { error } = await sb.from('menu_items').delete().eq('id', id);
    if (error) throw error;
    await sbLoadMenu();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* upload d'une image de plat vers Supabase Storage (dataURL base64) */
app.post('/api/menu/upload', checkKey, express.json({ limit: '6mb' }), async (req, res) => {
  if (!sb) return res.status(503).json({ error: 'Supabase requis.' });
  try {
    const { dataUrl, name } = req.body || {};
    const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/.exec(String(dataUrl || ''));
    if (!m) return res.status(400).json({ error: 'Image invalide (png, jpg ou webp).' });
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image trop lourde (max 5 Mo).' });
    const ext = m[2].replace('jpeg', 'jpg');
    const fname = `${Date.now().toString(36)}-${String(name || 'plat').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}.${ext}`;
    const { error } = await sb.storage.from('menu').upload(fname, buf, { contentType: m[1], upsert: true });
    if (error) throw error;
    const { data } = sb.storage.from('menu').getPublicUrl(fname);
    res.json({ ok: true, url: data.publicUrl });
  } catch (e) {
    console.error('upload:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* commande prise SUR PLACE depuis le dashboard (encaissement au comptoir) */
app.post('/api/orders/manual', checkKey, (req, res) => {
  try {
    const { items, note } = req.body || {};
    const valid = (Array.isArray(items) ? items : [])
      .filter(i => i && catItem(i.id) && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 30);
    if (!valid.length) return res.status(400).json({ error: 'Aucun article.' });
    const now = new Date();
    const order = {
      id: 'sp' + now.getTime().toString(36),
      sessionId: 'surplace_' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
      code: pickupCode(),
      date: now.toISOString(),
      items: valid.map(i => ({
        name: catItem(i.id).name, qty: i.qty, amount: catItem(i.id).amount * i.qty
      })),
      amount: valid.reduce((s, i) => s + catItem(i.id).amount * i.qty, 0),
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
          url: `${PUBLIC_URL}/api/whapi/webhook/${WHAPI_HOOK_T}`,
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
  sbLoad();
  sbLoadMenu();
});
