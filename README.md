# Mademoiselle Bobùn — « La descente du bol »

Site one-page cinématique scroll-driven. 100 % statique : HTML + CSS + JS vanilla,
GSAP 3 / ScrollTrigger / Lenis via CDN. Aucune dépendance serveur.

## Structure

```
index.html          page unique
css/style.css       design system + layout + reduced-motion + mobile
js/main.js          préchargement, scrubbing canvas, ligne SVG, bol, particules
assets/frames/      511 frames webp (73 × 7 clips, 12 fps, 1280px) + manifest.json
assets/bowl/        6 états du bol (webp 640×640)
raw/                sources mp4/png — NE PAS DÉPLOYER (30 Mo inutiles en prod)
```

## Lancer en local

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

(Un serveur est nécessaire pour le fetch de `manifest.json` — ne pas ouvrir en `file://`.)

## Déployer

- **Netlify Drop** : supprimer ou écarter `raw/`, puis glisser le dossier sur https://app.netlify.com/drop
- **Vercel** : `vercel --prod` à la racine (ajouter `raw` dans `.vercelignore`)

Poids déployé : ~20 Mo (frames webp). Le hero (~2,3 Mo) est préchargé avant
l'ouverture ; le reste se charge en tâche de fond pendant le scroll.
