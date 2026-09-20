// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  menu: [], categories: [], settings: {},
  cart: {},
  activeCategory: 'All', search: '',
  modalItem: null, modalMods: {},
  // Payment
  squareMode: false, squareAppId: '', squareLocationId: '',
  stripeMode: false, stripePublishableKey: '',
  squarePayments: null, squareCard: null,
  stripeTerminal: null, connectedReader: null,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (cents) => `$${(cents / 100).toFixed(2)}`
const qs  = (id) => document.getElementById(id)

function cartKey(itemId, mods) { return itemId + '|' + JSON.stringify(mods) }

function cartTotal() {
  let sub = 0
  Object.values(state.cart).forEach(e => { sub += e.item.price * e.quantity })
  const tax = Math.round(sub * (state.settings.taxRate || 0.08))
  return { sub, tax, total: sub + tax }
}

function cartItemCount() {
  return Object.values(state.cart).reduce((s, e) => s + e.quantity, 0)
}

function toast(msg, color = '#22c55e') {
  let t = document.querySelector('.toast')
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg; t.style.background = color
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 3000)
}

// ─── Render: Categories ───────────────────────────────────────────────────────
function renderCategories() {
  const c = qs('categoryTabs'); if (!c) return
  const cats = ['All', ...state.categories]
  c.innerHTML = cats.map(cat =>
    `<button class="cat-tab ${state.activeCategory === cat ? 'active' : ''}" onclick="setCategory('${cat}')">${cat}</button>`
  ).join('')
}

// ─── Render: Menu ─────────────────────────────────────────────────────────────
function renderMenu() {
  const container = qs('menuContainer'); if (!container) return
  const q = state.search.toLowerCase()
  let items = state.menu
  if (state.activeCategory !== 'All') items = items.filter(i => i.category === state.activeCategory)
  if (q) items = items.filter(i => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))

  if (!items.length) {
    container.innerHTML = `<div style="text-align:center;padding:80px 20px;color:#6b7280"><i class="fas fa-search" style="font-size:40px;opacity:0.3"></i><p style="margin-top:12px">No items found</p></div>`
    return
  }

  const grouped = {}
  items.forEach(i => { if (!grouped[i.category]) grouped[i.category] = []; grouped[i.category].push(i) })

  container.innerHTML = Object.entries(grouped).map(([cat, catItems]) => `
    <div class="menu-section">
      <div class="section-title">${cat}</div>
      <div class="menu-grid">
        ${catItems.map(item => `
          <div class="menu-card ${!item.available ? 'unavailable' : ''}" onclick="openItemModal('${item.id}')">
            ${item.popular ? '<div class="popular-badge">⭐ Popular</div>' : ''}
            <span class="emoji">${item.image}</span>
            <div class="card-body">
              <div class="item-name">${item.name}</div>
              <div class="item-desc">${item.description}</div>
              <div class="card-footer">
                <span class="price">${fmt(item.price)}</span>
                <button class="add-btn" onclick="quickAdd(event,'${item.id}')"><i class="fas fa-plus"></i></button>
              </div>
            </div>
            ${!item.available ? '<div class="sold-out-overlay">SOLD OUT</div>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('')
}

// ─── Render: Cart ─────────────────────────────────────────────────────────────
function renderCart() {
  const entries = Object.values(state.cart)
  const { sub, tax, total } = cartTotal()

  const cartItems = qs('cartItems')
  if (!entries.length) {
    cartItems.innerHTML = `<div class="cart-empty"><div class="empty-icon">🛒</div><p>Your cart is empty</p><p style="font-size:13px;color:#6b7280">Tap an item to add it</p></div>`
  } else {
    cartItems.innerHTML = entries.map(e => {
      const key = cartKey(e.item.id, e.modifiers)
      const modsStr = e.modifiers.length ? e.modifiers.join(', ') : ''
      return `
        <div class="cart-item">
          <div class="item-emoji">${e.item.image}</div>
          <div class="item-info">
            <div class="item-name">${e.item.name}</div>
            ${modsStr ? `<div class="item-mods">${modsStr}</div>` : ''}
            <div class="qty-control">
              <button class="qty-btn" onclick="adjustQty('${encodeURIComponent(key)}',-1)"><i class="fas fa-minus"></i></button>
              <span class="qty-num">${e.quantity}</span>
              <button class="qty-btn" onclick="adjustQty('${encodeURIComponent(key)}',1)"><i class="fas fa-plus"></i></button>
            </div>
          </div>
          <div class="item-price">${fmt(e.item.price * e.quantity)}</div>
        </div>`
    }).join('')
  }

  qs('subtotalVal').textContent = fmt(sub)
  qs('taxVal').textContent = fmt(tax)
  qs('totalVal').textContent = fmt(total)

  const btn = qs('checkoutBtn')
  btn.disabled = entries.length === 0
  btn.innerHTML = entries.length
    ? `<i class="fas fa-credit-card"></i> Pay ${fmt(total)}`
    : `<i class="fas fa-shopping-cart"></i> Add Items`

  const count = cartItemCount()
  qs('cartCount').textContent = count > 0 ? `${count} item${count !== 1 ? 's' : ''}` : 'Empty cart'
}

// ─── Category / Search ────────────────────────────────────────────────────────
window.setCategory = function(cat) {
  state.activeCategory = cat; renderCategories(); renderMenu()
}
window.handleSearch = function(val) { state.search = val; renderMenu() }
window.clearCart    = function() { state.cart = {}; renderCart() }

// ─── Item Modal ───────────────────────────────────────────────────────────────
window.openItemModal = function(id) {
  const item = state.menu.find(m => m.id === id)
  if (!item || !item.available) return
  state.modalItem = item; state.modalMods = {}
  item.modifiers?.forEach(g => {
    if (g.required && g.options.length) state.modalMods[g.name] = [g.options[0].name]
  })
  renderModal()
  qs('itemModal').classList.remove('hidden')
}
window.closeModal = function() { qs('itemModal').classList.add('hidden'); state.modalItem = null }

window.toggleMod = function(groupName, optName, multiple) {
  if (!state.modalMods[groupName]) state.modalMods[groupName] = []
  const current = state.modalMods[groupName]
  const idx = current.indexOf(optName)
  if (multiple) { if (idx >= 0) current.splice(idx, 1); else current.push(optName) }
  else state.modalMods[groupName] = [optName]
  renderModal()
}

function renderModal() {
  const item = state.modalItem; if (!item) return
  let extra = 0
  Object.entries(state.modalMods).forEach(([gName, selected]) => {
    const g = item.modifiers.find(m => m.name === gName)
    if (g) selected.forEach(sel => { const opt = g.options.find(o => o.name === sel); if (opt) extra += opt.price })
  })
  qs('modalContent').innerHTML = `
    <div class="modal-emoji">${item.image}</div>
    <div class="modal-name">${item.name}</div>
    <div class="modal-desc">${item.description}</div>
    <div class="modal-meta">
      ${item.prepTime ? `<div class="meta-chip"><i class="fas fa-clock"></i> ~${item.prepTime} min</div>` : ''}
      ${item.calories ? `<div class="meta-chip"><i class="fas fa-fire"></i> ${item.calories} cal</div>` : ''}
      ${item.allergens?.length ? `<div class="meta-chip"><i class="fas fa-exclamation-triangle"></i> ${item.allergens.join(', ')}</div>` : ''}
    </div>
    ${(item.modifiers||[]).map(g => `
      <div class="modifier-group">
        <div class="modifier-label">${g.name}
          ${g.required ? '<span class="req-badge">Required</span>' : ''}
          ${g.multiple ? '<span style="font-size:11px;color:#6b7280">Pick multiple</span>' : ''}
        </div>
        <div class="modifier-options">
          ${g.options.map(opt => {
            const sel = state.modalMods[g.name]?.includes(opt.name)
            return `<div class="mod-option ${sel?'selected':''}" onclick="toggleMod('${g.name}','${opt.name}',${g.multiple})">
              ${opt.name}${opt.price ? ` +${fmt(opt.price)}` : ''}</div>`
          }).join('')}
        </div>
      </div>`).join('')}
    <div class="modal-footer">
      <div class="modal-price">${fmt(item.price + extra)}</div>
      <button class="modal-add-btn" onclick="addFromModal()"><i class="fas fa-plus"></i> Add to Order</button>
    </div>`
}

window.addFromModal = function() {
  const item = state.modalItem; if (!item) return
  const mods = Object.values(state.modalMods).flat()
  const key = cartKey(item.id, mods)
  if (state.cart[key]) state.cart[key].quantity++
  else state.cart[key] = { item, quantity: 1, modifiers: mods }
  closeModal(); renderCart(); toast(`${item.name} added!`)
}

window.quickAdd = function(e, id) {
  e.stopPropagation()
  const item = state.menu.find(m => m.id === id)
  if (!item || !item.available) return
  if (item.modifiers?.some(g => g.required)) { openItemModal(id); return }
  const key = cartKey(item.id, [])
  if (state.cart[key]) state.cart[key].quantity++
  else state.cart[key] = { item, quantity: 1, modifiers: [] }
  renderCart(); toast(`${item.name} added!`)
}

window.adjustQty = function(encodedKey, delta) {
  const key = decodeURIComponent(encodedKey)
  if (!state.cart[key]) return
  state.cart[key].quantity += delta
  if (state.cart[key].quantity <= 0) delete state.cart[key]
  renderCart()
}

// ─── Payment Modal ────────────────────────────────────────────────────────────
window.checkout = function() {
  const entries = Object.values(state.cart)
  if (!entries.length) return
  openPaymentModal()
}

function openPaymentModal() {
  const { sub, tax, total } = cartTotal()
  const hasSquare = state.squareMode && state.squareAppId
  const hasStripe = state.stripeMode && state.stripePublishableKey

  // Build method tabs
  let tabs = `<button class="pay-tab active" data-method="demo" onclick="selectPayMethod(this,'demo')">
    <i class="fas fa-receipt"></i> Demo / Cash
  </button>`
  if (hasSquare) tabs += `<button class="pay-tab" data-method="square" onclick="selectPayMethod(this,'square')">
    <img src="/static/square-logo.svg" style="height:18px;vertical-align:middle" onerror="this.outerHTML='<i class=\\'fab fa-square\\'></i>'" /> Pay with Square
  </button>`
  if (hasStripe) tabs += `<button class="pay-tab" data-method="stripe" onclick="selectPayMethod(this,'stripe')">
    <i class="fas fa-stripe-s"></i> Pay with Stripe
  </button>`

  qs('payModalContent').innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:13px;color:#9ca3af;margin-bottom:4px">Order Total</div>
      <div style="font-size:36px;font-weight:900;color:#f97316">${fmt(total)}</div>
      <div style="font-size:12px;color:#6b7280">${fmt(sub)} + ${fmt(tax)} tax</div>
    </div>

    <div class="pay-tabs">${tabs}</div>

    <div id="payMethodArea">
      <!-- Demo panel (default) -->
      <div id="panel-demo" class="pay-panel active">
        <div style="text-align:center;padding:20px;color:#9ca3af">
          <i class="fas fa-receipt" style="font-size:36px;margin-bottom:12px;display:block;opacity:0.4"></i>
          <p style="margin-bottom:8px">Use this for <strong style="color:white">cash payments</strong> or testing.</p>
          <p style="font-size:12px">No card info needed — order goes straight to kitchen.</p>
        </div>
        <button class="pay-submit-btn demo" onclick="submitDemoPayment()">
          <i class="fas fa-check-circle"></i> Confirm Order (Cash / Demo)
        </button>
      </div>

      <!-- Square panel -->
      <div id="panel-square" class="pay-panel" style="display:none">
        <div style="font-size:13px;color:#9ca3af;margin-bottom:12px;display:flex;align-items:center;gap:6px">
          <i class="fas fa-lock" style="color:#22c55e"></i>
          Secure card entry powered by Square
        </div>
        <div id="square-card-container" style="min-height:90px;background:#1f2937;border-radius:10px;padding:12px;border:1px solid #374151"></div>
        <div id="squareError" style="color:#ef4444;font-size:13px;margin-top:8px;display:none"></div>
        <button class="pay-submit-btn square" id="squarePayBtn" onclick="submitSquarePayment()">
          <i class="fas fa-credit-card"></i> Pay ${fmt(total)} with Square
        </button>
      </div>

      <!-- Stripe online panel -->
      <div id="panel-stripe" class="pay-panel" style="display:none">
        <div style="font-size:13px;color:#9ca3af;margin-bottom:12px;display:flex;align-items:center;gap:6px">
          <i class="fas fa-lock" style="color:#22c55e"></i>
          Secure card entry powered by Stripe
        </div>
        <div id="stripe-card-container" style="background:#1f2937;border-radius:10px;padding:14px;border:1px solid #374151;min-height:50px"></div>
        <div id="stripeError" style="color:#ef4444;font-size:13px;margin-top:8px;display:none"></div>
        <button class="pay-submit-btn stripe-btn" id="stripePayBtn" onclick="submitStripeOnline()">
          <i class="fas fa-credit-card"></i> Pay ${fmt(total)} with Stripe
        </button>
      </div>
    </div>
  `

  qs('payModal').classList.remove('hidden')

  // Mount Square card if configured
  if (hasSquare) mountSquareCard()
  // Mount Stripe Elements if configured
  if (hasStripe) mountStripeElements()
}

window.closePayModal = function() {
  qs('payModal').classList.add('hidden')
  // Reset checkout button
  const btn = qs('checkoutBtn')
  btn.disabled = false; renderCart()
}

window.selectPayMethod = function(btn, method) {
  document.querySelectorAll('.pay-tab').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.pay-panel').forEach(p => p.style.display = 'none')
  btn.classList.add('active')
  const panel = qs('panel-' + method)
  if (panel) panel.style.display = 'block'
}

// ─── Square Card Mount ────────────────────────────────────────────────────────
async function mountSquareCard() {
  if (!window.Square) return
  try {
    if (!state.squarePayments) {
      state.squarePayments = await Square.payments(state.squareAppId, state.squareLocationId)
    }
    if (state.squareCard) { await state.squareCard.destroy(); state.squareCard = null }
    state.squareCard = await state.squarePayments.card({
      style: {
        '.input-container': { borderColor: '#374151', borderRadius: '8px' },
        '.input-container.is-focused': { borderColor: '#f97316' },
        input: { color: '#f9fafb', backgroundColor: '#1f2937' },
        '.input-container.is-error': { borderColor: '#ef4444' },
      }
    })
    await state.squareCard.attach('#square-card-container')
  } catch(e) {
    console.warn('Square card mount failed:', e.message)
    const c = qs('square-card-container')
    if (c) c.innerHTML = `<div style="color:#ef4444;font-size:13px;padding:8px"><i class="fas fa-exclamation-triangle"></i> Square not available. Use Demo mode or check your App ID & Location ID in admin settings.</div>`
  }
}

// ─── Stripe Elements Mount ────────────────────────────────────────────────────
let stripeInstance = null
let stripeCardElement = null

async function mountStripeElements() {
  if (!window.Stripe || !state.stripePublishableKey) return
  try {
    if (!stripeInstance) stripeInstance = Stripe(state.stripePublishableKey)
    const elements = stripeInstance.elements({ appearance: { theme: 'night', variables: { colorPrimary: '#f97316' } } })
    stripeCardElement = elements.create('card', { hidePostalCode: false })
    stripeCardElement.mount('#stripe-card-container')
    stripeCardElement.on('change', (e) => {
      const errEl = qs('stripeError')
      if (e.error) { errEl.textContent = e.error.message; errEl.style.display = 'block' }
      else errEl.style.display = 'none'
    })
  } catch(e) { console.warn('Stripe Elements mount failed:', e.message) }
}

// ─── Submit: Demo / Cash ──────────────────────────────────────────────────────
window.submitDemoPayment = async function() {
  const name = qs('customerName').value.trim() || 'Guest'
  const items = Object.values(state.cart).map(e => ({ id: e.item.id, quantity: e.quantity, modifiers: e.modifiers }))
  const btn = document.querySelector('.pay-submit-btn.demo')
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Placing order...'
  try {
    const res = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: name, items, channel: 'kiosk' })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed')
    state.cart = {}
    closePayModal()
    showConfirmation(data.order)
  } catch(err) {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirm Order (Cash / Demo)'
    toast('Error: ' + err.message, '#ef4444')
  }
}

// ─── Submit: Square ───────────────────────────────────────────────────────────
window.submitSquarePayment = async function() {
  if (!state.squareCard) { toast('Square card form not ready', '#ef4444'); return }
  const name = qs('customerName').value.trim() || 'Guest'
  const items = Object.values(state.cart).map(e => ({ id: e.item.id, quantity: e.quantity, modifiers: e.modifiers }))
  const btn = qs('squarePayBtn')
  const errEl = qs('squareError')
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...'
  errEl.style.display = 'none'

  try {
    const result = await state.squareCard.tokenize()
    if (result.status !== 'OK') {
      throw new Error(result.errors?.[0]?.message || 'Card tokenization failed')
    }
    const res = await fetch('/api/payments/square-charge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: result.token, customerName: name, items })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Payment failed')
    state.cart = {}
    closePayModal()
    showConfirmation(data.order)
  } catch(err) {
    btn.disabled = false
    const { total } = cartTotal()
    btn.innerHTML = `<i class="fas fa-credit-card"></i> Pay ${fmt(total)} with Square`
    errEl.textContent = err.message; errEl.style.display = 'block'
  }
}

// ─── Submit: Stripe Online ────────────────────────────────────────────────────
window.submitStripeOnline = async function() {
  if (!stripeInstance || !stripeCardElement) { toast('Stripe not ready', '#ef4444'); return }
  const name = qs('customerName').value.trim() || 'Guest'
  const items = Object.values(state.cart).map(e => ({ id: e.item.id, quantity: e.quantity, modifiers: e.modifiers }))
  const btn = qs('stripePayBtn')
  const errEl = qs('stripeError')
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...'
  errEl.style.display = 'none'

  try {
    // Create PaymentIntent on server
    const intentRes = await fetch('/api/payments/stripe-online', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: name, items })
    })
    const intentData = await intentRes.json()
    if (!intentRes.ok) throw new Error(intentData.error || 'Failed to create payment')

    // Confirm card on client
    const { paymentIntent, error } = await stripeInstance.confirmCardPayment(intentData.clientSecret, {
      payment_method: { card: stripeCardElement, billing_details: { name } }
    })
    if (error) throw new Error(error.message)
    if (paymentIntent.status !== 'succeeded') throw new Error('Payment not completed')

    state.cart = {}
    closePayModal()
    // Fetch the order that was pre-created
    const orderRes = await fetch('/api/orders/' + intentData.orderId)
    const orderData = await orderRes.json()
    showConfirmation(orderData)
  } catch(err) {
    btn.disabled = false
    const { total } = cartTotal()
    btn.innerHTML = `<i class="fas fa-credit-card"></i> Pay ${fmt(total)} with Stripe`
    errEl.textContent = err.message; errEl.style.display = 'block'
  }
}

// ─── Stripe Terminal (future Tap to Pay) ─────────────────────────────────────
async function setupStripeTerminal() {
  if (!window.StripeTerminal || !state.stripePublishableKey) return
  try {
    state.stripeTerminal = StripeTerminal.create({
      onFetchConnectionToken: async () => {
        const r = await fetch('/api/connection_token', { method: 'POST' })
        const d = await r.json(); if (!r.ok) throw new Error(d.error); return d.secret
      },
      onUnexpectedReaderDisconnect: () => { state.connectedReader = null }
    })
  } catch(e) { console.warn('Stripe Terminal init:', e.message) }
}

// ─── Confirmation ─────────────────────────────────────────────────────────────
function showConfirmation(order) {
  qs('confirmTicket').textContent = `#${order.ticketNumber}`
  qs('confirmName').textContent = order.customerName && order.customerName !== 'Guest'
    ? `Thank you, ${order.customerName}!` : 'Order placed!'
  qs('confirmModal').classList.remove('hidden')
  qs('customerName').value = ''
  renderCart()
  setTimeout(() => qs('confirmModal').classList.add('hidden'), 12000)
}
window.closeConfirm = function() { qs('confirmModal').classList.add('hidden') }

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const res  = await fetch('/api/menu')
  const data = await res.json()
  state.menu               = data.menu
  state.categories         = data.categories
  state.settings           = data.settings
  state.squareMode         = data.settings?.squareMode         || false
  state.squareAppId        = data.settings?.squareAppId        || ''
  state.squareLocationId   = data.settings?.squareLocationId   || ''
  state.stripeMode         = data.settings?.stripeMode         || false
  state.stripePublishableKey = data.settings?.stripePublishableKey || ''

  if (state.settings.businessName) {
    qs('bizName').textContent    = state.settings.businessName
    qs('bizTagline').textContent = state.settings.tagline || ''
  }

  // Payment status indicators in header
  const payBadges = qs('payBadges')
  if (payBadges) {
    if (state.squareMode)  payBadges.innerHTML += `<span class="pay-live-badge sq">Square Live</span>`
    if (state.stripeMode)  payBadges.innerHTML += `<span class="pay-live-badge st">Stripe Live</span>`
  }

  renderCategories(); renderMenu(); renderCart()
}

// ─── Mount HTML ───────────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <div class="kiosk-header">
    <div class="kiosk-logo">
      <span class="icon">🍦</span>
      <div>
        <h1 id="bizName">Ara's <span>DNA</span></h1>
        <div id="bizTagline" style="font-size:11px;color:#6b7280;margin-top:1px"></div>
      </div>
    </div>
    <div class="header-right">
      <div id="payBadges" style="display:flex;gap:6px;align-items:center"></div>
      <a href="/admin" style="color:#6b7280;text-decoration:none;font-size:13px"><i class="fas fa-cog"></i> Admin</a>
      <a href="/kds"   style="color:#6b7280;text-decoration:none;font-size:13px"><i class="fas fa-utensils"></i> Kitchen</a>
    </div>
  </div>

  <div class="kiosk-layout">
    <div class="kiosk-menu">
      <div class="search-wrap">
        <i class="fas fa-search search-icon"></i>
        <input type="text" class="search-input" placeholder="Search menu items..." id="searchInput" oninput="handleSearch(this.value)">
      </div>
      <div id="categoryTabs" class="category-tabs"></div>
      <div id="menuContainer"></div>
    </div>

    <div class="kiosk-cart">
      <div class="cart-header">
        <h2><i class="fas fa-shopping-cart" style="color:#f97316;margin-right:8px"></i>Your Order</h2>
        <div id="cartCount" class="order-count">Empty cart</div>
      </div>
      <div id="cartItems" class="cart-items"></div>
      <div class="cart-footer">
        <input type="text" id="customerName" class="customer-input" placeholder="Your name (optional)">
        <div class="totals">
          <div class="total-row"><span>Subtotal</span><span id="subtotalVal">$0.00</span></div>
          <div class="total-row"><span>Tax</span><span id="taxVal">$0.00</span></div>
          <div class="total-row grand"><span>Total</span><span id="totalVal">$0.00</span></div>
        </div>
        <button class="checkout-btn" id="checkoutBtn" onclick="checkout()" disabled>
          <i class="fas fa-shopping-cart"></i> Add Items
        </button>
        <button class="clear-btn" onclick="clearCart()"><i class="fas fa-trash"></i> Clear Order</button>
      </div>
    </div>
  </div>

  <!-- Item Detail Modal -->
  <div id="itemModal" class="modal-overlay hidden" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <button class="modal-close" onclick="closeModal()"><i class="fas fa-times"></i></button>
      <div id="modalContent"></div>
    </div>
  </div>

  <!-- Payment Modal -->
  <div id="payModal" class="modal-overlay hidden" onclick="if(event.target===this)closePayModal()">
    <div class="modal pay-modal">
      <button class="modal-close" onclick="closePayModal()"><i class="fas fa-times"></i></button>
      <h3 style="font-size:20px;font-weight:800;margin-bottom:16px"><i class="fas fa-credit-card" style="color:#f97316;margin-right:8px"></i>Choose Payment</h3>
      <div id="payModalContent"></div>
    </div>
  </div>

  <!-- Order Confirmation Modal -->
  <div id="confirmModal" class="modal-overlay hidden">
    <div class="modal confirm-modal">
      <div class="confirm-icon">🎉</div>
      <div class="confirm-title" id="confirmName">Order placed!</div>
      <div class="confirm-subtitle">Your ticket number</div>
      <div class="ticket-number" id="confirmTicket">#101</div>
      <div class="confirm-subtitle" style="margin-top:12px">Watch the kitchen screen for your order status.</div>
      <div class="confirm-links">
        <a href="/kds" class="conf-link secondary"><i class="fas fa-tv"></i> Kitchen Display</a>
        <button class="conf-link primary" onclick="closeConfirm()"><i class="fas fa-plus"></i> New Order</button>
      </div>
    </div>
  </div>
`

init()
