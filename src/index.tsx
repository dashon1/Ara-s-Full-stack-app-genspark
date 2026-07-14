import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

// ─── In-Memory Store (KV-ready interface) ───────────────────────────────────
let orderSeq = 100
const orders: Order[] = []
const menuItems: MenuItem[] = getDefaultMenu()
const settings: AppSettings = {
  businessName: "Ara's DNA",
  taxRate: 0.08,
  stripeMode: false,
  stripePublishableKey: '',
  operatingHours: 'Call 727-254-7198',
  tagline: 'Hand-Crafted Ice Cream · Island Ice · Hot Dogs',
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
  stripeMode: boolean
  stripePublishableKey: string
  operatingHours: string
  tagline: string
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

// ─── App ─────────────────────────────────────────────────────────────────────
const app = new Hono()
app.use('*', cors())

// Static assets (CSS, JS, fonts, webfonts)
app.use('/static/*', serveStatic({ root: './public' }))

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
  const body = await c.req.json()
  const { customerName = 'Guest', items: rawItems = [], notes = '', channel = 'kiosk' } = body

  if (!rawItems.length) return c.json({ error: 'Cart is empty' }, 400)

  const items: OrderItem[] = rawItems.map((ri: any) => {
    const m = menuItems.find(m => m.id === ri.id)
    if (!m) throw new Error(`Unknown item ${ri.id}`)
    return {
      id: m.id,
      name: m.name,
      price: m.price,
      quantity: ri.quantity || 1,
      modifiers: ri.modifiers || [],
      notes: ri.notes || '',
    }
  })

  const { subtotal, tax, total } = calcOrder(items, settings.taxRate)
  const order: Order = {
    id: uid(),
    ticketNumber: ++orderSeq,
    customerName: customerName || 'Guest',
    channel: channel as Channel,
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
  const body = await c.req.json()
  const { customerName = 'Guest', items: rawItems = [], notes = '' } = body

  const items: OrderItem[] = rawItems.map((ri: any) => {
    const m = menuItems.find(m => m.id === ri.id)
    if (!m) throw new Error(`Unknown item ${ri.id}`)
    return { id: m.id, name: m.name, price: m.price, quantity: ri.quantity || 1, modifiers: ri.modifiers || [], notes: ri.notes || '' }
  })
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
  // In production: verify Stripe-Signature header
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
  const body = await c.req.json()
  Object.assign(item, body)
  return c.json(item)
})

app.post('/api/admin/menu', async (c) => {
  const body = await c.req.json()
  const item: MenuItem = {
    id: body.name.toLowerCase().replace(/\s+/g, '-') + '-' + uid().slice(0, 4),
    name: body.name,
    description: body.description || '',
    price: body.price || 0,
    category: body.category || 'Other',
    image: body.image || '🍽️',
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
  const body = await c.req.json()
  Object.assign(settings, body)
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
      return { id: m.id, name: m.name, price: m.price, quantity: 1, modifiers: c.mod ? [c.mod] : [], notes: '' }
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

// Health
app.get('/api/health', (c) => c.json({ ok: true, orders: orders.length, menu: menuItems.length }))

// ══════════════════════════════════════════════════════════════════
// PAGE ROUTES — serve HTML shells
// ══════════════════════════════════════════════════════════════════
app.get('/', (c) => c.redirect('/kiosk'))
app.get('/kiosk', (c) => c.html(kioskHTML()))
app.get('/kds', (c) => c.html(kdsHTML()))
app.get('/admin', (c) => c.html(adminHTML()))
app.get('/admin/*', (c) => c.html(adminHTML()))

// ══════════════════════════════════════════════════════════════════
// HTML PAGE GENERATORS
// ══════════════════════════════════════════════════════════════════
function kioskHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>Food Trailer Kiosk</title>
  <script src="/static/tailwind.min.js"></script>
  <script src="https://js.stripe.com/terminal/v1/"></script>
  <link rel="stylesheet" href="/static/fa.min.css"/>
  <link rel="stylesheet" href="/static/kiosk.css"/>
</head>
<body class="bg-gray-950 text-white min-h-screen">
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
