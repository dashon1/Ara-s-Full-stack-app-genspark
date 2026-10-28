import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

// ─── Bindings ───────────────────────────────────────────────────────────────
// DB = D1 database (orders, settings, menu). VIDEOS = R2 bucket for uploaded videos.
// ADMIN_PIN / KDS_PIN / STRIPE_SECRET_KEY / SQUARE_ACCESS_TOKEN = secrets.
type Bindings = {
  DB?: any
  VIDEOS?: any
  ADMIN_PIN?: string
  KDS_PIN?: string
  STRIPE_SECRET_KEY?: string
  SQUARE_ACCESS_TOKEN?: string
}

// ─── Types ──────────────────────────────────────────────────────────────────
type OrderStatus = 'pending_payment' | 'paid' | 'queued' | 'in_prep' | 'ready' | 'completed' | 'cancelled' | 'refunded'
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
  // Self-serve operation
  ordersOpen: boolean
  closedMessage: string
  pickupInstructions: string
  allowDemoOrders: boolean   // TEST MODE: lets orders through without card payment
  timezone: string
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
// Unguessable id for orders (they're used in public tracking links)
function oid() {
  const a = new Uint8Array(10)
  crypto.getRandomValues(a)
  return Array.from(a, b => (b % 36).toString(36)).join('').toUpperCase()
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
function buildItems(raw: any, menuItems: MenuItem[]): { items: OrderItem[] } | { error: string } {
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

// ─── Storage ─────────────────────────────────────────────────────────────────
// Cloudflare D1 when the `DB` binding exists (production + `wrangler --d1`).
// Falls back to in-memory so a bare `wrangler pages dev` still works (data is
// lost on restart and NOT shared between isolates — fine for a quick preview).
const PAID_STATES: OrderStatus[] = ['paid', 'queued', 'in_prep', 'ready', 'completed']
const ACTIVE_STATES: OrderStatus[] = ['paid', 'queued', 'in_prep', 'ready']
const ALL_STATES: OrderStatus[] = ['pending_payment', 'paid', 'queued', 'in_prep', 'ready', 'completed', 'cancelled', 'refunded']

function defaultSettings(): AppSettings {
  return {
    businessName: "Ara's DNA",
    taxRate: 0.08,
    stripeMode: false,
    stripePublishableKey: '',
    squareMode: false,
    squareAppId: '',
    squareLocationId: '',
    operatingHours: 'Call 813-522-3553',
    phone: '813-522-3553',
    tagline: 'Hand-Crafted Ice Cream · Island Ice · Hot Dogs',
    attractMode: true,
    attractIdleSeconds: 60,
    ordersOpen: true,
    closedMessage: "We're not taking orders right now. Please check back soon!",
    pickupInstructions: 'Grab your order from the pickup shelf. Enjoy!',
    allowDemoOrders: false,
    timezone: 'America/New_York',
  }
}

const mem = {
  orders: [] as Order[],
  kv: new Map<string, string>(),
  seq: 100,
  rl: new Map<string, { n: number; t: number }>(),
}
let schemaReady = false

async function ensureSchema(db: any) {
  if (schemaReady) return
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, ticket INTEGER NOT NULL, status TEXT NOT NULL, payment_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (k TEXT PRIMARY KEY, n INTEGER NOT NULL, t INTEGER NOT NULL)`),
  ])
  schemaReady = true
}

function makeStore(env: Bindings | undefined) {
  const db = env?.DB
  let settingsCache: AppSettings | null = null
  let menuCache: MenuItem[] | null = null

  const kvGet = async (k: string): Promise<string | null> => {
    if (!db) return mem.kv.get(k) ?? null
    const r = await db.prepare('SELECT value FROM kv WHERE key = ?').bind(k).first()
    return r ? (r.value as string) : null
  }
  const kvSet = async (k: string, v: string) => {
    if (!db) { mem.kv.set(k, v); return }
    await db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v).run()
  }

  return {
    persistent: !!db,
    async init() { if (db) await ensureSchema(db) },

    async getSettings(): Promise<AppSettings> {
      if (settingsCache) return settingsCache
      let saved: any = {}
      try { saved = JSON.parse((await kvGet('settings')) || '{}') } catch { /* ignore */ }
      settingsCache = { ...defaultSettings(), ...saved }
      return settingsCache!
    },
    async saveSettings(s: AppSettings) { settingsCache = s; await kvSet('settings', JSON.stringify(s)) },

    async getMenu(): Promise<MenuItem[]> {
      if (menuCache) return menuCache
      let saved: MenuItem[] | null = null
      try { const raw = await kvGet('menu'); if (raw) saved = JSON.parse(raw) } catch { /* ignore */ }
      menuCache = saved && Array.isArray(saved) && saved.length ? saved : getDefaultMenu()
      return menuCache
    },
    async saveMenu(m: MenuItem[]) { menuCache = m; await kvSet('menu', JSON.stringify(m)) },

    // Atomic ticket counter
    async nextTicket(): Promise<number> {
      if (!db) return ++mem.seq
      const r = await db.prepare(
        `INSERT INTO kv(key, value) VALUES('seq', '101') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 RETURNING value`
      ).first()
      return Number(r.value)
    },

    async putOrder(o: Order) {
      if (!db) {
        const i = mem.orders.findIndex(x => x.id === o.id)
        if (i >= 0) mem.orders[i] = o; else mem.orders.unshift(o)
        return
      }
      await db.prepare(
        `INSERT INTO orders(id, ticket, status, payment_id, created_at, updated_at, data) VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, payment_id = excluded.payment_id, updated_at = excluded.updated_at, data = excluded.data`
      ).bind(o.id, o.ticketNumber, o.status, o.paymentIntentId || null, o.createdAt, o.updatedAt, JSON.stringify(o)).run()
    },
    async getOrder(id: string): Promise<Order | null> {
      if (!db) return mem.orders.find(o => o.id === id) || null
      const r = await db.prepare('SELECT data FROM orders WHERE id = ?').bind(id).first()
      return r ? JSON.parse(r.data) : null
    },
    async findByPayment(pid: string): Promise<Order | null> {
      if (!pid) return null
      if (!db) return mem.orders.find(o => o.paymentIntentId === pid) || null
      const r = await db.prepare('SELECT data FROM orders WHERE payment_id = ?').bind(pid).first()
      return r ? JSON.parse(r.data) : null
    },
    async listOrders(opts: { statuses?: OrderStatus[]; limit?: number } = {}): Promise<Order[]> {
      const limit = opts.limit ?? 500
      const st = opts.statuses
      if (!db) {
        const r = st ? mem.orders.filter(o => st.includes(o.status)) : [...mem.orders]
        return r.slice(0, limit)
      }
      const where = st && st.length ? `WHERE status IN (${st.map(() => '?').join(',')})` : ''
      const { results } = await db.prepare(`SELECT data FROM orders ${where} ORDER BY created_at DESC LIMIT ?`).bind(...(st || []), limit).all()
      return results.map((r: any) => JSON.parse(r.data))
    },
    // Abandoned checkouts (customer closed the page before paying) are just noise.
    async purgeStale() {
      const cutoff = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      if (!db) { mem.orders = mem.orders.filter(o => !(o.status === 'pending_payment' && o.createdAt < cutoff)); return }
      await db.prepare(`DELETE FROM orders WHERE status = 'pending_payment' AND created_at < ?`).bind(cutoff).run()
    },

    // Fixed-window counter. Returns the count INCLUDING this hit.
    async rlHit(key: string, windowSec: number): Promise<number> {
      const t = Math.floor(Date.now() / 1000)
      if (!db) {
        const e = mem.rl.get(key)
        if (!e || t - e.t > windowSec) { mem.rl.set(key, { n: 1, t }); return 1 }
        e.n++; return e.n
      }
      const r = await db.prepare(
        `INSERT INTO rate_limits(k, n, t) VALUES(?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET
           n = CASE WHEN ?2 - t > ?3 THEN 1 ELSE n + 1 END,
           t = CASE WHEN ?2 - t > ?3 THEN ?2 ELSE t END RETURNING n`
      ).bind(key, t, windowSec).first()
      return Number(r.n)
    },
    async rlPeek(key: string, windowSec: number): Promise<number> {
      const t = Math.floor(Date.now() / 1000)
      if (!db) { const e = mem.rl.get(key); return e && t - e.t <= windowSec ? e.n : 0 }
      const r = await db.prepare('SELECT n, t FROM rate_limits WHERE k = ?').bind(key).first()
      return r && t - r.t <= windowSec ? Number(r.n) : 0
    },
  }
}
type Store = ReturnType<typeof makeStore>
type Env = { Bindings: Bindings; Variables: { store: Store } }

// What a customer is allowed to see about an order (no payment ids, no notes).
function publicOrder(o: Order) {
  return {
    id: o.id, ticketNumber: o.ticketNumber, customerName: o.customerName, channel: o.channel,
    items: o.items.map(i => ({ name: i.name, quantity: i.quantity, modifiers: i.modifiers, price: i.price })),
    subtotal: o.subtotal, tax: o.tax, total: o.total,
    status: o.status, createdAt: o.createdAt, updatedAt: o.updatedAt,
  }
}
const firstName = (n: string) => (n && n !== 'Guest' ? n.split(/\s+/)[0].slice(0, 14) : '')

function setStatus(o: Order, status: OrderStatus) {
  o.status = status
  o.updatedAt = now()
  o.statusHistory.push({ status, at: o.updatedAt })
}

async function newOrder(store: Store, settings: AppSettings, p: {
  customerName: string; channel: Channel; items: OrderItem[]; notes: string
  status: OrderStatus; paymentMethod: string; paymentIntentId?: string
}): Promise<Order> {
  const { subtotal, tax, total } = calcOrder(p.items, settings.taxRate)
  const t = now()
  const order: Order = {
    id: oid(), ticketNumber: await store.nextTicket(), customerName: p.customerName, channel: p.channel,
    items: p.items, subtotal, tax, total, status: p.status, paymentMethod: p.paymentMethod,
    paymentIntentId: p.paymentIntentId, createdAt: t, updatedAt: t,
    statusHistory: [{ status: p.status, at: t }], notes: p.notes, priority: false,
  }
  await store.putOrder(order)
  return order
}

// Payment confirmed -> the order finally appears on the kitchen screen.
async function markPaid(store: Store, o: Order) {
  if (o.status !== 'pending_payment') return o
  setStatus(o, 'paid')
  await store.putOrder(o)
  return o
}

function clientIp(c: any) {
  const h = (n: string) => c.req.header(n)
  return h('cf-connecting-ip') || (h('x-forwarded-for') || '').split(',')[0].trim() || 'local'
}

// Returns a 429 Response when the caller has used up its allowance, else null.
async function limited(c: any, name: string, max: number, windowSec: number) {
  const store: Store = c.get('store')
  const n = await store.rlHit(`${name}:${clientIp(c)}`, windowSec)
  if (n > max) {
    c.header('Retry-After', String(windowSec))
    return c.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429)
  }
  return null
}

// PIN check with brute-force lockout (10 wrong PINs / 15 min per IP).
async function pinGate(c: any, allowed: (string | undefined)[]): Promise<Response | null> {
  const pins = allowed.filter(Boolean) as string[]
  if (!pins.length) return null // no PIN configured -> open (local dev)
  const store: Store = c.get('store')
  const ip = clientIp(c)
  if ((await store.rlPeek(`pinfail:${ip}`, 900)) >= 10) {
    return c.json({ error: 'Too many wrong PINs. Try again in 15 minutes.' }, 429)
  }
  const given = c.req.header('x-admin-pin') || ''
  if (pins.some(p => safeEqual(given, p))) return null
  if (given) await store.rlHit(`pinfail:${ip}`, 900)
  return c.json({ error: 'PIN required' }, 401)
}

// ─── Payment-processor helpers ───────────────────────────────────────────────
const stripeHeaders = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' })
const squareHost = (s: AppSettings) => s.squareAppId.startsWith('sandbox-') ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com'

// The ONLY way a Stripe order becomes paid: ask Stripe itself (never trust the browser or a webhook body).
async function verifyStripePayment(key: string, order: Order): Promise<boolean> {
  if (!order.paymentIntentId) return false
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(order.paymentIntentId)}`, { headers: stripeHeaders(key) })
  const pi: any = await res.json().catch(() => ({}))
  return res.ok && pi.status === 'succeeded' && pi.amount_received === order.total && pi.metadata?.orderId === order.id
}

// ─── App ─────────────────────────────────────────────────────────────────────
const app = new Hono<Env>()
app.use('*', cors())

// Static assets (CSS, JS, fonts, webfonts)
app.use('/static/*', serveStatic({ root: './public' }))

// Every API call gets a storage handle (D1 if bound, otherwise in-memory).
app.use('/api/*', async (c, next) => {
  const store = makeStore(c.env)
  try { await store.init() } catch (e: any) { return c.json({ error: 'Database unavailable: ' + (e?.message || e) }, 503) }
  c.set('store', store)
  await next()
})

const isLocalHost = (c: any) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(c.req.header('host') || '')

// Admin PIN gate for /api/admin/*. With no ADMIN_PIN secret, admin is only open on localhost.
app.use('/api/admin/*', async (c, next) => {
  if (!c.env?.ADMIN_PIN) {
    if (isLocalHost(c)) return next()
    return c.json({ error: 'Admin is locked: set the ADMIN_PIN secret first.' }, 403)
  }
  const denied = await pinGate(c, [c.env.ADMIN_PIN])
  if (denied) return denied
  await next()
})
app.get('/api/admin/ping', async (c) => {
  const s = await c.get('store').getSettings()
  return c.json({
    ok: true,
    pinRequired: !!c.env?.ADMIN_PIN,
    uploads: !!c.env?.ADMIN_PIN && !!c.env?.VIDEOS,
    storage: !!c.env?.VIDEOS,
    database: c.get('store').persistent,
    kdsPinSeparate: !!c.env?.KDS_PIN,
    testMode: s.allowDemoOrders,
    cardReady: (s.squareMode && !!c.env?.SQUARE_ACCESS_TOKEN) || (s.stripeMode && !!c.env?.STRIPE_SECRET_KEY),
  })
})

// Kitchen PIN gate for /api/kds*. KDS_PIN (if set) or ADMIN_PIN both work.
app.use('/api/kds', async (c, next) => kdsGate(c, next))
app.use('/api/kds/*', async (c, next) => kdsGate(c, next))
async function kdsGate(c: any, next: () => Promise<void>) {
  const pins = [c.env?.KDS_PIN, c.env?.ADMIN_PIN]
  if (!pins.some(Boolean)) {
    if (isLocalHost(c)) return next()
    return c.json({ error: 'Kitchen screen is locked: set the ADMIN_PIN (or KDS_PIN) secret first.' }, 403)
  }
  const denied = await pinGate(c, pins)
  if (denied) return denied
  await next()
}
// Card-terminal endpoints are staff-only too.
app.use('/api/connection_token', async (c, next) => { const d = await pinGate(c, [c.env?.ADMIN_PIN]); if (d) return d; await next() })
app.use('/api/payments/create-intent', async (c, next) => { const d = await pinGate(c, [c.env?.ADMIN_PIN]); if (d) return d; await next() })

// ══════════════════════════════════════════════════════════════════
// PUBLIC API — MENU
// ══════════════════════════════════════════════════════════════════
app.get('/api/menu', async (c) => {
  const store = c.get('store')
  const [menu, settings] = await Promise.all([store.getMenu(), store.getSettings()])
  const categories = [...new Set(menu.map(i => i.category))]
  return c.json({ menu, categories, settings })
})

app.get('/api/menu/:id', async (c) => {
  const item = (await c.get('store').getMenu()).find(i => i.id === c.req.param('id'))
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json(item)
})

// ══════════════════════════════════════════════════════════════════
// PUBLIC API — ORDERS
// ══════════════════════════════════════════════════════════════════
// Shared checks for anything that creates an order or starts a payment.
async function startCheckout(c: any, body: any) {
  const store: Store = c.get('store')
  const settings = await store.getSettings()
  if (!settings.ordersOpen) return { res: c.json({ error: settings.closedMessage || 'Ordering is closed right now.', closed: true }, 403) }
  const lim = await limited(c, 'checkout', 40, 600)
  if (lim) return { res: lim }
  const built = buildItems(body.items, await store.getMenu())
  if ('error' in built) return { res: c.json({ error: built.error }, 400) }
  return {
    store, settings, items: built.items,
    customerName: clean(body.customerName, 40) || 'Guest',
    notes: clean(body.notes, 200),
    channel: (body.channel === 'online' ? 'online' : 'kiosk') as Channel,
  }
}

// Test-mode only: place an order with no card payment. Off by default.
app.post('/api/orders', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const ck: any = await startCheckout(c, body)
  if (ck.res) return ck.res
  if (!ck.settings.allowDemoOrders) {
    return c.json({ error: 'Card payment is required. Pay-without-card is disabled.' }, 403)
  }
  const order = await newOrder(ck.store, ck.settings, {
    customerName: ck.customerName, channel: ck.channel, items: ck.items, notes: ck.notes,
    status: 'paid', paymentMethod: 'demo',
  })
  return c.json({ order: publicOrder(order) }, 201)
})

// Customer order tracking. Ids are 10 random chars, so only the holder of the link/ticket can look it up.
app.get('/api/orders/:id', async (c) => {
  const store = c.get('store')
  const o = await store.getOrder(c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  const settings = await store.getSettings()
  let ahead = 0
  if (['paid', 'queued', 'in_prep'].includes(o.status)) {
    const active = await store.listOrders({ statuses: ['paid', 'queued', 'in_prep'], limit: 200 })
    ahead = active.filter(x => x.createdAt < o.createdAt).length
  }
  return c.json({ ...publicOrder(o), ahead, pickupInstructions: settings.pickupInstructions, businessName: settings.businessName })
})

// Public pickup board (for a TV / tablet at the trailer): first names + ticket numbers only.
app.get('/api/pickup', async (c) => {
  const store = c.get('store')
  const settings = await store.getSettings()
  const active = await store.listOrders({ statuses: ['paid', 'queued', 'in_prep', 'ready'], limit: 100 })
  const view = (o: Order) => ({ ticket: o.ticketNumber, name: firstName(o.customerName) })
  c.header('Cache-Control', 'no-store')
  return c.json({
    open: settings.ordersOpen,
    closedMessage: settings.closedMessage,
    businessName: settings.businessName,
    pickupInstructions: settings.pickupInstructions,
    ready: active.filter(o => o.status === 'ready').reverse().map(view),
    preparing: active.filter(o => o.status !== 'ready').reverse().map(view),
  })
})

// ══════════════════════════════════════════════════════════════════
// STRIPE (card on screen + staff terminal)
// ══════════════════════════════════════════════════════════════════
app.post('/api/connection_token', async (c) => {
  const key = c.env?.STRIPE_SECRET_KEY || ''
  if (!key) return c.json({ error: 'Stripe not configured' }, 400)
  const res = await fetch('https://api.stripe.com/v1/terminal/connection_tokens', { method: 'POST', headers: stripeHeaders(key) })
  const data: any = await res.json()
  if (!res.ok) return c.json({ error: data.error?.message }, 400)
  return c.json({ secret: data.secret })
})

// Creates the order as PENDING_PAYMENT plus a PaymentIntent. The kitchen sees nothing until Stripe confirms.
async function createStripeOrder(c: any, mode: 'online' | 'terminal') {
  const key = c.env?.STRIPE_SECRET_KEY || ''
  if (!key) return c.json({ error: 'Stripe not configured' }, 400)
  const body: any = await c.req.json().catch(() => ({}))
  const ck: any = await startCheckout(c, body)
  if (ck.res) return ck.res
  const order = await newOrder(ck.store, ck.settings, {
    customerName: ck.customerName, channel: ck.channel, items: ck.items, notes: ck.notes,
    status: 'pending_payment', paymentMethod: mode === 'online' ? 'stripe_online' : 'stripe_terminal',
  })
  const params = new URLSearchParams({
    amount: String(order.total), currency: 'usd',
    'metadata[orderId]': order.id, 'metadata[ticket]': String(order.ticketNumber), 'metadata[customerName]': order.customerName,
  })
  if (mode === 'online') params.set('payment_method_types[]', 'card')
  else { params.set('payment_method_types[]', 'card_present'); params.set('capture_method', 'automatic') }
  const res = await fetch('https://api.stripe.com/v1/payment_intents', { method: 'POST', headers: stripeHeaders(key), body: params.toString() })
  const data: any = await res.json()
  if (!res.ok) {
    setStatus(order, 'cancelled'); await ck.store.putOrder(order)
    return c.json({ error: data.error?.message || 'Could not start payment' }, 400)
  }
  order.paymentIntentId = data.id
  await ck.store.putOrder(order)
  return c.json({ clientSecret: data.client_secret, orderId: order.id, total: order.total, publishableKey: ck.settings.stripePublishableKey })
}
app.post('/api/payments/stripe-online', (c) => createStripeOrder(c, 'online'))
app.post('/api/payments/create-intent', (c) => createStripeOrder(c, 'terminal'))

// After the browser says "paid", we ask Stripe ourselves before releasing the order to the kitchen.
app.post('/api/payments/stripe-confirm', async (c) => {
  const key = c.env?.STRIPE_SECRET_KEY || ''
  if (!key) return c.json({ error: 'Stripe not configured' }, 400)
  const lim = await limited(c, 'confirm', 60, 600)
  if (lim) return lim
  const body: any = await c.req.json().catch(() => ({}))
  const store = c.get('store')
  const order = await store.getOrder(String(body.orderId || ''))
  if (!order || !order.paymentMethod.startsWith('stripe')) return c.json({ error: 'Order not found' }, 404)
  if (order.status === 'pending_payment') {
    if (!(await verifyStripePayment(key, order))) return c.json({ error: 'Payment has not completed.' }, 402)
    await markPaid(store, order)
  }
  return c.json({ order: publicOrder(order) })
})

// Stripe webhook. The body is NOT trusted: we only use it as a hint, then re-check with Stripe's API.
app.post('/api/webhooks/stripe', async (c) => {
  const key = c.env?.STRIPE_SECRET_KEY || ''
  const body: any = await c.req.json().catch(() => ({}))
  if (key && body?.type === 'payment_intent.succeeded') {
    const store = c.get('store')
    const order = await store.findByPayment(String(body.data?.object?.id || ''))
    if (order && order.status === 'pending_payment' && (await verifyStripePayment(key, order))) await markPaid(store, order)
  }
  return c.json({ received: true })
})

// ══════════════════════════════════════════════════════════════════
// SQUARE (Web Payments SDK — card entry on screen)
// ══════════════════════════════════════════════════════════════════
app.post('/api/payments/square-init', async (c) => {
  const settings = await c.get('store').getSettings()
  if (!settings.squareMode || !settings.squareAppId || !settings.squareLocationId) return c.json({ error: 'Square not configured' }, 400)
  const body: any = await c.req.json().catch(() => ({}))
  const built = buildItems(body.items, await c.get('store').getMenu())
  if ('error' in built) return c.json({ error: built.error }, 400)
  return c.json({ appId: settings.squareAppId, locationId: settings.squareLocationId, ...calcOrder(built.items, settings.taxRate) })
})

// The order is created only AFTER Square reports the charge as completed.
app.post('/api/payments/square-charge', async (c) => {
  const token = c.env?.SQUARE_ACCESS_TOKEN || ''
  if (!token) return c.json({ error: 'Square access token not configured on server' }, 400)
  const body: any = await c.req.json().catch(() => ({}))
  if (!body.sourceId || typeof body.sourceId !== 'string') return c.json({ error: 'Missing card token' }, 400)
  const ck: any = await startCheckout(c, body)
  if (ck.res) return ck.res
  const { store, settings, items } = ck
  if (!settings.squareLocationId) return c.json({ error: 'Square not configured' }, 400)
  const { total } = calcOrder(items, settings.taxRate)

  // Same key on a retry => Square returns the same payment instead of charging twice.
  const idem = clean(body.idempotencyKey, 45) || uid() + '-' + Date.now()
  const sq = await fetch(`${squareHost(settings)}/v2/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Square-Version': '2024-01-18' },
    body: JSON.stringify({
      idempotency_key: idem, source_id: body.sourceId, autocomplete: true,
      amount_money: { amount: total, currency: 'USD' }, location_id: settings.squareLocationId,
      note: `Ara's DNA — ${ck.customerName}`,
    }),
  })
  const sqData: any = await sq.json().catch(() => ({}))
  if (!sq.ok || sqData.errors) return c.json({ error: sqData.errors?.[0]?.detail || 'Card was declined' }, 400)
  const pay = sqData.payment
  if (!pay?.id || pay.status !== 'COMPLETED' || pay.amount_money?.amount !== total) {
    return c.json({ error: 'Payment was not completed. You have not been charged.' }, 402)
  }
  const existing = await store.findByPayment(pay.id)
  if (existing) return c.json({ order: publicOrder(existing) })
  const order = await newOrder(store, settings, {
    customerName: ck.customerName, channel: ck.channel, items, notes: ck.notes,
    status: 'paid', paymentMethod: 'square_online', paymentIntentId: pay.id,
  })
  return c.json({ order: publicOrder(order) })
})

// Square webhook: orders are only ever created after a completed charge, so there is nothing to change here.
app.post('/api/webhooks/square', (c) => c.json({ ok: true }))

// ══════════════════════════════════════════════════════════════════
// KITCHEN DISPLAY (KDS) — PIN protected
// ══════════════════════════════════════════════════════════════════
app.get('/api/kds/ping', (c) => c.json({ ok: true }))

app.get('/api/kds', async (c) => {
  const store = c.get('store')
  // Lazy "cron": at most every 10 minutes, drop abandoned checkouts.
  if ((await store.rlHit('purge', 600)) === 1) await store.purgeStale()
  const [active, settings, menu] = await Promise.all([store.listOrders({ statuses: ACTIVE_STATES, limit: 200 }), store.getSettings(), store.getMenu()])
  c.header('Cache-Control', 'no-store')
  return c.json({
    orders: active,
    ordersOpen: settings.ordersOpen,
    soldOut: menu.filter(m => !m.available).map(m => m.id),
  })
})

app.patch('/api/kds/:id/status', async (c) => {
  const store = c.get('store')
  const o = await store.getOrder(c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  const body: any = await c.req.json().catch(() => ({}))
  const allowed: OrderStatus[] = ['queued', 'in_prep', 'ready', 'completed']
  if (!allowed.includes(body.status)) return c.json({ error: 'Invalid status' }, 400)
  if (!PAID_STATES.includes(o.status)) return c.json({ error: `A ${o.status.replace('_', ' ')} order can't be moved` }, 409)
  setStatus(o, body.status)
  await store.putOrder(o)
  return c.json(o)
})

app.patch('/api/kds/:id/priority', async (c) => {
  const store = c.get('store')
  const o = await store.getOrder(c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  const body: any = await c.req.json().catch(() => ({}))
  o.priority = !!body.priority
  o.updatedAt = now()
  await store.putOrder(o)
  return c.json(o)
})

// One-person controls: pause/resume ordering and mark items sold out, right from the kitchen screen.
app.post('/api/kds/open', async (c) => {
  const store = c.get('store')
  const body: any = await c.req.json().catch(() => ({}))
  const s = await store.getSettings()
  s.ordersOpen = !!body.open
  await store.saveSettings(s)
  return c.json({ ordersOpen: s.ordersOpen })
})
app.get('/api/kds/menu', async (c) => {
  const menu = await c.get('store').getMenu()
  return c.json({ items: menu.map(m => ({ id: m.id, name: m.name, image: m.image, category: m.category, available: m.available })) })
})
app.patch('/api/kds/menu/:id', async (c) => {
  const store = c.get('store')
  const menu = await store.getMenu()
  const item = menu.find(i => i.id === c.req.param('id'))
  if (!item) return c.json({ error: 'Not found' }, 404)
  const body: any = await c.req.json().catch(() => ({}))
  if (typeof body.available === 'boolean') item.available = body.available
  await store.saveMenu(menu)
  return c.json({ id: item.id, available: item.available })
})

// ══════════════════════════════════════════════════════════════════
// ADMIN API
// ══════════════════════════════════════════════════════════════════
app.get('/api/admin/orders', async (c) => {
  const status = c.req.query('status') as OrderStatus | undefined
  const channel = c.req.query('channel')
  let result = await c.get('store').listOrders({ statuses: status && ALL_STATES.includes(status) ? [status] : undefined, limit: 500 })
  if (channel) result = result.filter(o => o.channel === channel)
  return c.json({ orders: result, total: result.length })
})

app.patch('/api/admin/orders/:id/status', async (c) => {
  const store = c.get('store')
  const o = await store.getOrder(c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  const body: any = await c.req.json().catch(() => ({}))
  if (!ALL_STATES.includes(body.status)) return c.json({ error: 'Invalid status' }, 400)
  setStatus(o, body.status)
  await store.putOrder(o)
  return c.json(o)
})

app.patch('/api/admin/orders/:id/priority', async (c) => {
  const store = c.get('store')
  const o = await store.getOrder(c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  const body: any = await c.req.json().catch(() => ({}))
  o.priority = !!body.priority
  o.updatedAt = now()
  await store.putOrder(o)
  return c.json(o)
})

// Real refund through the processor that took the payment (demo orders just change status).
app.post('/api/admin/orders/:id/refund', async (c) => {
  const store = c.get('store')
  const o = await store.getOrder(c.req.param('id'))
  if (!o) return c.json({ error: 'Not found' }, 404)
  if (o.status === 'refunded') return c.json({ error: 'Already refunded' }, 409)
  if (o.status === 'pending_payment' || o.status === 'cancelled') return c.json({ error: 'This order was never paid' }, 409)
  const settings = await store.getSettings()
  if (o.paymentMethod.startsWith('stripe') && o.paymentIntentId) {
    const key = c.env?.STRIPE_SECRET_KEY || ''
    if (!key) return c.json({ error: 'Stripe key missing — refund it in the Stripe dashboard.' }, 400)
    const r = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST', headers: { ...stripeHeaders(key), 'Idempotency-Key': `refund-${o.id}` },
      body: new URLSearchParams({ payment_intent: o.paymentIntentId }).toString(),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return c.json({ error: d.error?.message || 'Stripe refund failed' }, 502)
  } else if (o.paymentMethod === 'square_online' && o.paymentIntentId) {
    const token = c.env?.SQUARE_ACCESS_TOKEN || ''
    if (!token) return c.json({ error: 'Square token missing — refund it in the Square dashboard.' }, 400)
    const r = await fetch(`${squareHost(settings)}/v2/refunds`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Square-Version': '2024-01-18' },
      body: JSON.stringify({ idempotency_key: `refund-${o.id}`, payment_id: o.paymentIntentId, amount_money: { amount: o.total, currency: 'USD' } }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok || d.errors) return c.json({ error: d.errors?.[0]?.detail || 'Square refund failed' }, 502)
  }
  setStatus(o, 'refunded')
  await store.putOrder(o)
  return c.json(o)
})

// Admin — Menu Management
app.get('/api/admin/menu', async (c) => c.json({ menu: await c.get('store').getMenu() }))

app.patch('/api/admin/menu/:id', async (c) => {
  const store = c.get('store')
  const menu = await store.getMenu()
  const item = menu.find(i => i.id === c.req.param('id'))
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
  await store.saveMenu(menu)
  return c.json(item)
})

app.post('/api/admin/menu', async (c) => {
  const store = c.get('store')
  const menu = await store.getMenu()
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
    allergens: [],
    modifiers: [],
    prepTime: Number.isFinite(body.prepTime) ? Math.max(0, Math.min(120, Math.round(body.prepTime))) : 5,
    calories: Number.isFinite(body.calories) ? body.calories : undefined,
  }
  menu.push(item)
  await store.saveMenu(menu)
  return c.json(item, 201)
})

// Admin — Analytics (only paid orders count)
app.get('/api/admin/analytics', async (c) => {
  const store = c.get('store')
  const settings = await store.getSettings()
  const orders = await store.listOrders({ limit: 2000 })
  const completed = orders.filter(o => ['completed', 'ready'].includes(o.status))
  const allPaid = orders.filter(o => PAID_STATES.includes(o.status))
  const revenue = allPaid.reduce((s, o) => s + o.total, 0)
  const itemFreq: Record<string, number> = {}
  allPaid.forEach(o => o.items.forEach(i => { itemFreq[i.name] = (itemFreq[i.name] || 0) + i.quantity }))
  const topItems = Object.entries(itemFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }))
  const byHour: Record<string, number> = {}
  allPaid.forEach(o => {
    let label: string
    try { label = new Date(o.createdAt).toLocaleString('en-US', { hour: 'numeric', hour12: true, timeZone: settings.timezone || 'America/New_York' }).replace(' ', '').toLowerCase() }
    catch { const h = new Date(o.createdAt).getUTCHours(); label = `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}` }
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
    },
  })
})

// Admin — Settings
app.get('/api/admin/settings', async (c) => c.json(await c.get('store').getSettings()))
app.patch('/api/admin/settings', async (c) => {
  const store = c.get('store')
  const settings = await store.getSettings()
  const body: any = await c.req.json().catch(() => ({}))
  const types: Record<string, string> = {
    businessName: 'string', tagline: 'string', operatingHours: 'string', phone: 'string',
    taxRate: 'number', stripeMode: 'boolean', stripePublishableKey: 'string',
    squareMode: 'boolean', squareAppId: 'string', squareLocationId: 'string',
    attractMode: 'boolean', attractIdleSeconds: 'number',
    ordersOpen: 'boolean', closedMessage: 'string', pickupInstructions: 'string', allowDemoOrders: 'boolean',
  }
  const longText = new Set(['closedMessage', 'pickupInstructions'])
  for (const [k, t] of Object.entries(types)) {
    const v = body[k]
    if (typeof v !== t) continue
    if (t === 'number' && !Number.isFinite(v)) continue
    if (t === 'string') (settings as any)[k] = clean(v, longText.has(k) ? 240 : 120)
    else if (k === 'taxRate') settings.taxRate = Math.min(Math.max(v, 0), 0.5)
    else if (k === 'attractIdleSeconds') settings.attractIdleSeconds = Math.min(Math.max(Math.round(v), 15), 600)
    else (settings as any)[k] = v
  }
  await store.saveSettings(settings)
  return c.json(settings)
})

// Admin — Seed demo orders (test mode only, so fake sales never pollute real analytics)
app.post('/api/admin/seed', async (c) => {
  const store = c.get('store')
  const settings = await store.getSettings()
  if (!settings.allowDemoOrders) return c.json({ error: 'Turn on Test mode in Settings first — demo orders are blocked on a live site.' }, 403)
  const menu = await store.getMenu()
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
  let seeded = 0
  for (let i = 0; i < 8; i++) {
    const items: OrderItem[] = []
    for (const cc of combos[i]) {
      const m = menu.find(mi => mi.id === cc.id)
      if (!m) continue
      const mods = cc.mod ? [cc.mod] : []
      items.push({ id: m.id, name: m.name, price: unitPrice(m, mods), quantity: 1, modifiers: mods, notes: '' })
    }
    if (!items.length) continue
    const o = await newOrder(store, settings, {
      customerName: names[i % names.length], channel: 'kiosk', items, notes: '',
      status: statuses[Math.floor(Math.random() * statuses.length)], paymentMethod: 'demo',
    })
    o.priority = Math.random() > 0.8
    await store.putOrder(o)
    seeded++
  }
  return c.json({ seeded })
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

app.get('/api/health', (c) => c.json({ ok: true, database: !!c.env?.DB }))

// ══════════════════════════════════════════════════════════════════
// PAGE ROUTES — serve HTML shells
// ══════════════════════════════════════════════════════════════════
app.get('/', (c) => c.html(homeHTML()))
app.get('/kiosk', (c) => c.html(kioskHTML('kiosk')))
app.get('/order', (c) => c.html(kioskHTML('online')))
app.get('/track/:id', (c) => c.html(trackHTML()))
app.get('/pickup', (c) => c.html(pickupHTML()))
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

function kioskHTML(mode: 'kiosk' | 'online') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0${mode === 'kiosk' ? ', maximum-scale=1.0' : ''}" />
  <title>Ara's DNA — Order</title>
  <link rel="icon" href="/favicon.ico"/>
  <link rel="stylesheet" href="/static/fa.min.css"/>
  <link rel="stylesheet" href="/static/kiosk.css"/>
</head>
<body data-mode="${mode}">
  <div id="app"></div>
  <script src="/static/kiosk.js"></script>
</body>
</html>`
}

function trackHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>Your order — Ara's DNA</title>
  <link rel="icon" href="/favicon.ico"/>
  <link rel="stylesheet" href="/static/fa.min.css"/>
  <link rel="stylesheet" href="/static/track.css"/>
</head>
<body>
  <div id="app"></div>
  <script src="/static/track.js"></script>
</body>
</html>`
}

function pickupHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Order Pickup — Ara's DNA</title>
  <link rel="icon" href="/favicon.ico"/>
  <link rel="stylesheet" href="/static/fa.min.css"/>
  <link rel="stylesheet" href="/static/track.css"/>
</head>
<body class="pickup-body">
  <div id="app"></div>
  <script src="/static/pickup.js"></script>
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
