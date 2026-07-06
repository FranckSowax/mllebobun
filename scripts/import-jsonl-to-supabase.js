/* ============================================================
   Import de l'historique JSONL (volume Railway) vers Supabase.
   Usage :
     SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
     ORDERS_FILE=/data/orders.jsonl node scripts/import-jsonl-to-supabase.js
   Idempotent : upsert sur session_id.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const FILE = process.env.ORDERS_FILE || path.join(process.env.DATA_DIR || './data', 'orders.jsonl');

if (!URL || !KEY) { console.error('SUPABASE_URL et SUPABASE_SERVICE_KEY requis'); process.exit(1); }
if (!fs.existsSync(FILE)) { console.error('Fichier introuvable : ' + FILE); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// reconstruit l'état des commandes depuis le journal (ordres + événements drive)
const orders = new Map();
for (const line of fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean)) {
  let l; try { l = JSON.parse(line); } catch (e) { continue; }
  if (l._evt === 'drive') {
    const o = orders.get(l.sessionId);
    if (o) o.drive = { vehicle: l.vehicle, at: l.date };
  } else if (l.sessionId) {
    orders.set(l.sessionId, l);
  }
}

const rows = [...orders.values()].map(o => ({
  session_id: o.sessionId, code: o.code, order_date: o.date,
  items: o.items || [], amount: o.amount || 0, note: o.note || '',
  phone: o.phone || '', email: o.email || '', status: o.status || 'payée',
  drive: o.drive || null
}));

(async () => {
  console.log(`Import de ${rows.length} commandes…`);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await sb.from('orders').upsert(chunk, { onConflict: 'session_id' });
    if (error) { console.error('Erreur:', error.message); process.exit(1); }
    console.log(`  ${Math.min(i + 200, rows.length)}/${rows.length}`);
  }
  console.log('Terminé.');
})();
