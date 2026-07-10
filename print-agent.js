#!/usr/bin/env node
/* ============================================================
   BOBUN PRINT AGENT
   Script Node.js a lancer sur l'ordi du restaurant.
   Se connecte au serveur Railway en SSE, imprime chaque
   nouvelle commande sur la Star mC-Print3 (2 exemplaires).

   Usage :
     node print-agent.js
     node print-agent.js --key MA_CLE --server https://... --printer 192.168.1.16

   Variables d'environnement (alternative aux arguments) :
     DASHBOARD_KEY   cle d'acces au dashboard
     SERVER_URL      URL du serveur (defaut: https://mllebobun-production.up.railway.app)
     PRINTER_IP      IP de l'imprimante (defaut: 192.168.1.16)
   ============================================================ */

'use strict';

const net = require('net');
const https = require('https');
const http = require('http');

/* ---- Config ---- */

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : '';
}

const KEY = arg('key') || process.env.DASHBOARD_KEY || '';
const SERVER = (arg('server') || process.env.SERVER_URL || 'https://mllebobun-production.up.railway.app').replace(/\/$/, '');
const PRINTER_IP = arg('printer') || process.env.PRINTER_IP || '192.168.1.16';
const PRINTER_PORT = 9100;

if (!KEY) {
  console.error('\n  Usage : node print-agent.js --key VOTRE_CLE_DASHBOARD\n');
  process.exit(1);
}

/* ---- ESC/POS ticket ---- */

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
  const sp = Math.max(1, w - left.length - right.length);
  return left + ' '.repeat(sp) + right + '\n';
}

function eur(c) { return (c / 100).toFixed(2).replace('.', ',') + ' E'; }

function buildTicket(order) {
  const ESC = '\x1B';
  const GS = '\x1D';
  const sep = '--------------------------------\n';
  const d = new Date(order.date);
  const heure = d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  let t = '';
  t += ESC + '\x40';                                // init
  t += ESC + 'a\x01';                               // centre
  t += ESC + 'E\x01' + 'MADEMOISELLE BOBUN\n' + ESC + 'E\x00';
  t += '200 bis rue Malbec, Bordeaux\n';
  t += sep;
  t += ESC + '!\x30' + ascii(order.code) + '\n' + ESC + '!\x00';  // double taille
  t += sep;
  t += ESC + 'a\x00';                               // gauche
  for (const i of (order.items || [])) {
    t += ESC + 'E\x01' + ' ' + i.qty + ' x ' + ESC + 'E\x00' + ascii(i.name) + '  ' + eur(i.amount) + '\n';
  }
  t += sep;
  if (order.amount) {
    t += ESC + 'a\x01' + ESC + 'E\x01' + 'TOTAL : ' + eur(order.amount) + '\n' + ESC + 'E\x00';
  }
  if (order.note) {
    t += ESC + 'a\x00' + 'Note : ' + ascii(order.note) + '\n';
  }
  t += ESC + 'a\x01' + heure + '\n';
  if (order.status) t += ascii(order.status).toUpperCase() + '\n';
  t += '\n\n';
  t += GS + 'V\x41\x03';                           // coupe partielle
  return Buffer.from(t, 'binary');
}

/* ---- Impression TCP ---- */

function printTicket(order, copies) {
  copies = copies || 2;
  return new Promise(function(resolve, reject) {
    const buf = buildTicket(order);
    const full = Buffer.concat(Array(copies).fill(buf));
    const sock = new net.Socket();
    sock.setTimeout(5000);
    sock.connect(PRINTER_PORT, PRINTER_IP, function() {
      sock.write(full, function() {
        sock.end();
        resolve();
      });
    });
    sock.on('error', reject);
    sock.on('timeout', function() { sock.destroy(); reject(new Error('timeout')); });
  });
}

/* ---- Test imprimante ---- */

function testPrinter() {
  const buf = Buffer.from(
    '\x1B\x40\x1B\x61\x01\x1B\x45\x01'
    + 'PRINT AGENT OK\n'
    + '\x1B\x45\x00\x1B\x64\x03\x1D\x56\x42\x00',
    'binary'
  );
  return new Promise(function(resolve, reject) {
    const sock = new net.Socket();
    sock.setTimeout(5000);
    sock.connect(PRINTER_PORT, PRINTER_IP, function() {
      sock.write(buf, function() { sock.end(); resolve(); });
    });
    sock.on('error', reject);
    sock.on('timeout', function() { sock.destroy(); reject(new Error('timeout')); });
  });
}

/* ---- SSE : ecoute les nouvelles commandes ---- */

const printed = new Set();
let retryDelay = 3000;

function connectSSE() {
  const url = SERVER + '/api/orders/stream?key=' + encodeURIComponent(KEY);
  const lib = url.startsWith('https') ? https : http;

  console.log('[SSE] Connexion a ' + SERVER + ' ...');

  lib.get(url, function(res) {
    if (res.statusCode === 401) {
      console.error('[SSE] Cle refusee (401). Verifiez --key');
      process.exit(1);
    }
    if (res.statusCode !== 200) {
      console.error('[SSE] Erreur ' + res.statusCode + ', nouvelle tentative dans ' + (retryDelay / 1000) + 's');
      setTimeout(connectSSE, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
      return;
    }

    console.log('[SSE] Connecte ! En attente de commandes...\n');
    retryDelay = 3000;

    let buffer = '';

    res.setEncoding('utf8');
    res.on('data', function(chunk) {
      buffer += chunk;
      // parse SSE events
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // dernier element = incomplet
      for (const part of parts) {
        let event = 'message';
        let data = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('data: ')) data = line.slice(6);
          else if (line.startsWith('retry:')) { /* ignore */ }
          else if (line.startsWith(':')) { /* comment / ping */ }
        }
        if (event === 'order' && data) {
          try {
            const o = JSON.parse(data);
            if (printed.has(o.sessionId)) continue;
            printed.add(o.sessionId);
            const items = (o.items || []).map(function(i) { return i.qty + 'x ' + i.name; }).join(', ');
            console.log('[COMMANDE] ' + o.code + ' | ' + items + ' | ' + eur(o.amount));
            printTicket(o, 2)
              .then(function() { console.log('[IMPRIME] ' + o.code + ' (x2 tickets)\n'); })
              .catch(function(e) { console.error('[ERREUR]  Impression ' + o.code + ' : ' + e.message + '\n'); });
          } catch (e) {
            console.error('[ERREUR]  Parse : ' + e.message);
          }
        }
      }
    });

    res.on('end', function() {
      console.log('[SSE] Deconnecte, reconnexion dans 3s...');
      setTimeout(connectSSE, 3000);
    });

    res.on('error', function(e) {
      console.error('[SSE] Erreur : ' + e.message);
      setTimeout(connectSSE, retryDelay);
    });

  }).on('error', function(e) {
    console.error('[SSE] Connexion impossible : ' + e.message);
    console.error('      Nouvelle tentative dans ' + (retryDelay / 1000) + 's...');
    setTimeout(connectSSE, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  });
}

/* ---- Demarrage ---- */

console.log('');
console.log('  ============================');
console.log('  BOBUN PRINT AGENT');
console.log('  ============================');
console.log('  Serveur    : ' + SERVER);
console.log('  Imprimante : ' + PRINTER_IP + ':' + PRINTER_PORT);
console.log('');

testPrinter()
  .then(function() {
    console.log('[OK] Imprimante Star mC-Print3 connectee\n');
    connectSSE();
  })
  .catch(function(e) {
    console.error('[ATTENTION] Imprimante non joignable : ' + e.message);
    console.error('            Verifiez que l\'imprimante est allumee et sur le meme reseau wifi.\n');
    // on tente quand meme le SSE, l'imprimante sera peut-etre dispo plus tard
    connectSSE();
  });
