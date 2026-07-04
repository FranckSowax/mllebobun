/* ============================================================
   MADEMOISELLE BOBÙN — serveur de commande à emporter
   Sert le site statique + POST /api/checkout (Stripe Checkout).
   La clé Stripe vit dans STRIPE_SECRET_KEY (variable Railway),
   jamais dans le code ni côté client.
   ============================================================ */

'use strict';

const path = require('path');
const express = require('express');
const Stripe = require('stripe');

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

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
  }
};

const CANCEL_PATHS = ['/', '/bobunbeef/'];

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, stripe: !!stripe });
});

app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Paiement non configuré.' });
  try {
    const { items, note, page } = req.body || {};

    const line_items = (Array.isArray(items) ? items : [])
      .filter(i => i && CATALOG[i.id] && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 20)
      .map(i => ({
        quantity: i.qty,
        price_data: {
          currency: 'eur',
          unit_amount: CATALOG[i.id].amount,
          product_data: {
            name: CATALOG[i.id].name,
            description: CATALOG[i.id].description
          }
        }
      }));

    if (!line_items.length) return res.status(400).json({ error: 'Panier vide.' });

    const cleanNote = String(note || '').slice(0, 400).trim();
    const origin = `${req.protocol}://${req.get('host')}`;
    const cancelPath = CANCEL_PATHS.includes(page) ? page : '/';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'fr',
      submit_type: 'pay',
      line_items,
      phone_number_collection: { enabled: true },
      metadata: {
        source: 'site — à emporter',
        note: cleanNote || '—'
      },
      payment_intent_data: {
        description: 'Commande à emporter — Mademoiselle Bobùn'
          + (cleanNote ? ` · Note : ${cleanNote.slice(0, 200)}` : '')
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

// Site statique
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Mademoiselle Bobùn en ligne sur :${port}`));
