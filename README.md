# Ara's DNA — Self-Serve Food Trailer Platform

Built so **one person can run the trailer**: customers order and pay by card on the kiosk or on their phone,
watch their order status live, and pick up when their name shows on the pickup screen. No front-window
service needed. The only staff screen is the kitchen display.

Menu: ice cream, Island Ice, sorbet, hot dogs, chili dogs, lemonade, cookies and brownies.

## Pages
| Path | Who | Purpose |
|---|---|---|
| `/` | Public | Homepage: menu, videos, visit info, "Order now" |
| `/order` | Customers (phone) | Online ordering, card only, then live tracking |
| `/kiosk` | Customers (trailer tablet) | Same ordering UI with idle video loop (attract mode) |
| `/track/:id` | Customers | Live order status page (the link is on the confirmation screen) |
| `/pickup` | Public TV/monitor | Big "Ready" and "Being made" board for pickup |
| `/kds` | **Staff (PIN)** | Kitchen display: start / ready / complete, pause ordering, sold-out toggles |
| `/admin` | **Owner (PIN)** | Orders, menu, videos, analytics, settings, refunds |

## One-person workflow
1. Put a tablet on `/kiosk` at the trailer (kiosk mode) and a TV on `/pickup`.
2. Print a QR code pointing to `/order` for customers who prefer their phone.
3. Keep `/kds` open on your own tablet (enter the PIN once, it is remembered on that device).
4. Tap **Start** when you begin an order and **Ready** when it is done. The customer's phone and the TV update by themselves.
5. Out of something? KDS → **Sold out** toggles it everywhere. Closing or slammed? KDS → **Taking orders** pauses all ordering.

## Safety and payment integrity
- Orders start as `pending_payment` and **never appear in the kitchen until payment is verified on the server**.
  - Stripe: server re-fetches the PaymentIntent (succeeded, amount matches, orderId matches).
  - Square: order only created after the charge returns `COMPLETED` with the matching amount; idempotency key prevents double charges.
  - Webhooks are never trusted from the body; they re-verify with the processor.
- **Cash / no-card orders are off.** The only way to place an order without a card is *Test mode* (Admin → Settings), off by default.
- Prices are always recalculated on the server. Unknown items, options and quantities are rejected.
- `/kds` and `/admin` require a PIN; 10 wrong attempts locks that IP for 15 minutes.
- Per-IP rate limits on checkout/confirm endpoints. Order ids are unguessable and public tracking hides payment data.
- Stale unpaid orders are purged automatically (lazy, no cron).

## Data and storage
- **Cloudflare D1** (`DB`): `orders`, `kv` (settings, menu, ticket counter), `rate_limits`. Schema auto-creates and is in `migrations/0001_init.sql`.
  If D1 is not bound the app falls back to memory (data lost on restart; `/api/health` shows `"database": false`).
- **Cloudflare R2** (`VIDEOS`): uploaded videos (MP4/WebM/MOV, max 95 MB each, Range streaming).
- No KV namespaces and no cron triggers (hosted-deploy compatible).

## Secrets / settings
| Name | Where | Needed |
|---|---|---|
| `ADMIN_PIN` | secret | **Required** (gates admin, uploads, and kitchen) |
| `KDS_PIN` | secret | Optional separate PIN for the kitchen screen |
| `STRIPE_SECRET_KEY` | secret | For Stripe card payments |
| `SQUARE_ACCESS_TOKEN` | secret | For Square card payments |
| Stripe publishable key, Square app id / location id | Admin → Settings | With the matching secret |

Local: `.dev.vars` has `ADMIN_PIN=4242` — **change it before going live.** Without a card processor configured,
customers see "Card payments aren't available" and cannot order (by design).

## Local development
```
npm run build && pm2 start ecosystem.config.cjs     # wrangler pages dev, local D1 in .wrangler/state
curl localhost:3000/api/health                       # {"ok":true,"database":true}
```
To try the flow without a card: Admin → Settings → turn on **Test mode**, then turn it off again.

## Before going live
```
npx wrangler d1 create webapp-production            # paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply webapp-production
npx wrangler r2 bucket create webapp-videos
npx wrangler pages secret put ADMIN_PIN
npx wrangler pages secret put STRIPE_SECRET_KEY      # and/or SQUARE_ACCESS_TOKEN
```
Then: Admin → Settings → enter Square/Stripe public keys, confirm Test mode is **off**, re-upload videos on the live site
(local sandbox videos do not carry over), and place one real small order to verify end to end.

## API (main)
- Public: `GET /api/menu`, `GET /api/pickup`, `GET /api/orders/:id`, `GET /api/videos`, `POST /api/payments/stripe-online`, `/stripe-confirm`, `/square-init`, `/square-charge`
- Kitchen (`x-admin-pin`): `GET /api/kds`, `PATCH /api/kds/:id/status`, `PATCH /api/kds/:id/priority`, `POST /api/kds/open`, `PATCH /api/kds/menu/:id` (`{available}`)
- Admin (`x-admin-pin`): `/api/admin/*` orders, refunds, menu, settings, videos, analytics

## Not done / next steps
- Stripe Tap to Pay on iPhone (needs a native app).
- SMS "your order is ready" text (needs an SMS provider such as Twilio).
- Video compression/thumbnails.

## Status
Not deployed. Hono + TypeScript on Cloudflare Pages with D1 and R2.
