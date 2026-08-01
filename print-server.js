#!/usr/bin/env node
/* ============================================================
   BOBUN PRINT SERVER
   Petit serveur local qui tourne sur le PC du restaurant.
   - Recoit les ordres d'impression du dashboard (HTTPS -> localhost OK)
   - Imprime sur la Star mC-Print3 via TCP
   - Poll aussi Railway pour l'impression automatique

   Usage :
     node print-server.js --key CLE_DASHBOARD
     node print-server.js --key CLE --printer 192.168.1.16 --port 3333
   ============================================================ */

'use strict';

const net = require('net');
const http = require('http');
const https = require('https');

/* ---- Config ---- */

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : '';
}

const KEY = arg('key') || process.env.DASHBOARD_KEY || '';
const RAILWAY = (arg('server') || process.env.SERVER_URL || 'https://mllebobun-production.up.railway.app').replace(/\/$/, '');
const PRINTER_IP = arg('printer') || process.env.PRINTER_IP || '192.168.1.16';
const PRINTER_PORT = 9100;
const LOCAL_PORT = Number(arg('port')) || 3333;

if (!KEY) {
  console.error('\n  Usage : node print-server.js --key VOTRE_CLE_DASHBOARD\n');
  process.exit(1);
}

/* ---- ESC/POS ---- */

function ascii(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0153\u0152]/g, 'oe').replace(/\u20ac/g, 'EUR')
    .replace(/[\u00ab\u00bb\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\x20-\x7E\n]/g, '');
}

function line2(left, right, w) {
  w = w || 32;
  left = ascii(left); right = ascii(right);
  return left + ' '.repeat(Math.max(1, w - left.length - right.length)) + right + '\n';
}

function eurFmt(c) { return (c / 100).toFixed(2).replace('.', ',') + 'EUR'; }

function buildTicket(order) {
  const ESC = '\x1B', GS = '\x1D';
  const BOLD = ESC + 'E\x01', NOBOLD = ESC + 'E\x00';
  const CENTER = ESC + 'a\x01', LEFT = ESC + 'a\x00';
  const BIG = GS + '!\x11', NORMAL = GS + '!\x00';
  const CUT = GS + 'V\x41\x03';
  const sep = '--------------------------------\n';
  const d = new Date(order.date);
  const dateFmt = d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
  const heureFmt = d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const nbItems = (order.items || []).reduce(function(s, i) { return s + i.qty; }, 0);

  let t = ESC + '\x40' + CENTER + '\n';
  t += BOLD + 'Mademoiselle Bo Bun\n' + NOBOLD;
  t += BIG + '#' + ascii(order.code) + '\n' + NORMAL;
  t += sep;
  t += LEFT;
  t += 'Commande passee: ' + dateFmt + ' ' + heureFmt + '\n\n';
  if (order.phone) t += 'Telephone: ' + ascii(order.phone) + '\n';
  if (order.email) t += 'Email: ' + ascii(order.email) + '\n';
  t += 'Methode de paiement: ' + (order.status === 'sur place' ? 'sur place' : 'carte') + '\n\n';
  if (order.note) t += BOLD + 'Notes: ' + ascii(order.note).toUpperCase() + '\n' + NOBOLD + '\n';
  t += sep;
  for (const i of (order.items || [])) {
    t += line2(i.qty + 'x ' + ascii(i.name), eurFmt(i.amount));
  }
  t += '\n' + line2('Nombre de produits:', String(nbItems));
  t += BOLD + line2('Total:', eurFmt(order.amount)) + NOBOLD;
  t += sep + CENTER + '\n';
  if (order.status === 'sur place') t += BIG + 'SUR PLACE\n' + NORMAL;
  else if (order.driveWanted) t += BIG + 'DRIVE\n' + NORMAL;
  else t += BIG + 'A EMPORTER\n' + NORMAL;
  t += '\n\n' + CUT;
  return Buffer.from(t, 'binary');
}

/* ---- Impression TCP ---- */

function printTCP(order, copies) {
  copies = copies || 2;
  return new Promise(function(resolve, reject) {
    const buf = buildTicket(order);
    const full = Buffer.concat(Array(copies).fill(buf));
    const sock = new net.Socket();
    sock.setTimeout(5000);
    sock.connect(PRINTER_PORT, PRINTER_IP, function() {
      sock.write(full, function() { sock.end(); resolve(); });
    });
    sock.on('error', reject);
    sock.on('timeout', function() { sock.destroy(); reject(new Error('timeout')); });
  });
}

function testPrinter() {
  return new Promise(function(resolve, reject) {
    const sock = new net.Socket();
    sock.setTimeout(3000);
    sock.connect(PRINTER_PORT, PRINTER_IP, function() { sock.end(); resolve(); });
    sock.on('error', reject);
    sock.on('timeout', function() { sock.destroy(); reject(new Error('timeout')); });
  });
}

/* ---- Serveur HTTP local ---- */

const server = http.createServer(function(req, res) {
  // CORS : le dashboard HTTPS peut appeler localhost
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /status
  if (req.method === 'GET' && req.url === '/status') {
    testPrinter()
      .then(function() {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, printer: PRINTER_IP }));
      })
      .catch(function(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      });
    return;
  }

  // POST /print
  if (req.method === 'POST' && req.url === '/print') {
    let body = '';
    req.on('data', function(d) { body += d; });
    req.on('end', function() {
      try {
        const order = JSON.parse(body);
        if (!order || !order.code) throw new Error('Commande invalide');
        printTCP(order, 2)
          .then(function() {
            console.log('[IMPRIME] ' + order.code + ' (x2)');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          })
          .catch(function(e) {
            console.error('[ERREUR] ' + order.code + ' : ' + e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
          });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET / : page de status
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><head><title>Bobun Print Server</title>'
      + '<style>body{background:#0B0805;color:#F4EDE0;font-family:system-ui;padding:40px;text-align:center}'
      + '.ok{color:#2ECC71}.err{color:#ff9d7a}#log{text-align:left;font-family:monospace;font-size:.75rem;'
      + 'max-width:500px;margin:20px auto;background:#151009;padding:16px;border-radius:12px;max-height:60vh;overflow-y:auto}</style></head>'
      + '<body><h1>Bobun Print Server</h1>'
      + '<p id="st">Verification...</p><div id="log"></div>'
      + '<script>'
      + 'fetch("/status").then(r=>r.json()).then(d=>{'
      + 'document.getElementById("st").innerHTML=d.ok'
      + '?"<span class=ok>Imprimante connectee ("+d.printer+")</span>"'
      + ':"<span class=err>Imprimante non joignable : "+d.error+"</span>"'
      + '}).catch(e=>{document.getElementById("st").innerHTML="<span class=err>Erreur</span>"})'
      + '</script></body></html>');
    return;
  }

  res.writeHead(404); res.end('Not found');
});

/* ---- Polling Railway pour impression auto ---- */

const printed = new Set();
let firstPoll = true;

function fetchJSON(url) {
  const lib = url.startsWith('https') ? https : http;
  return new Promise(function(resolve, reject) {
    lib.get(url, { headers: { 'X-Dash-Key': KEY } }, function(res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function(d) { body += d; });
      res.on('end', function() {
        if (res.statusCode === 401) return reject(new Error('Cle refusee (401)'));
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function poll() {
  try {
    const data = await fetchJSON(RAILWAY + '/api/orders');
    const orders = data.orders || [];
    if (firstPoll) {
      orders.forEach(function(o) { printed.add(o.sessionId); });
      console.log('[POLL] ' + orders.length + ' commande(s) existante(s) (pas de re-impression)');
      firstPoll = false;
    } else {
      for (const o of orders) {
        if (printed.has(o.sessionId)) continue;
        printed.add(o.sessionId);
        const items = (o.items || []).map(function(i) { return i.qty + 'x ' + i.name; }).join(', ');
        console.log('[COMMANDE] ' + o.code + ' | ' + items);
        try {
          await printTCP(o, 2);
          console.log('[IMPRIME] ' + o.code + ' (x2 tickets)');
        } catch (e) {
          console.error('[ERREUR]  ' + o.code + ' : ' + e.message);
        }
      }
    }
    // re-impressions demandees depuis le dashboard
    const rp = await fetchJSON(RAILWAY + '/api/reprint');
    for (const o of (rp.orders || [])) {
      console.log('[RE-IMPRESSION] ' + o.code);
      try { await printTCP(o, 2); console.log('[IMPRIME] ' + o.code + ' (x2)'); }
      catch (e) { console.error('[ERREUR] ' + o.code + ' : ' + e.message); }
    }
  } catch (e) {
    if (e.message.includes('401')) {
      console.error('[ERREUR] Cle refusee. Verifiez --key');
      process.exit(1);
    }
    console.error('[POLL] ' + e.message);
  }
}

/* ---- Demarrage ---- */

console.log('');
console.log('  ====================================');
console.log('  BOBUN PRINT SERVER');
console.log('  ====================================');
console.log('  Serveur Railway : ' + RAILWAY);
console.log('  Imprimante      : ' + PRINTER_IP + ':' + PRINTER_PORT);
console.log('  Ecoute sur      : http://localhost:' + LOCAL_PORT);
console.log('');

testPrinter()
  .then(function() { console.log('[OK] Imprimante Star mC-Print3 connectee'); })
  .catch(function(e) { console.error('[ATTENTION] Imprimante non joignable : ' + e.message); });

server.listen(LOCAL_PORT, function() {
  console.log('[OK] Print Server demarre sur http://localhost:' + LOCAL_PORT);
  console.log('[POLL] Verification commandes toutes les 5s...\n');
  poll();
  setInterval(poll, 5000);
});
