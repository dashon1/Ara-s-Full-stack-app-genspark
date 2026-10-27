import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

// ─── Bindings ───────────────────────────────────────────────────────────────
// VIDEOS = R2 bucket for uploaded videos. ADMIN_PIN / *_SECRET / *_TOKEN = secrets.
type Bindings = {
  VIDEOS?: any
  ADMIN_PIN?: string
  STRIPE_SECRET_KEY?: string
  SQUARE_ACCESS_TOKEN?: string
}

// ─── In-Memory Store (KV-ready interface) ───────────────────────────────────
let orderSeq = 100
const orders: Order[] = []
const menuItems: MenuItem[] = getDefaultMenu()
const settings: AppSettings = {
  businessName: "Ara's DNA",
  taxRate: 0.08,
  // Stripe (for Tap to Pay later)
  stripeMode: false,
  stripePublishableKey: '',
  // Square (online card entry — use now)
  squareMode: false,
  squareAppId: '',
  squareLocationId: '',
  // General
  operatingHours: 'Call 813-522-3553',
  phone: '813-522-3553',
  tagline: 'Hand-Crafted Ice Cream · Island Ice · Hot Dogs',
  // Kiosk idle "attract" screen that loops the uploaded videos
  attractMode: true,
  attractIdleSeconds: 60,
}

// ─── Types ──────────────────────────────────────────────────────────────────
type OrderStatus = 'paid' | 'queued' | 'in_prep' | 'ready' | 'completed' | 'cancelled' | 'refunded'
type Channel = 'kiosk' | 'staff' | 'online'

interface OrderItem {
  id: string
  name: string
  price: number
  quantity: number
  modifiers: string[]
  notes: string
}

interface Order {
  id: string
  ticketNumber: number
  customerName: string
  channel: Channel
  items: OrderItem[]
  subtotal: number
  tax: number
  total: number
  status: OrderStatus
  paymentMethod: string
  paymentIntentId?: string
  createdAt: string
  updatedAt: string
  statusHistory: { status: string; at: string }[]
  notes: string
  priority: boolean
}

interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  category: string
  image: string
  available: boolean
  popular: boolean
  allergens: string[]
  modifiers: ModifierGroup[]
  prepTime: number
  calories?: number
}

interface ModifierGroup {
  name: string
  required: boolean
  multiple: boolean
  options: { name: string; price: number }[]
}

interface AppSettings {
  businessName: string
  taxRate: number
  // Stripe
  stripeMode: boolean
  stripePublishableKey: string
  // Square
  squareMode: boolean
  squareAppId: string
  squareLocationId: string
  // General
  operatingHours: string
  phone: string
  tagline: string
  attractMode: boolean
  attractIdleSeconds: number
}

// ─── Ara's DNA Menu ──────────────────────────────────────────────────────────
function getDefaultMenu(): MenuItem[] {
  return [

    // ── HOT DOGS ─────────────────────────────────────────────────────────────
    {
      id: 'hotdog-classic',
      name: "Ara's All Beef Signature Hotdog",
      description: 'All-beef hot dog plus condiments. Order two and save!',
      price: 500,
      category: 'Hot Dogs',
      image: '🌭',
      available: true,
      popular: true,
      allergens: ['gluten'],
      prepTime: 4,
      calories: 320,
      modifiers: [
        {
          name: 'How Many?',
          required: true,
          multiple: false,
          options: [
            { name: '1 Dog – $5.00', price: 0 },
            { name: '2 Dogs – $8.00 (save $2)', price: 300 },
          ]
        },
        {
          name: 'Condiments',
          required: false,
          multiple: true,
          options: [
            { name: 'Mustard', price: 0 },
            { name: 'Ketchup', price: 0 },
            { name: 'Relish', price: 0 },
            { name: 'Onions', price: 0 },
            { name: 'Sauerkraut', price: 0 },
          ]
        }
      ]
    },
    {
      id: 'hotdog-jumbo',
      name: "Ara's Jumbo Dog 1/4 Lb",
      description: "Big quarter-pound all-beef dog — Ara's signature jumbo size plus condiments.",
      price: 675,
      category: 'Hot Dogs',
      image: '🌭',
      available: true,
      popular: true,
      allergens: ['gluten'],
      prepTime: 5,
      calories: 480,
      modifiers: [
        {
          name: 'Condiments',
          required: false,
          multiple: true,
          options: [
            { name: 'Mustard', price: 0 },
            { name: 'Ketchup', price: 0 },
            { name: 'Relish', price: 0 },
            { name: 'Onions', price: 0 },
            { name: 'Sauerkraut', price: 0 },
          ]
        }
      ]
    },
    {
      id: 'chilidog',
      name: "Ara's Signature Chili Dog",
      description: "All-beef dog smothered in Ara's signature chili plus condiments. Get two and save!",
      price: 600,
      category: 'Hot Dogs',
      image: '🌭',
      available: true,
      popular: true,
      allergens: ['gluten'],
      prepTime: 5,
      calories: 420,
      modifiers: [
        {
          name: 'How Many?',
          required: true,
          multiple: false,
          options: [
            { name: '1 Chili Dog – $6.00', price: 0 },
            { name: '2 Chili Dogs – $10.50 (save $1.50)', price: 450 },
          ]
        },
        {
          name: 'Extra Toppings & Layer-Ins',
          required: false,
          multiple: true,
          options: [
            { name: 'Extra Chili +$3.00', price: 300 },
            { name: 'Extra Cheese +$3.00', price: 300 },
            { name: 'Onions', price: 0 },
            { name: 'Mustard', price: 0 },
          ]
        }
      ]
    },
    {
      id: 'beef-sausage',
      name: "Ara's Beef Smoked Sausage",
      description: "Ara's signature smoked beef sausage. Bold, smoky, and satisfying.",
      price: 700,
      category: 'Hot Dogs',
      image: '🥩',
      available: true,
      popular: false,
      allergens: ['gluten'],
      prepTime: 5,
      calories: 510,
      modifiers: [
        {
          name: 'How Many?',
          required: true,
          multiple: false,
          options: [
            { name: '1 Sausage – $7.00', price: 0 },
            { name: '2 Sausages – $12.50 (save $1.50)', price: 550 },
          ]
        }
      ]
    },

    // ── ICE CREAM ────────────────────────────────────────────────────────────
    {
      id: 'ice-cream',
      name: 'Hand-Crafted Old-Fashioned Ice Cream',
      description: 'Rich, creamy hand-crafted ice cream made the old-fashioned way. Pick your size and flavor.',
      price: 550,
      category: 'Ice Cream',
      image: '🍦',
      available: true,
      popular: true,
      allergens: ['dairy', 'eggs'],
      prepTime: 2,
      calories: 280,
      modifiers: [
        {
          name: 'Size',
          required: true,
          multiple: false,
          options: [
            { name: 'Kids 4 oz – $5.50', price: 0 },
            { name: 'Regular 8 oz – $7.50', price: 200 },
            { name: 'Large 12 oz – $10.75', price: 525 },
            { name: 'Pint – $12.75', price: 725 },
          ]
        },
        {
          name: 'Flavor',
          required: true,
          multiple: false,
          options: [
            { name: 'Vanilla', price: 0 },
            { name: 'Chocolate', price: 0 },
            { name: 'Strawberry', price: 0 },
            { name: 'Cookies & Cream', price: 0 },
            { name: 'Butter Pecan', price: 0 },
            { name: 'Neapolitan', price: 0 },
          ]
        },
        {
          name: 'Extra Toppings & Layer-Ins',
          required: false,
          multiple: true,
          options: [
            { name: 'Extra Toppings / Layer-Ins +$3.00', price: 300 },
          ]
        }
      ]
    },

    // ── ISLAND ICE (PREMIUM) ─────────────────────────────────────────────────
    {
      id: 'island-ice',
      name: 'Island Ice (Premium Italian Ice)',
      description: "Premium old-fashioned Italian Ice — smooth, bold flavors. Pair it with ice cream for the ultimate combo!",
      price: 450,
      category: 'Island Ice',
      image: '🧊',
      available: true,
      popular: true,
      allergens: [],
      prepTime: 2,
      calories: 160,
      modifiers: [
        {
          name: 'Size',
          required: true,
          multiple: false,
          options: [
            { name: 'Kids 4 oz – $4.50', price: 0 },
            { name: 'Regular 9 oz – $6.50', price: 200 },
            { name: 'Large 12 oz – $9.75', price: 525 },
            { name: 'Pint – $11.75', price: 725 },
          ]
        },
        {
          name: 'Flavor',
          required: true,
          multiple: false,
          options: [
            { name: 'Mango', price: 0 },
            { name: 'Strawberry', price: 0 },
            { name: 'Blue Raspberry', price: 0 },
            { name: 'Cherry', price: 0 },
            { name: 'Pineapple', price: 0 },
            { name: 'Watermelon', price: 0 },
            { name: 'Peach', price: 0 },
            { name: 'Lemon', price: 0 },
          ]
        },
        {
          name: 'Add Ice Cream Cream Layer?',
          required: false,
          multiple: false,
          options: [
            { name: 'Add Cream to Kids/Reg +$1.50', price: 150 },
            { name: 'Add Cream to Large +$2.00', price: 200 },
            { name: 'Add Cream to Pint +$2.50', price: 250 },
          ]
        }
      ]
    },

    // ── SORBET ───────────────────────────────────────────────────────────────
    {
      id: 'sorbet',
      name: 'Sorbet',
      description: 'Light, refreshing fruit sorbet — dairy-free and bursting with real fruit flavor.',
      price: 450,
      category: 'Island Ice',
      image: '🍧',
      available: true,
      popular: false,
      allergens: [],
      prepTime: 2,
      calories: 120,
      modifiers: [
        {
          name: 'Size',
          required: true,
          multiple: false,
          options: [
            { name: 'Kids 4 oz – $4.50', price: 0 },
            { name: 'Regular 9 oz – $6.50', price: 200 },
            { name: 'Large 12 oz – $9.75', price: 525 },
            { name: 'Pint – $11.75', price: 725 },
          ]
        },
        {
          name: 'Flavor',
          required: true,
          multiple: false,
          options: [
            { name: 'Mango', price: 0 },
            { name: 'Strawberry', price: 0 },
            { name: 'Raspberry', price: 0 },
            { name: 'Lemon', price: 0 },
            { name: 'Watermelon', price: 0 },
          ]
        }
      ]
    },

    // ── LEMONADE ─────────────────────────────────────────────────────────────
    {
      id: 'lemonade',
      name: 'Fresh Lemonade',
      description: 'Hand-crafted fresh-squeezed lemonade. Add a fruit flavor for +$1.50.',
      price: 450,
      category: 'Drinks',
      image: '🍋',
      available: true,
      popular: true,
      allergens: [],
      prepTime: 3,
      calories: 140,
      modifiers: [
        {
          name: 'Size',
          required: true,
          multiple: false,
          options: [
            { name: 'Small – $4.50', price: 0 },
            { name: 'Medium – $7.00', price: 250 },
            { name: 'Large – $10.00', price: 550 },
          ]
        },
        {
          name: 'Add a Flavor? (+$1.50)',
          required: false,
          multiple: false,
          options: [
            { name: 'Strawberry +$1.50', price: 150 },
            { name: 'Blueberry +$1.50', price: 150 },
            { name: 'Cherry +$1.50', price: 150 },
            { name: 'Mango +$1.50', price: 150 },
            { name: 'Peach +$1.50', price: 150 },
            { name: 'Raspberry +$1.50', price: 150 },
            { name: 'Watermelon +$1.50', price: 150 },
            { name: 'Pineapple +$1.50', price: 150 },
          ]
        }
      ]
    },
    {
      id: 'soda',
      name: 'Canned Soda',
      description: 'Ice-cold Coca-Cola, Sprite, and assorted cans.',
      price: 300,
      category: 'Drinks',
      image: '🥤',
      available: true,
      popular: false,
      allergens: [],
      prepTime: 0,
      calories: 150,
      modifiers: [
        {
          name: 'Choice',
          required: true,
          multiple: false,
          options: [
            { name: 'Coca-Cola', price: 0 },
            { name: 'Sprite', price: 0 },
            { name: 'Other Assorted', price: 0 },
          ]
        }
      ]
    },
    {
      id: 'water',
      name: 'Bottled Water',
      description: 'Cold purified bottled water.',
      price: 200,
      category: 'Drinks',
      image: '💧',
      available: true,
      popular: false,
      allergens: [],
      prepTime: 0,
      calories: 0,
      modifiers: []
    },

    // ── COOKIES ──────────────────────────────────────────────────────────────
    {
      id: 'cookies',
      name: 'Baked Cookies',
      description: "Ara's freshly baked cookies — soft, chewy, and homemade. Ask about today's flavors.",
      price: 499,
      category: 'Baked Goods',
      image: '🍪',
      available: true,
      popular: false,
      allergens: ['gluten', 'dairy', 'eggs'],
      prepTime: 1,
      calories: 220,
      modifiers: [
        {
          name: 'Flavor',
          required: true,
          multiple: false,
          options: [
            { name: 'Chocolate Chip', price: 0 },
            { name: 'Snickerdoodle', price: 0 },
            { name: 'Oatmeal Raisin', price: 0 },
            { name: "Ask Today's Special", price: 0 },
          ]
        }
      ]
    },

    // ── BROWNIES ─────────────────────────────────────────────────────────────
    {
      id: 'brownie',
      name: 'Fudge Brownie',
      description: "Ara's rich, fudgy homemade brownies — dense chocolate goodness baked fresh.",
      price: 499,
      category: 'Baked Goods',
      image: '🍫',
      available: true,
      popular: true,
      allergens: ['gluten', 'dairy', 'eggs'],
      prepTime: 1,
      calories: 380,
      modifiers: [
        {
          name: 'Add-On',
          required: false,
          multiple: false,
          options: [
            { name: 'Plain', price: 0 },
            { name: 'Warm with Ice Cream Scoop +$3.00', price: 300 },
          ]
        }
      ]
    },
  ]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10).toUpperCase()
}

function now() {
  return new Date().toISOString()
}

function calcOrder(items: OrderItem[], taxRate: number) {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0)
  const tax = Math.round(subtotal * taxRate)
  return { subtotal, tax, total: subtotal + tax }
}

// Strip characters that could be used for markup injection; trim + cap length.
function clean(v: unknown, max: number) {
  return String(v ?? '').replace(/[<>&"\u0000-\u001f]/g, '').trim().slice(0, max)
}

// Price of one unit = base price + every selected modifier option.
function unitPrice(m: MenuItem, mods: string[]) {
  let p = m.price
  for (const g of m.modifiers) for (const o of g.options) if (mods.includes(o.name)) p += o.price
  return p
}

// Validate a client cart against the real menu. The server is the source of
// truth for prices — never trust prices coming from the browser.
function buildItems(raw: any): { items: OrderItem[] } | { error: string } {
  if (!Array.isArray(raw) || !raw.length) return { error: 'Cart is empty' }
  if (raw.length > 50) return { error: 'Too many items in one order' }
  const items: OrderItem[] = []
  for (const ri of raw) {
    const m = menuItems.find(x => x.id === ri?.id)
    if (!m) return { error: `Unknown item ${String(ri?.id).slice(0, 40)}` }
    if (!m.available) return { error: `${m.name} is sold out` }
    const qty = Number(ri.quantity ?? 1)
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) return { error: 'Invalid quantity' }
    const mods: string[] = Array.isArray(ri.modifiers) ? ri.modifiers.map(String) : []
    const known = new Set(m.modifiers.flatMap(g => g.options.map(o => o.name)))
    if (mods.some(x => !known.has(x))) return { error: `Invalid option selected for ${m.name}` }
    for (const g of m.modifiers) {
      const picked = g.options.filter(o => mods.includes(o.name)).length
      if (g.required && picked < 1) return { error: `Please choose ${g.name} for ${m.name}` }
      if (!g.multiple && picked > 1) return { error: `Only one ${g.name} allowed for ${m.name}` }
    }
    items.push({ id: m.id, name: m.name, price: unitPrice(m, mods), quantity: qty, modifiers: mods, notes: clean(ri.notes, 200) })
  }
  return { items }
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

// ─── App ─────────────────────────────────────────────────────────────────────
const app = new Hono<{ Bindings: Bindings }>()
app.use('*', cors())

// Static assets (CSS, JS, fonts, webfonts)
app.use('/static/*', serveStatic({ root: './public' }))

// Admin PIN gate. If the ADMIN_PIN secret is set, every /api/admin/* call needs
// the matching x-admin-pin header. (If unset, admin stays open as before, but
// video uploads are refused — see the video routes.)
app.use('/api/admin/*', async (c, next) => {
  const pin = c.env?.ADMIN_PIN
  if (pin && !safeEqual(c.req.header('x-admin-pin') || '', pin)) {
    return c.json({ error: 'Admin PIN required' }, 401)
  }
  await next()
})
app.get('/api/admin/ping', (c) => c.json({
  ok: true,
  pinRequired: !!c.env?.ADMIN_PIN,
  uploads: !!c.env?.ADMIN_PIN && !!c.env?.VIDEOS,
  storage: !!c.env?.VIDEOS,
}))

// ══════════════════════════════════════════════════════════════════
// PUBLIC API — MENU
// ══════════════════════════════════════════════════════════════════
app.get('/api/menu', (c) => {
  const categories = [...new Set(menuItems.map(i => i.category))]
  return c.json({ menu: menuItems, categories, settings })
})

app.get('/api/menu/:id', (c) => {
  const item = menuItems.find(i => i.id === c.req.param('id'))
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json(item)
})

// ══════════════════════════════════════════════════════════════════
// PUBLIC API — ORDERS (kiosk checkout)
// ══════════════════════════════════════════════════════════════════
app.post('/api/orders', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const customerName = clean(body.customerName, 40) || 'Guest'
  const notes = clean(body.notes, 200)
  const channel: Channel = ['kiosk', 'staff', 'online'].includes(body.channel) ? body.channel : 'kiosk'
  const built = buildItems(body.items)
  if ('error' in built) return c.json({ error: built.error }, 400)
  const items = built.items

  const { subtotal, tax, total } = calcOrder(items, settings.taxRate)
  const order: Order = {
    id: uid(),
    ticketNumber: ++orderSeq,
    customerName,
    channel,
    items,
    subtotal,
    tax,
    total,
    status: 'paid',
    paymentMethod: 'demo',
    createdAt: now(),
    updatedAt: now(),
    statusHistory: [{ status: 'paid', at: now() }],
    notes,
    priority: false,
  }
  orders.unshift(order)
  return c.json({ order }, 201)
})

app.get('/api/orders/:id', (c) => {
  const o = orders.find(o => o.id === c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  return c.json(o)
})

// ══════════════════════════════════════════════════════════════════
// STRIPE TERMINAL ENDPOINTS
// ══════════════════════════════════════════════════════════════════
app.post('/api/connection_token', async (c) => {
  const STRIPE_KEY = (c.env as any)?.STRIPE_SECRET_KEY || ''
  if (!STRIPE_KEY) return c.json({ error: 'Stripe not configured' }, 400)
  const res = await fetch('https://api.stripe.com/v1/terminal/connection_tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  const data: any = await res.json()
  if (!res.ok) return c.json({ error: data.error?.message }, 400)
  return c.json({ secret: data.secret })
})

app.post('/api/payments/create-intent', async (c) => {
  const STRIPE_KEY = (c.env as any)?.STRIPE_SECRET_KEY || ''
  if (!STRIPE_KEY) return c.json({ error: 'Stripe not configured' }, 400)
  const body: any = await c.req.json().catch(() => ({}))
  const rawItems = body.items
  const customerName = clean(body.customerName, 40) || 'Guest'
  const notes = clean(body.notes, 200)

  const built = buildItems(rawItems)
  if ('error' in built) return c.json({ error: built.error }, 400)
  const items = built.items
  const { subtotal, tax, total } = calcOrder(items, settings.taxRate)

  const params = new URLSearchParams({
    amount: String(total),
    currency: 'usd',
    payment_method_types: 'card_present',
    capture_method: 'automatic',
    'metadata[customerName]': customerName,
    'metadata[itemCount]': String(items.length),
  })
  const res = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const data: any = await res.json()
  if (!res.ok) return c.json({ error: data.error?.message }, 400)

  // Pre-create draft order
  const order: Order = {
    id: uid(),
    ticketNumber: ++orderSeq,
    customerName,
    channel: 'kiosk',
    items,
    subtotal,
    tax,
    total,
    status: 'paid',
    paymentMethod: 'stripe_terminal',
    paymentIntentId: data.id,
    createdAt: now(),
    updatedAt: now(),
    statusHistory: [{ status: 'paid', at: now() }],
    notes,
    priority: false,
  }
  orders.unshift(order)

  return c.json({ clientSecret: data.client_secret, orderId: order.id, total })
})

app.post('/api/webhooks/stripe', async (c) => {
  const body = await c.req.json()
  const { type, data } = body
  if (type === 'payment_intent.succeeded') {
    const pi = data.object
    const order = orders.find(o => o.paymentIntentId === pi.id)
    if (order && order.status === 'paid') {
      order.status = 'queued'
      order.updatedAt = now()
      order.statusHistory.push({ status: 'queued', at: now() })
    }
  }
  return c.json({ received: true })
})

// ══════════════════════════════════════════════════════════════════
// STRIPE ONLINE (card-not-present / screen entry)
// ══════════════════════════════════════════════════════════════════
app.post('/api/payments/stripe-online', async (c) => {
  const STRIPE_KEY = (c.env as any)?.STRIPE_SECRET_KEY || ''
  if (!STRIPE_KEY) return c.json({ error: 'Stripe not configured' }, 400)
  const body: any = await c.req.json().catch(() => ({}))
  const rawItems = body.items
  const customerName = clean(body.customerName, 40) || 'Guest'
  const notes = clean(body.notes, 200)

  const built = buildItems(rawItems)
  if ('error' in built) return c.json({ error: built.error }, 400)
  const items = built.items
  const { subtotal, tax, total } = calcOrder(items, settings.taxRate)

  // Create a PaymentIntent for online card entry
  const params = new URLSearchParams({
    amount: String(total),
    currency: 'usd',
    'payment_method_types[]': 'card',
    'metadata[customerName]': customerName,
    'metadata[source]': 'kiosk_online',
  })
  const res = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const data: any = await res.json()
  if (!res.ok) return c.json({ error: data.error?.message }, 400)

  // Pre-create the order (confirmed when webhook fires)
  const order: Order = {
    id: uid(), ticketNumber: ++orderSeq, customerName, channel: 'kiosk',
    items, subtotal, tax, total,
    status: 'paid', paymentMethod: 'stripe_online',
    paymentIntentId: data.id,
    createdAt: now(), updatedAt: now(),
    statusHistory: [{ status: 'paid', at: now() }],
    notes, priority: false,
  }
  orders.unshift(order)
  return c.json({ clientSecret: data.client_secret, orderId: order.id, total, publishableKey: settings.stripePublishableKey })
})

// ══════════════════════════════════════════════════════════════════
// SQUARE ONLINE (Web Payments SDK — card entry on screen)
// ══════════════════════════════════════════════════════════════════

// Step 1: Client requests payment token info
app.post('/api/payments/square-init', async (c) => {
  if (!settings.squareMode || !settings.squareAppId || !settings.squareLocationId) {
    return c.json({ error: 'Square not configured' }, 400)
  }
  const body: any = await c.req.json().catch(() => ({}))
  const rawItems = body.items
  const built = buildItems(rawItems)
  if ('error' in built) return c.json({ error: built.error }, 400)
  const items = built.items
  const { subtotal, tax, total } = calcOrder(items, settings.taxRate)
  // Return config needed by Square Web Payments SDK on the frontend
  return c.json({
    appId: settings.squareAppId,
    locationId: settings.squareLocationId,
    total,
    subtotal,
    tax,
  })
})

// Step 2: Client tokenized the card — server creates the Square payment
app.post('/api/payments/square-charge', async (c) => {
  const SQUARE_TOKEN = (c.env as any)?.SQUARE_ACCESS_TOKEN || ''
  if (!SQUARE_TOKEN) return c.json({ error: 'Square access token not configured on server' }, 400)
  const body: any = await c.req.json().catch(() => ({}))
  const { sourceId } = body
  if (!sourceId || typeof sourceId !== 'string') return c.json({ error: 'Missing card token' }, 400)
  const rawItems = body.items
  const customerName = clean(body.customerName, 40) || 'Guest'
  const notes = clean(body.notes, 200)

  const built = buildItems(rawItems)
  if ('error' in built) return c.json({ error: built.error }, 400)
  const items = built.items
  const { subtotal, tax, total } = calcOrder(items, settings.taxRate)

  // Call Square Payments API
  const idempotencyKey = uid() + '-' + Date.now()
  const sqHost = settings.squareAppId.startsWith('sandbox-')
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com'
  const squareRes = await fetch(`${sqHost}/v2/payments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SQUARE_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18',
    },
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      source_id: sourceId,
      amount_money: { amount: total, currency: 'USD' },
      location_id: settings.squareLocationId,
      note: `Ara's DNA Kiosk — ${customerName}`,
    }),
  })
  const squareData: any = await squareRes.json()
  if (!squareRes.ok || squareData.errors) {
    const msg = squareData.errors?.[0]?.detail || 'Square payment failed'
    return c.json({ error: msg }, 400)
  }

  const squarePaymentId = squareData.payment?.id
  const order: Order = {
    id: uid(), ticketNumber: ++orderSeq, customerName, channel: 'kiosk',
    items, subtotal, tax, total,
    status: 'paid', paymentMethod: 'square_online',
    paymentIntentId: squarePaymentId,
    createdAt: now(), updatedAt: now(),
    statusHistory: [{ status: 'paid', at: now() }],
    notes, priority: false,
  }
  orders.unshift(order)
  return c.json({ order, squarePaymentId })
})

// Square webhook (payment.completed events)
app.post('/api/webhooks/square', async (c) => {
  const body = await c.req.json()
  if (body.type === 'payment.completed') {
    const sqId = body.data?.object?.payment?.id
    const order = orders.find(o => o.paymentIntentId === sqId)
    if (order) {
      order.status = 'queued'
      order.updatedAt = now()
      order.statusHistory.push({ status: 'queued', at: now() })
    }
  }
  return c.json({ ok: true })
})

// ══════════════════════════════════════════════════════════════════
// KITCHEN DISPLAY (KDS)
// ══════════════════════════════════════════════════════════════════
app.get('/api/kds', (c) => {
  const active = orders.filter(o => ['paid', 'queued', 'in_prep', 'ready'].includes(o.status))
  return c.json({ orders: active })
})

app.patch('/api/kds/:id/status', async (c) => {
  const o = orders.find(o => o.id === c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  const { status } = await c.req.json()
  const allowed: OrderStatus[] = ['queued', 'in_prep', 'ready', 'completed']
  if (!allowed.includes(status as OrderStatus)) return c.json({ error: 'Invalid status' }, 400)
  o.status = status as OrderStatus
  o.updatedAt = now()
  o.statusHistory.push({ status, at: now() })
  return c.json(o)
})

// ══════════════════════════════════════════════════════════════════
// ADMIN API
// ══════════════════════════════════════════════════════════════════
app.get('/api/admin/orders', (c) => {
  const status = c.req.query('status')
  const channel = c.req.query('channel')
  let result = [...orders]
  if (status) result = result.filter(o => o.status === status)
  if (channel) result = result.filter(o => o.channel === channel)
  return c.json({ orders: result, total: result.length })
})

app.patch('/api/admin/orders/:id/status', async (c) => {
  const o = orders.find(o => o.id === c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  const { status } = await c.req.json()
  o.status = status as OrderStatus
  o.updatedAt = now()
  o.statusHistory.push({ status, at: now() })
  return c.json(o)
})

app.patch('/api/admin/orders/:id/priority', async (c) => {
  const o = orders.find(o => o.id === c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  const { priority } = await c.req.json()
  o.priority = priority
  o.updatedAt = now()
  return c.json(o)
})

app.post('/api/admin/orders/:id/refund', async (c) => {
  const o = orders.find(o => o.id === c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  o.status = 'refunded'
  o.updatedAt = now()
  o.statusHistory.push({ status: 'refunded', at: now() })
  return c.json(o)
})

// Admin — Menu Management
app.get('/api/admin/menu', (c) => c.json({ menu: menuItems }))

app.patch('/api/admin/menu/:id', async (c) => {
  const item = menuItems.find(i => i.id === c.req.param('id'))
  if (!item) return c.json({ error: 'Not found' }, 404)
  const body: any = await c.req.json().catch(() => ({}))
  if (typeof body.name === 'string') item.name = clean(body.name, 80) || item.name
  if (typeof body.description === 'string') item.description = clean(body.description, 300)
  if (typeof body.image === 'string') item.image = body.image.slice(0, 8)
  if (typeof body.category === 'string') item.category = clean(body.category, 40) || item.category
  if (Number.isInteger(body.price) && body.price >= 0 && body.price < 100000) item.price = body.price
  if (typeof body.available === 'boolean') item.available = body.available
  if (typeof body.popular === 'boolean') item.popular = body.popular
  if (Number.isFinite(body.prepTime)) item.prepTime = Math.max(0, Math.min(120, Math.round(body.prepTime)))
  if (body.calories === null || Number.isFinite(body.calories)) item.calories = body.calories ?? undefined
  return c.json(item)
})

app.post('/api/admin/menu', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  if (!clean(body.name, 80)) return c.json({ error: 'Name is required' }, 400)
  const item: MenuItem = {
    id: String(body.name || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) + '-' + uid().slice(0, 4).toLowerCase(),
    name: clean(body.name, 80),
    description: clean(body.description, 300),
    price: Number.isInteger(body.price) && body.price >= 0 ? body.price : 0,
    category: clean(body.category, 40) || 'Other',
    image: String(body.image || '🍽️').slice(0, 8),
    available: true,
    popular: false,
    allergens: body.allergens || [],
    modifiers: body.modifiers || [],
    prepTime: body.prepTime || 5,
    calories: body.calories,
  }
  menuItems.push(item)
  return c.json(item, 201)
})

// Admin — Analytics
app.get('/api/admin/analytics', (c) => {
  const completed = orders.filter(o => ['completed', 'ready'].includes(o.status))
  const allPaid = orders.filter(o => o.status !== 'cancelled' && o.status !== 'refunded')
  const revenue = allPaid.reduce((s, o) => s + o.total, 0)
  const itemFreq: Record<string, number> = {}
  allPaid.forEach(o => o.items.forEach(i => {
    itemFreq[i.name] = (itemFreq[i.name] || 0) + i.quantity
  }))
  const topItems = Object.entries(itemFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }))
  const byHour: Record<string, number> = {}
  allPaid.forEach(o => {
    const h = new Date(o.createdAt).getHours()
    const label = `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`
    byHour[label] = (byHour[label] || 0) + o.total
  })
  return c.json({
    totalOrders: allPaid.length,
    revenue,
    avgOrderValue: allPaid.length ? Math.round(revenue / allPaid.length) : 0,
    completedOrders: completed.length,
    refundedOrders: orders.filter(o => o.status === 'refunded').length,
    topItems,
    byHour,
    byChannel: {
      kiosk: allPaid.filter(o => o.channel === 'kiosk').length,
      staff: allPaid.filter(o => o.channel === 'staff').length,
      online: allPaid.filter(o => o.channel === 'online').length,
    }
  })
})

// Admin — Settings
app.get('/api/admin/settings', (c) => c.json(settings))
app.patch('/api/admin/settings', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const types: Record<string, string> = {
    businessName: 'string', tagline: 'string', operatingHours: 'string', phone: 'string',
    taxRate: 'number', stripeMode: 'boolean', stripePublishableKey: 'string',
    squareMode: 'boolean', squareAppId: 'string', squareLocationId: 'string',
    attractMode: 'boolean', attractIdleSeconds: 'number',
  }
  for (const [k, t] of Object.entries(types)) {
    const v = body[k]
    if (typeof v !== t) continue
    if (t === 'number' && !Number.isFinite(v)) continue
    if (t === 'string') (settings as any)[k] = clean(v, 120)
    else if (k === 'taxRate') settings.taxRate = Math.min(Math.max(v, 0), 0.5)
    else if (k === 'attractIdleSeconds') settings.attractIdleSeconds = Math.min(Math.max(Math.round(v), 15), 600)
    else (settings as any)[k] = v
  }
  return c.json(settings)
})

// Admin — Seed demo orders
app.post('/api/admin/seed', (c) => {
  const names = ['Alex', 'Jordan', 'Sam', 'Casey', 'Riley', 'Morgan', 'Drew', 'Jamie']
  const statuses: OrderStatus[] = ['paid', 'queued', 'in_prep', 'ready', 'completed']
  const combos = [
    [{ id: 'hotdog-classic', mod: '1 Dog – $5.00' }, { id: 'island-ice', mod: 'Regular 9 oz – $6.50' }],
    [{ id: 'chilidog', mod: '1 Chili Dog – $6.00' }, { id: 'lemonade', mod: 'Small – $4.50' }],
    [{ id: 'hotdog-jumbo', mod: '' }, { id: 'ice-cream', mod: 'Regular 8 oz – $7.50' }],
    [{ id: 'beef-sausage', mod: '1 Sausage – $7.00' }, { id: 'sorbet', mod: 'Regular 9 oz – $6.50' }],
    [{ id: 'chilidog', mod: '2 Chili Dogs – $10.50 (save $1.50)' }, { id: 'soda', mod: 'Coca-Cola' }],
    [{ id: 'ice-cream', mod: 'Kids 4 oz – $5.50' }, { id: 'cookies', mod: 'Chocolate Chip' }],
    [{ id: 'lemonade', mod: 'Large – $10.00' }, { id: 'island-ice', mod: 'Large 12 oz – $9.75' }],
    [{ id: 'hotdog-classic', mod: '2 Dogs – $8.00 (save $2)' }, { id: 'lemonade', mod: 'Medium – $7.00' }],
  ]
  for (let i = 0; i < 8; i++) {
    const combo = combos[i]
    const items: OrderItem[] = combo.map(c => {
      const m = menuItems.find(mi => mi.id === c.id)!
      const mods = c.mod ? [c.mod] : []
      return { id: m.id, name: m.name, price: unitPrice(m, mods), quantity: 1, modifiers: mods, notes: '' }
    })
    const { subtotal, tax, total } = calcOrder(items, settings.taxRate)
    const status = statuses[Math.floor(Math.random() * statuses.length)]
    orders.unshift({
      id: uid(),
      ticketNumber: ++orderSeq,
      customerName: names[i % names.length],
      channel: 'kiosk',
      items,
      subtotal, tax, total,
      status,
      paymentMethod: 'demo',
      createdAt: new Date(Date.now() - Math.random() * 3600000).toISOString(),
      updatedAt: now(),
      statusHistory: [{ status, at: now() }],
      notes: '',
      priority: Math.random() > 0.8,
    })
  }
  return c.json({ seeded: 8 })
})

// ══════════════════════════════════════════════════════════════════
// VIDEOS (stored in Cloudflare R2 — binding "VIDEOS")
// ══════════════════════════════════════════════════════════════════
const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
}
const MAX_VIDEO_BYTES = 95 * 1024 * 1024 // Workers request-body cap is 100 MB

// Public: list videos (newest first)
app.get('/api/videos', async (c) => {
  const bucket = c.env?.VIDEOS
  if (!bucket) return c.json({ videos: [], storage: false })
  const listed = await bucket.list({ prefix: 'videos/', include: ['customMetadata'] })
  const videos = listed.objects
    .map((o: any) => ({
      id: o.key.replace('videos/', ''),
      url: `/api/videos/${encodeURIComponent(o.key.replace('videos/', ''))}`,
      title: o.customMetadata?.title || 'Untitled',
      featured: o.customMetadata?.featured === '1',
      size: o.size,
      uploadedAt: o.uploaded,
    }))
    .sort((a: any, b: any) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))
  return c.json({ videos, storage: true })
})

// Public: stream a video. Supports HTTP Range so players can seek and iOS Safari works.
app.get('/api/videos/:id', async (c) => {
  const bucket = c.env?.VIDEOS
  if (!bucket) return c.json({ error: 'Video storage not configured' }, 503)
  const id = c.req.param('id')
  if (!/^[A-Za-z0-9_-]+\.(mp4|webm|mov)$/.test(id)) return c.json({ error: 'Not found' }, 404)
  const key = `videos/${id}`
  const head = await bucket.head(key)
  if (!head) return c.json({ error: 'Not found' }, 404)

  const size: number = head.size
  const type = head.httpMetadata?.contentType || 'video/mp4'
  const base: Record<string, string> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  }

  const range = c.req.header('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!m || (m[1] === '' && m[2] === '')) {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })
    }
    let start: number, end: number
    if (m[1] === '') { // suffix range: last N bytes
      const n = Math.min(parseInt(m[2], 10), size)
      start = size - n; end = size - 1
    } else {
      start = parseInt(m[1], 10)
      end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1)
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })
    }
    const obj = await bucket.get(key, { range: { offset: start, length: end - start + 1 } })
    if (!obj) return c.json({ error: 'Not found' }, 404)
    return new Response(obj.body, {
      status: 206,
      headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    })
  }

  const obj = await bucket.get(key)
  if (!obj) return c.json({ error: 'Not found' }, 404)
  return new Response(obj.body, { headers: { ...base, 'Content-Length': String(size) } })
})

// Admin: upload. Body = the raw video file; metadata in headers so we can stream
// straight into R2 without buffering. Requires ADMIN_PIN to be configured.
app.post('/api/admin/videos', async (c) => {
  const bucket = c.env?.VIDEOS
  if (!bucket) return c.json({ error: 'Video storage (R2) is not configured' }, 503)
  if (!c.env?.ADMIN_PIN) {
    return c.json({ error: 'Set the ADMIN_PIN secret before enabling uploads' }, 403)
  }
  const type = (c.req.header('content-type') || '').split(';')[0].trim().toLowerCase()
  const ext = VIDEO_TYPES[type]
  if (!ext) return c.json({ error: 'Only MP4, WebM or MOV videos are allowed' }, 415)
  const len = parseInt(c.req.header('content-length') || '', 10)
  if (!Number.isFinite(len) || len <= 0) return c.json({ error: 'Missing file size' }, 411)
  if (len > MAX_VIDEO_BYTES) {
    return c.json({ error: `File too large. Max ${Math.floor(MAX_VIDEO_BYTES / 1048576)} MB per video — compress it first.` }, 413)
  }
  if (!c.req.raw.body) return c.json({ error: 'Empty upload' }, 400)

  let title = 'Untitled'
  try { title = clean(decodeURIComponent(c.req.header('x-video-title') || ''), 80) || 'Untitled' } catch {}
  const id = `${Date.now().toString(36)}${uid().toLowerCase()}.${ext}`
  await bucket.put(`videos/${id}`, c.req.raw.body, {
    httpMetadata: { contentType: type },
    customMetadata: { title, featured: '0' },
  })
  return c.json({ ok: true, id, title }, 201)
})

// Admin: rename / feature
app.patch('/api/admin/videos/:id', async (c) => {
  const bucket = c.env?.VIDEOS
  if (!bucket) return c.json({ error: 'Video storage not configured' }, 503)
  const id = c.req.param('id')
  if (!/^[A-Za-z0-9_-]+\.(mp4|webm|mov)$/.test(id)) return c.json({ error: 'Not found' }, 404)
  const key = `videos/${id}`
  const head = await bucket.head(key)
  if (!head) return c.json({ error: 'Not found' }, 404)
  const body: any = await c.req.json().catch(() => ({}))
  // R2 can't edit metadata in place, so copy the object onto itself with new metadata.
  const obj = await bucket.get(key)
  if (!obj) return c.json({ error: 'Not found' }, 404)
  const meta = { ...(head.customMetadata || {}) }
  if (typeof body.title === 'string') meta.title = clean(body.title, 80) || 'Untitled'
  if (typeof body.featured === 'boolean') meta.featured = body.featured ? '1' : '0'
  await bucket.put(key, obj.body, { httpMetadata: head.httpMetadata, customMetadata: meta })
  return c.json({ ok: true })
})

// Admin: delete
app.delete('/api/admin/videos/:id', async (c) => {
  const bucket = c.env?.VIDEOS
  if (!bucket) return c.json({ error: 'Video storage not configured' }, 503)
  const id = c.req.param('id')
  if (!/^[A-Za-z0-9_-]+\.(mp4|webm|mov)$/.test(id)) return c.json({ error: 'Not found' }, 404)
  await bucket.delete(`videos/${id}`)
  return c.json({ ok: true })
})

// Health
app.get('/favicon.ico', (c) => {
  c.header('Content-Type', 'image/svg+xml')
  c.header('Cache-Control', 'public, max-age=86400')
  return c.body('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🍦</text></svg>')
})

app.get('/api/health', (c) => c.json({ ok: true, orders: orders.length, menu: menuItems.length }))

// ══════════════════════════════════════════════════════════════════
// PAGE ROUTES — serve HTML shells
// ══════════════════════════════════════════════════════════════════
app.get('/', (c) => c.html(homeHTML()))
app.get('/kiosk', (c) => c.html(kioskHTML()))
app.get('/kds', (c) => c.html(kdsHTML()))
app.get('/admin', (c) => c.html(adminHTML()))
app.get('/admin/*', (c) => c.html(adminHTML()))

// ══════════════════════════════════════════════════════════════════
// HTML PAGE GENERATORS
// ══════════════════════════════════════════════════════════════════
function homeHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ara's DNA — Ice Cream, Island Ice &amp; Hot Dogs</title>
  <meta name="description" content="Hand-crafted ice cream, premium Island Ice, all-beef hot dogs and fresh lemonade from the Ara's DNA food trailer." />
  <link rel="stylesheet" href="/static/fa.min.css"/>
  <link rel="stylesheet" href="/static/home.css"/>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div id="app"></div>
  <script src="/static/home.js"></script>
</body>
</html>`
}

function kioskHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>Ara's DNA — Order</title>
  <link rel="stylesheet" href="/static/fa.min.css"/>
  <link rel="stylesheet" href="/static/kiosk.css"/>
</head>
<body>
  <div id="app"></div>
  <script src="/static/kiosk.js"></script>
</body>
</html>`
}

function kdsHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kitchen Display</title>
  <script src="/static/tailwind.min.js"></script>
  <link rel="stylesheet" href="/static/fa.min.css"/>
  <link rel="stylesheet" href="/static/kds.css"/>
</head>
<body class="bg-gray-950 text-white min-h-screen">
  <div id="app"></div>
  <script src="/static/kds.js"></script>
</body>
</html>`
}

function adminHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin Dashboard</title>
  <script src="/static/tailwind.min.js"></script>
  <script src="/static/chart.min.js"></script>
  <link rel="stylesheet" href="/static/fa.min.css"/>
  <link rel="stylesheet" href="/static/admin.css"/>
</head>
<body class="bg-gray-950 text-white min-h-screen">
  <div id="app"></div>
  <script src="/static/admin.js"></script>
</body>
</html>`
}

export default app
