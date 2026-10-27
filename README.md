# Ara's DNA — Food Trailer Platform

Ordering kiosk, kitchen display, admin dashboard and public website for the Ara's DNA food trailer
(ice cream, Island Ice, sorbet, hot dogs, chili dogs, lemonade, cookies and brownies).

## Pages
| Path | Purpose |
|---|---|
| `/` | Public homepage: hero, crowd favorites, full menu, **video gallery** with lightbox, visit info |
| `/kiosk` | Customer ordering (cart drawer, Popular tab, qty stepper, attract mode, Square/Stripe/cash) |
| `/kds` | Kitchen display |
| `/admin` | Admin dashboard (PIN protected): orders, menu, **Videos**, settings, payments |

## Features
- Menu with modifiers; **prices are always recalculated on the server** (client prices are ignored).
- Input validation: unknown items/options, quantity 1-50, required and single-choice groups.
- Payments: Square Web Payments SDK + Stripe Elements (lazy-loaded), demo/cash mode.
- **Video upload** (admin > Videos): drag and drop, progress bars, rename, "feature on homepage hero", delete.
  MP4 / WebM / MOV, max 95 MB each, stored in Cloudflare R2, streamed with HTTP Range (seekable, works on iPhone).
- Kiosk **attract mode**: featured video loops when idle, touch to start; abandoned carts reset.
- Admin PIN gate on every `/api/admin/*` route.

## API (main)
- `GET /api/menu`, `POST /api/orders` (`{customerName, notes, items:[{id, quantity, modifiers:[optionName]}]}`)
- `GET /api/videos`, `GET /api/videos/:id` (Range 206/416)
- Admin (header `x-admin-pin`): `GET /api/admin/ping`, `POST /api/admin/videos` (raw body, `Content-Type: video/mp4`, `x-video-title`),
  `PATCH|DELETE /api/admin/videos/:id`, settings and menu endpoints.

## Setup
Local (sandbox): `npm run build && pm2 start ecosystem.config.cjs`. Local admin PIN is in `.dev.vars` (`ADMIN_PIN=4242`) — **change it**.

Before deploying:
```
npx wrangler r2 bucket create webapp-videos
npx wrangler pages secret put ADMIN_PIN
npx wrangler pages secret put SQUARE_ACCESS_TOKEN   # optional
npx wrangler pages secret put STRIPE_SECRET_KEY     # optional
```
Uploads are disabled unless `ADMIN_PIN` is set.

## Data
- Videos: Cloudflare R2 (persistent).
- Orders, menu edits, settings: **in memory** (reset on restart) — next step is moving them to D1.

## Not yet done / next steps
- Persist orders/menu/settings in D1.
- Stripe Tap to Pay on iPhone (native app needed).
- Video thumbnails/compression (users should compress to <95 MB first).

## Status
Not deployed. Tech: Hono + TypeScript on Cloudflare Pages, R2.
