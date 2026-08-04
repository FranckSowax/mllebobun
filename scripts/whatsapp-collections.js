/* Organise le catalogue WhatsApp en collections (sections) dans l'ordre de la carte.
   Usage : WHAPI_TOKEN=<token> node scripts/whatsapp-collections.js */
const fs = require('fs');
const T = process.env.WHAPI_TOKEN;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const map = JSON.parse(fs.readFileSync('data/whatsapp-catalog-map.json', 'utf8'));
const w = slug => (map[slug] || {}).wid;
const COLLECTIONS = [
  { name: 'Nos Bo Bún', slugs: ['bobun-boeuf', 'bobun-poulet', 'bobun-crevette', 'bobun-veggie'] },
  { name: 'Loc Lac & Riz', slugs: ['loclac-boeuf', 'loclac-poulet', 'loclac-veggie', 'riz-cantonnais'] },
  { name: 'Pad Thai & Nouilles', slugs: ['padthai-poulet', 'padthai-boeuf', 'padthai-crevette', 'mi-xao'] },
  { name: 'Entrées', slugs: ['nems', 'samoussa', 'raviolis-crevettes', 'goicuon-crevette', 'goicuon-boeuf', 'goicuon-veggie', 'ailes-poulet', 'banh-cuon'] },
  { name: 'Spécial Viêt & Salades', slugs: ['boeuf-oignons', 'poulet-grille-viet', 'goi-tom-xoai', 'goi-ga'] },
  { name: 'Boissons', slugs: ['coca', 'coca-zero', 'sprite', 'fuzetea-citron', 'fuzetea-peche', 'perrier', 'vittel', 'jus-litchi', 'jus-goyave', 'jus-coco', 'jus-mangue'] }
];
(async () => {
  if (!T) { console.error('WHAPI_TOKEN manquant'); process.exit(1); }
  for (const c of COLLECTIONS) {
    const products = c.slugs.map(w).filter(Boolean);
    try {
      const r = await fetch('https://gate.whapi.cloud/business/collections', { method: 'POST',
        headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: c.name, products }),
        signal: AbortSignal.timeout(30000) });
      const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch (e) {}
      console.log(j.id ? `✓ ${c.name} (${products.length} produits) -> ${j.id}` : `✗ ${c.name} ${txt.slice(0, 140)}`);
    } catch (e) { console.log('✗', c.name, e.message); }
    await sleep(900);
  }
})();
