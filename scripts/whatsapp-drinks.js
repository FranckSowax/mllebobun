/* Crée les 11 boissons dans le catalogue WhatsApp (Whapi).
   Usage : WHAPI_TOKEN=<token> node scripts/whatsapp-drinks.js
   ⚠️ nécessite une session WhatsApp active (sinon 401 need channel authorization). */
const fs = require('fs');
const T = process.env.WHAPI_TOKEN, SITE = 'https://www.mademoisellebobun.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DRINKS = [
 { id:'coca', name:'Coca-Cola', price:2.00, desc:'33 cl.' },
 { id:'coca_zero', name:'Coca-Cola Zéro', price:2.00, desc:'33 cl.' },
 { id:'sprite', name:'Sprite', price:2.00, desc:'33 cl.' },
 { id:'fuzetea_citron', name:'Fuze Tea Citron', price:2.00, desc:'Thé glacé citron.' },
 { id:'fuzetea_peche', name:'Fuze Tea Pêche', price:2.00, desc:'Thé glacé pêche.' },
 { id:'perrier', name:'Perrier', price:2.00, desc:'Eau pétillante 33 cl.' },
 { id:'vittel', name:'Vittel', price:2.00, desc:'Eau minérale 50 cl.' },
 { id:'jus_litchi', name:'Jus de Litchi', price:2.50, desc:'Jus de litchi.' },
 { id:'jus_goyave', name:'Jus de Goyave', price:2.50, desc:'Jus de goyave.' },
 { id:'jus_coco', name:'Jus de Coco', price:2.50, desc:'Jus de coco.' },
 { id:'jus_mangue', name:'Jus de Mangue', price:2.50, desc:'Jus de mangue.' }
];
(async () => {
  if (!T) { console.error('WHAPI_TOKEN manquant'); process.exit(1); }
  const mapFile = 'data/whatsapp-catalog-map.json';
  const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};
  const fails = [];
  for (const d of DRINKS) {
    const slug = d.id.replace(/_/g, '-');
    if (map[slug] && map[slug].wid) { console.log('· déjà créé', d.id); continue; }
    try {
      const r = await fetch('https://gate.whapi.cloud/business/products', { method: 'POST',
        headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: d.name, price: d.price, currency: 'EUR', description: d.desc,
          availability: 'in stock', retailer_id: d.id, images: [`${SITE}/assets/plats/${slug}.jpg`] }),
        signal: AbortSignal.timeout(25000) });
      const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch (e) {}
      if (j && j.id) { map[slug] = { wid: j.id, name: d.name, price: d.price }; console.log('✓', d.id, '->', j.id); }
      else { fails.push(d.id); console.log('✗', d.id, txt.slice(0, 100)); }
    } catch (e) { fails.push(d.id); console.log('✗', d.id, e.message); }
    await sleep(400);
  }
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 1));
  console.log('\nmap total:', Object.keys(map).length, '· échecs:', fails.join(',') || '—');
})();
