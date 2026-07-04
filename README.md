# Mademoiselle Bobùn — « La descente du bol »

Site one-page cinématique scroll-driven. 100 % statique : HTML + CSS + JS vanilla,
GSAP 3 / ScrollTrigger / Lenis via CDN. Aucune dépendance serveur.

## Structure

```
index.html          page « La descente du bol » (7 clips, bol sticky à 6 états)
css/style.css       design system + layout + reduced-motion + mobile
js/main.js          préchargement, scrubbing canvas, ligne SVG, bol, particules
bobunbeef/          page « /bobunbeef » : une vidéo master 15 s scrubée en continu
  index.html          canvas fixe + calques UI permutés dans les whiteouts
  style.css           design system + mode flat (reduced-motion / fallback)
  main.js             mapping scroll→frame non linéaire, lerp, portails
assets/frames/      frames webp : 7 clips (73 × 1280px) + desktop/ (226 × 1600px)
                    + mobile/ (226 × 900px) + manifest.json
assets/bowl/        6 états du bol (webp 640×640)
assets/video/       bobun_1080.mp4 (fallback + reduced-motion, 8,6 Mo)
assets/poster.jpg   frame finale (OG image + poster vidéo)
raw/                sources mp4/png — NE PAS DÉPLOYER (~70 Mo inutiles en prod)
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
