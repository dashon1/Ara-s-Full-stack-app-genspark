// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  menu: [],
  categories: [],
  settings: {},
  cart: {},          // { id: { item, quantity, modifiers } }
  activeCategory: 'All',
  search: '',
  modalItem: null,
  modalMods: {},     // groupName -> option name(s)
  stripeTerminal: null,
  connectedReader: null,
  stripeMode: false,
  stripePublishableKey: '',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (cents) => `$${(cents / 100).toFixed(2)}`
const qs = (id) => document.getElementById(id)
const el = (tag, cls, html = '') => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

function cartKey(itemId, mods) {
  return itemId + '|' + JSON.stringify(mods)
}

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
  t.textContent = msg
  t.style.background = color
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 2500)
}

// ─── Render ──────────────────────────────────────────────────────────────────
function render() {
  renderCategories()
  renderMenu()
  renderCart()
}

function renderCategories() {
  const container = qs('categoryTabs')
  if (!container) return
  const cats = ['All', ...state.categories]
  container.innerHTML = cats.map(c =>
    `<button class="cat-tab ${state.activeCategory === c ? 'active' : ''}" onclick="setCategory('${c}')">${c}</button>`
  ).join('')
}

function renderMenu() {
  const container = qs('menuContainer')
  if (!container) return
  const search = state.search.toLowerCase()
  let items = state.menu
  if (state.activeCategory !== 'All') items = items.filter(i => i.category === state.activeCategory)
  if (search) items = items.filter(i => i.name.toLowerCase().includes(search) || i.description.toLowerCase().includes(search))

  if (!items.length) {
    container.innerHTML = `<div style="text-align:center;padding:80px 20px;color:#6b7280"><i class="fas fa-search" style="font-size:40px;opacity:0.3"></i><p style="margin-top:12px">No items found</p></div>`
    return
  }

  // Group by category
  const grouped = {}
  items.forEach(i => {
    if (!grouped[i.category]) grouped[i.category] = []
    grouped[i.category].push(i)
  })

  container.innerHTML = Object.entries(grouped).map(([cat, catItems]) => `
    <div class="menu-section" id="cat-${cat}">
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

function renderCart() {
  const entries = Object.values(state.cart)
  const { sub, tax, total } = cartTotal()

  // Cart items
  const cartItems = qs('cartItems')
  if (!entries.length) {
    cartItems.innerHTML = `<div class="cart-empty"><div class="empty-icon">🛒</div><p>Your cart is empty</p><p style="font-size:13px;color:#6b7280">Tap an item to add it</p></div>`
  } else {
    cartItems.innerHTML = entries.map(e => {
      const modsStr = e.modifiers.length ? e.modifiers.join(', ') : ''
      const key = cartKey(e.item.id, e.modifiers)
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

  // Totals
  qs('subtotalVal').textContent = fmt(sub)
  qs('taxVal').textContent = fmt(tax)
  qs('totalVal').textContent = fmt(total)

  const btn = qs('checkoutBtn')
  btn.disabled = entries.length === 0
  btn.innerHTML = entries.length
    ? `<i class="fas fa-credit-card"></i> Pay ${fmt(total)}`
    : `<i class="fas fa-shopping-cart"></i> Add Items`

  // Cart count badge
  const count = cartItemCount()
  qs('cartCount').textContent = count > 0 ? `${count} item${count !== 1 ? 's' : ''}` : 'Empty cart'
}

// ─── Category / Search ────────────────────────────────────────────────────────
window.setCategory = function(cat) {
  state.activeCategory = cat
  renderCategories()
  renderMenu()
}

// ─── Item Modal ───────────────────────────────────────────────────────────────
window.openItemModal = function(id) {
  const item = state.menu.find(m => m.id === id)
  if (!item || !item.available) return
  state.modalItem = item
  state.modalMods = {}
  // Set defaults
  item.modifiers?.forEach(g => {
    if (g.required && g.options.length) {
      state.modalMods[g.name] = [g.options[0].name]
    }
  })
  renderModal()
  qs('itemModal').classList.remove('hidden')
}

window.closeModal = function() {
  qs('itemModal').classList.add('hidden')
  state.modalItem = null
}

window.toggleMod = function(groupName, optName, multiple) {
  if (!state.modalMods[groupName]) state.modalMods[groupName] = []
  const current = state.modalMods[groupName]
  const idx = current.indexOf(optName)
  if (multiple) {
    if (idx >= 0) current.splice(idx, 1)
    else current.push(optName)
  } else {
    state.modalMods[groupName] = [optName]
  }
  renderModal()
}

function renderModal() {
  const item = state.modalItem
  if (!item) return
  const container = qs('modalContent')

  // Calculate extra cost from selected mods
  let extra = 0
  Object.entries(state.modalMods).forEach(([gName, selected]) => {
    const g = item.modifiers.find(m => m.name === gName)
    if (g) selected.forEach(sel => {
      const opt = g.options.find(o => o.name === sel)
      if (opt) extra += opt.price
    })
  })

  container.innerHTML = `
    <div class="modal-emoji">${item.image}</div>
    <div class="modal-name">${item.name}</div>
    <div class="modal-desc">${item.description}</div>
    <div class="modal-meta">
      ${item.prepTime ? `<div class="meta-chip"><i class="fas fa-clock"></i> ~${item.prepTime} min</div>` : ''}
      ${item.calories ? `<div class="meta-chip"><i class="fas fa-fire"></i> ${item.calories} cal</div>` : ''}
      ${item.allergens?.length ? `<div class="meta-chip"><i class="fas fa-exclamation-triangle"></i> ${item.allergens.join(', ')}</div>` : ''}
    </div>
    ${item.modifiers?.map(g => `
      <div class="modifier-group">
        <div class="modifier-label">
          ${g.name}
          ${g.required ? '<span class="req-badge">Required</span>' : ''}
          ${g.multiple ? '<span style="font-size:11px;color:#6b7280">Pick multiple</span>' : ''}
        </div>
        <div class="modifier-options">
          ${g.options.map(opt => {
            const sel = state.modalMods[g.name]?.includes(opt.name)
            return `<div class="mod-option ${sel ? 'selected' : ''}" onclick="toggleMod('${g.name}','${opt.name}',${g.multiple})">
              ${opt.name}${opt.price ? ` +${fmt(opt.price)}` : ''}
            </div>`
          }).join('')}
        </div>
      </div>
    `).join('') || ''}
    <div class="modal-footer">
      <div class="modal-price">${fmt(item.price + extra)}</div>
      <button class="modal-add-btn" onclick="addFromModal()"><i class="fas fa-plus"></i> Add to Order</button>
    </div>
  `
}

window.addFromModal = function() {
  const item = state.modalItem
  if (!item) return
  const mods = Object.values(state.modalMods).flat()
  const key = cartKey(item.id, mods)
  if (state.cart[key]) state.cart[key].quantity++
  else state.cart[key] = { item, quantity: 1, modifiers: mods }
  closeModal()
  renderCart()
  toast(`${item.name} added!`)
}

window.quickAdd = function(e, id) {
  e.stopPropagation()
  const item = state.menu.find(m => m.id === id)
  if (!item || !item.available) return
  // If has required mods, open modal
  if (item.modifiers?.some(g => g.required)) { openItemModal(id); return }
  const key = cartKey(item.id, [])
  if (state.cart[key]) state.cart[key].quantity++
  else state.cart[key] = { item, quantity: 1, modifiers: [] }
  renderCart()
  toast(`${item.name} added!`)
}

window.adjustQty = function(encodedKey, delta) {
  const key = decodeURIComponent(encodedKey)
  if (!state.cart[key]) return
  state.cart[key].quantity += delta
  if (state.cart[key].quantity <= 0) delete state.cart[key]
  renderCart()
}

// ─── Stripe Terminal ──────────────────────────────────────────────────────────
async function setupStripeTerminal() {
  if (!window.StripeTerminal || !state.stripePublishableKey) return
  try {
    state.stripeTerminal = StripeTerminal.create({
      onFetchConnectionToken: async () => {
        const r = await fetch('/api/connection_token', { method: 'POST' })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error)
        return d.secret
      },
      onUnexpectedReaderDisconnect: () => {
        state.connectedReader = null
        updateReaderStatus('disconnected')
      }
    })
    updateReaderStatus('ready')
    // Auto-discover
    discoverReaders()
  } catch(e) {
    console.warn('Stripe Terminal init failed:', e.message)
  }
}

async function discoverReaders() {
  if (!state.stripeTerminal) return
  const result = await state.stripeTerminal.discoverReaders({ simulated: true })
  if (result.error) { console.warn(result.error.message); return }
  if (result.discoveredReaders?.length) {
    const r = await state.stripeTerminal.connectReader(result.discoveredReaders[0])
    if (!r.error) {
      state.connectedReader = r.reader
      updateReaderStatus('connected', r.reader.label || r.reader.serial_number)
    }
  }
}

function updateReaderStatus(status, label) {
  const badge = qs('stripeBadge')
  const statusEl = qs('readerStatus')
  const dot = qs('readerDot')
  if (state.stripeMode) {
    badge?.classList.add('visible')
    if (statusEl) statusEl.classList.add('visible')
    if (dot) dot.className = `reader-dot ${status === 'connected' ? '' : 'disconnected'}`
    const labelEl = qs('readerLabel')
    if (labelEl) labelEl.textContent = status === 'connected' ? label : status === 'ready' ? 'Scanning...' : 'Disconnected'
  }
}

// ─── Checkout ─────────────────────────────────────────────────────────────────
async function checkout() {
  const btn = qs('checkoutBtn')
  const name = qs('customerName').value.trim() || 'Guest'
  const entries = Object.values(state.cart)
  if (!entries.length) return

  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...'

  const items = entries.map(e => ({ id: e.item.id, quantity: e.quantity, modifiers: e.modifiers }))

  try {
    if (state.stripeMode && state.connectedReader && state.stripeTerminal) {
      await stripeCheckout(name, items)
    } else {
      await demoCheckout(name, items)
    }
  } catch(err) {
    toast('Error: ' + err.message, '#ef4444')
    btn.disabled = false
    renderCart()
  }
}

async function demoCheckout(customerName, items) {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerName, items, channel: 'kiosk' })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Checkout failed')
  state.cart = {}
  showConfirmation(data.order)
}

async function stripeCheckout(customerName, items) {
  const intentRes = await fetch('/api/payments/create-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerName, items })
  })
  const intentData = await intentRes.json()
  if (!intentRes.ok) throw new Error(intentData.error || 'Failed to create payment')

  const collectResult = await state.stripeTerminal.collectPaymentMethod(intentData.clientSecret)
  if (collectResult.error) throw new Error(collectResult.error.message)

  const processResult = await state.stripeTerminal.processPayment(collectResult.paymentIntent)
  if (processResult.error) throw new Error(processResult.error.message)

  state.cart = {}
  showConfirmation({ ticketNumber: intentData.total, id: intentData.orderId })
}

function showConfirmation(order) {
  const overlay = qs('confirmModal')
  qs('confirmTicket').textContent = `#${order.ticketNumber}`
  qs('confirmName').textContent = order.customerName !== 'Guest' ? `Thank you, ${order.customerName}!` : 'Order placed!'
  overlay.classList.remove('hidden')
  qs('customerName').value = ''
  renderCart()
  // Auto dismiss after 12s
  setTimeout(() => { if (!overlay.classList.contains('hidden')) overlay.classList.add('hidden') }, 12000)
}

window.closeConfirm = function() { qs('confirmModal').classList.add('hidden') }

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/menu')
  const data = await res.json()
  state.menu = data.menu
  state.categories = data.categories
  state.settings = data.settings
  state.stripeMode = data.settings?.stripeMode || false
  state.stripePublishableKey = data.settings?.stripePublishableKey || ''

  // Update header
  if (state.settings.businessName) {
    qs('bizName').textContent = state.settings.businessName
    qs('bizTagline').textContent = state.settings.tagline || ''
  }
  if (state.stripeMode) {
    qs('stripeBadge').classList.add('visible')
    qs('readerStatus').classList.add('visible')
    if (state.stripePublishableKey) setupStripeTerminal()
  }

  renderCategories()
  renderMenu()
  renderCart()
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
      <div id="readerStatus" class="reader-status">
        <div id="readerDot" class="reader-dot disconnected"></div>
        <span id="readerLabel">No reader</span>
      </div>
      <div id="stripeBadge" class="stripe-badge">Stripe Live</div>
      <a href="/admin" style="color:#6b7280;text-decoration:none;font-size:13px"><i class="fas fa-cog"></i> Admin</a>
      <a href="/kds" style="color:#6b7280;text-decoration:none;font-size:13px"><i class="fas fa-utensils"></i> Kitchen</a>
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

window.handleSearch = function(val) {
  state.search = val
  renderMenu()
}

window.clearCart = function() {
  state.cart = {}
  renderCart()
}

init()
