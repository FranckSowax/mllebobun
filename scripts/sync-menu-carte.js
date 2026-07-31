/* Aligne le menu Supabase sur la CARTE PHYSIQUE (juillet 2026) :
   - ajuste 10 prix (bobun / loclac / padthai)
   - ajoute les 12 plats entrées + spécial
   Usage : DASH_KEY=<clé dashboard> node scripts/sync-menu-carte.js
   (relancer après restauration du projet Supabase — idempotent) */

const K = process.env.DASH_KEY;
const API = (process.env.API_BASE || 'https://mllebobun-production.up.railway.app') + '/api/menu';
const hdr = { 'Content-Type': 'application/json', 'x-dash-key': K };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const NEW_PRICES = { boeuf: 1200, poulet: 1200, crevette: 1300, veggie: 1200,
  loclac_boeuf: 1200, loclac_poulet: 1200, loclac_veggie: 1200,
  padthai_poulet: 1200, padthai_boeuf: 1200, padthai_crevette: 1300 };

const NEW_DISHES = [
  { id: 'nems', cat: 'entrees', name: 'Nems Poulet / Veggie', name_vn: 'Nem rán', amount: 600, sort: 40, description: 'Plat traditionnel du Viêt Nam, sorte de beignet frit constitué de farce.' },
  { id: 'samoussa', cat: 'entrees', name: 'Samoussa Poulet / Légumes', name_vn: 'Bánh gối', amount: 600, sort: 41, description: 'Servis par 4 avec sauce sweet chili.' },
  { id: 'raviolis_crevettes', cat: 'entrees', name: 'Raviolis Frits aux Crevettes', name_vn: 'Há cảo chiên', amount: 600, sort: 42, description: 'Raviolis dorés et croustillants aux crevettes.' },
  { id: 'goicuon_crevette', cat: 'entrees', name: 'Gỏi Cuốn Crevette', name_vn: 'Gỏi cuốn tôm', amount: 700, sort: 43, description: 'Grand rouleau de printemps aux crevettes, coupé en deux.' },
  { id: 'goicuon_boeuf', cat: 'entrees', name: 'Gỏi Cuốn Bœuf / Poulet', name_vn: 'Gỏi cuốn bò / gà', amount: 650, sort: 44, description: 'Grand rouleau de printemps au bœuf citronnelle, coupé en deux.' },
  { id: 'goicuon_veggie', cat: 'entrees', name: 'Gỏi Cuốn Veggie', name_vn: 'Gỏi cuốn chay', amount: 600, sort: 45, description: 'Grand rouleau de printemps au tofu mariné, coupé en deux.' },
  { id: 'ailes_poulet', cat: 'entrees', name: 'Ailes de Poulet', name_vn: 'Cánh gà chiên', amount: 700, sort: 46, description: 'Ailes de poulet marinées & frites façon vietnamienne (recette familiale). Servies par 8 avec sauce sweet chili.' },
  { id: 'banh_cuon', cat: 'entrees', name: 'Bánh Cuốn', name_vn: 'Bánh cuốn', amount: 750, sort: 47, description: 'Crêpe vietnamienne à base de farine de riz, enroulée et garnie de viande de porc hachée.' },
  { id: 'boeuf_oignons', cat: 'special', name: 'Bœuf aux Oignons', name_vn: 'Bò xào hành tây', amount: 1200, sort: 50, description: 'Émincés de bœuf sautés oignons & poivrons au wok, sauce secrète, servis avec riz blanc.' },
  { id: 'poulet_grille_viet', cat: 'special', name: 'Poulet Grillé Façon Viêt', name_vn: 'Gà nướng', amount: 1200, sort: 51, description: 'Poulet mariné sauce maison, grillé façon vietnamienne, servi avec riz blanc.' },
  { id: 'goi_tom_xoai', cat: 'special', name: 'Gỏi Tôm Xoài', name_vn: 'Gỏi tôm xoài', amount: 900, sort: 52, description: 'Salade de papaye, mangue, oignons, carottes râpées, cacahuète & oignons frits, accompagnée de crevettes marinées.' },
  { id: 'goi_ga', cat: 'special', name: 'Gỏi Gà', name_vn: 'Gỏi gà', amount: 800, sort: 53, description: 'Salade, poivrons, choux blanc, oignons avec poulet maison et oignons frits & cacahuète.' },
  /* boissons : 2 € — jus litchi/goyave/coco/mangue 2,50 € — bière Saigon 3 € */
  { id: 'coca', cat: 'boissons', name: 'Coca-Cola', name_vn: '', amount: 200, sort: 60, description: '33 cl.' },
  { id: 'coca_zero', cat: 'boissons', name: 'Coca-Cola Zéro', name_vn: '', amount: 200, sort: 61, description: '33 cl.' },
  { id: 'sprite', cat: 'boissons', name: 'Sprite', name_vn: '', amount: 200, sort: 62, description: '33 cl.' },
  { id: 'fuzetea_citron', cat: 'boissons', name: 'Fuze Tea Citron', name_vn: '', amount: 200, sort: 63, description: 'Thé glacé citron.' },
  { id: 'fuzetea_peche', cat: 'boissons', name: 'Fuze Tea Pêche', name_vn: '', amount: 200, sort: 64, description: 'Thé glacé pêche.' },
  { id: 'perrier', cat: 'boissons', name: 'Perrier', name_vn: '', amount: 200, sort: 65, description: 'Eau pétillante 33 cl.' },
  { id: 'vittel', cat: 'boissons', name: 'Vittel', name_vn: '', amount: 200, sort: 66, description: 'Eau minérale 50 cl.' },
  { id: 'jus_litchi', cat: 'boissons', name: 'Jus de Litchi', name_vn: 'Nước vải', amount: 250, sort: 67, description: 'Jus de litchi.' },
  { id: 'jus_goyave', cat: 'boissons', name: 'Jus de Goyave', name_vn: 'Nước ổi', amount: 250, sort: 68, description: 'Jus de goyave.' },
  { id: 'jus_coco', cat: 'boissons', name: 'Jus de Coco', name_vn: 'Nước dừa', amount: 250, sort: 69, description: 'Jus de coco.' },
  { id: 'jus_mangue', cat: 'boissons', name: 'Jus de Mangue', name_vn: 'Nước xoài', amount: 250, sort: 70, description: 'Jus de mangue.' },
  { id: 'biere_saigon', cat: 'boissons', name: 'Bière Saigon', name_vn: 'Bia Sài Gòn', amount: 300, sort: 71, description: 'Bière vietnamienne 33 cl.', image: '' }
];

(async () => {
  if (!K) { console.error('DASH_KEY manquant'); process.exit(1); }
  const cur = await fetch(API, { headers: hdr }).then(r => r.json());
  if (!cur.editable) { console.error('⚠️ Supabase non joignable (projet en pause ?) — rien modifié.'); process.exit(1); }
  const byId = Object.fromEntries(cur.items.map(i => [i.id, i]));
  let ok = 0; const ko = [];
  const post = async body => {
    const r = await fetch(API, { method: 'POST', headers: hdr, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (j.ok) { ok++; console.log('✓', body.id, (body.amount / 100).toFixed(2) + '€'); }
    else { ko.push(body.id); console.log('✗', body.id, j.error || r.status); }
    await sleep(250);
  };
  for (const [id, amount] of Object.entries(NEW_PRICES)) {
    const it = byId[id];
    if (!it) { ko.push(id); console.log('✗ absent', id); continue; }
    await post({ id, cat: it.cat, name: it.name, name_vn: it.name_vn || '', description: it.description || '',
      amount, image: it.image || '', active: it.active !== false, sort: it.sort || 0 });
  }
  for (const d of NEW_DISHES) await post({ ...d, image: d.image !== undefined ? d.image : '/assets/plats/' + d.id.replace(/_/g, '-') + '.webp', active: true });
  console.log('\n=== ok:', ok, '/ 22 · échecs:', ko.join(',') || '—');
})();
