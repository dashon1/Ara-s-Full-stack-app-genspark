// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  menu: [], categories: [], settings: {},
  cart: {},                       // key -> { item, quantity, modifiers, unit }
  activeCategory: 'All', search: '',
  modalItem: null, modalMods: {}, modalQty: 1,
  squareMode: false, squareAppId: '', squareLocationId: '',
  stripeMode: false, stripePublishableKey: '',
  squarePayments: null, squareCard: null,
  videos: [], lastActivity: Date.now(), attractOn: false, attractIdx: 0,
  confirmTimer: null,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (cents) => `$${(cents / 100).toFixed(2)}`
const qs  = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function cartKey(itemId, mods) { return itemId + '|' + [...mods].sort().join('~') }

// Base price + every selected option. Must match the server's unitPrice().
function unitPriceOf(item, mods) {
  let p = item.price
  for (const g of item.modifiers || []) for (const o of g.options) if (mods.includes(o.name)) p += o.price
  return p
}

function cartTotal() {
  let sub = 0
  Object.values(state.cart).forEach((e) => { sub += e.unit * e.quantity })
  const tax = Math.round(sub * (state.settings.taxRate ?? 0.08))
  return { sub, tax, total: sub + tax }
}
const cartItemCount = () => Object.values(state.cart).reduce((s, e) => s + e.quantity, 0)

function toast(msg, color = '#22c55e') {
  let t = document.querySelector('.toast')
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t) }
  t.textContent = msg; t.style.background = color
  t.classList.add('show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => t.classList.remove('show'), 2600)
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src))
    document.head.appendChild(s)
  })
}

const anyModalOpen = () => !!document.querySelector('.modal-overlay:not(.hidden)')

// ─── Render: Categories ───────────────────────────────────────────────────────
function renderCategories() {
  const c = qs('categoryTabs'); if (!c) return
  const hasPopular = state.menu.some((m) => m.popular)
  const cats = ['All', ...(hasPopular ? ['Popular'] : []), ...state.categories]
  c.innerHTML = cats.map((cat) =>
    `<button class="cat-tab ${state.activeCategory === cat ? 'active' : ''}" data-cat="${esc(cat)}" aria-pressed="${state.activeCategory === cat}">${cat === 'Popular' ? '⭐ ' : ''}${esc(cat)}</button>`
  ).join('')
}

// ─── Render: Menu ─────────────────────────────────────────────────────────────
function priceLabel(item) {
  const varies = (item.modifiers || []).some((g) => g.required && g.options.some((o) => o.price > 0))
  return (varies ? '<small>from </small>' : '') + fmt(item.price)
}

function renderMenu() {
  const container = qs('menuContainer'); if (!container) return
  const q = state.search.trim().toLowerCase()
  let items = state.menu
  if (state.activeCategory === 'Popular') items = items.filter((i) => i.popular)
  else if (state.activeCategory !== 'All') items = items.filter((i) => i.category === state.activeCategory)
  if (q) items = items.filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))

  if (!items.length) {
    container.innerHTML = `<div class="no-results"><i class="fas fa-magnifying-glass" aria-hidden="true"></i><p>No items match “${esc(state.search)}”</p>
      <button class="link-btn" data-action="reset-filters">Show full menu</button></div>`
    return
  }

  const grouped = {}
  items.forEach((i) => { (grouped[i.category] ||= []).push(i) })

  container.innerHTML = Object.entries(grouped).map(([cat, catItems]) => `
    <section class="menu-section" aria-label="${esc(cat)}">
      <h2 class="section-title">${esc(cat)}</h2>
      <div class="menu-grid">
        ${catItems.map((item) => `
          <article class="menu-card ${!item.available ? 'unavailable' : ''}">
            ${item.popular ? '<div class="popular-badge">⭐ Popular</div>' : ''}
            <button class="card-open" data-open="${esc(item.id)}" ${!item.available ? 'disabled' : ''} aria-label="${esc(item.name)}, ${fmt(item.price)}${item.available ? '' : ', sold out'}">
              <span class="emoji" aria-hidden="true">${esc(item.image)}</span>
              <span class="item-name">${esc(item.name)}</span>
              <span class="item-desc">${esc(item.description)}</span>
            </button>
            <div class="card-footer">
              <span class="price">${priceLabel(item)}</span>
              <button class="add-btn" data-quick="${esc(item.id)}" ${!item.available ? 'disabled' : ''} aria-label="Add ${esc(item.name)}"><i class="fas fa-plus" aria-hidden="true"></i></button>
            </div>
            ${!item.available ? '<div class="sold-out-overlay" aria-hidden="true">SOLD OUT</div>' : ''}
          </article>`).join('')}
      </div>
    </section>`).join('')
}

// ─── Render: Cart ─────────────────────────────────────────────────────────────
function renderCart() {
  const entries = Object.entries(state.cart)
  const { sub, tax, total } = cartTotal()
  const count = cartItemCount()

  qs('cartItems').innerHTML = entries.length ? entries.map(([key, e]) => `
    <div class="cart-item">
      <div class="item-emoji" aria-hidden="true">${esc(e.item.image)}</div>
      <div class="item-info">
        <div class="item-name">${esc(e.item.name)}</div>
        ${e.modifiers.length ? `<div class="item-mods">${esc(e.modifiers.join(' · '))}</div>` : ''}
        <div class="qty-control" role="group" aria-label="Quantity for ${esc(e.item.name)}">
          <button class="qty-btn" data-qty="-1" data-key="${esc(key)}" aria-label="Remove one ${esc(e.item.name)}"><i class="fas ${e.quantity === 1 ? 'fa-trash-can' : 'fa-minus'}" aria-hidden="true"></i></button>
          <span class="qty-num" aria-live="polite">${e.quantity}</span>
          <button class="qty-btn" data-qty="1" data-key="${esc(key)}" aria-label="Add one more ${esc(e.item.name)}"><i class="fas fa-plus" aria-hidden="true"></i></button>
        </div>
      </div>
      <div class="item-price">${fmt(e.unit * e.quantity)}</div>
    </div>`).join('')
    : `<div class="cart-empty"><div class="empty-icon" aria-hidden="true">🍦</div><p>Your order is empty</p><p class="hint">Tap an item to add it</p></div>`

  qs('subtotalVal').textContent = fmt(sub)
  qs('taxVal').textContent = fmt(tax)
  qs('totalVal').textContent = fmt(total)
  qs('cartCount').textContent = count ? `${count} item${count !== 1 ? 's' : ''}` : 'Empty'

  const btn = qs('checkoutBtn')
  btn.disabled = !entries.length
  btn.innerHTML = entries.length
    ? `<i class="fas fa-credit-card" aria-hidden="true"></i> Pay ${fmt(total)}`
    : `<i class="fas fa-basket-shopping" aria-hidden="true"></i> Add items to order`
  qs('clearBtn').hidden = !entries.length

  // Mobile bottom bar
  const bar = qs('mobileCartBar')
  bar.hidden = !entries.length
  qs('mobileBarCount').textContent = count
  qs('mobileBarTotal').textContent = fmt(total)
  if (!entries.length) closeCartDrawer()
}

// ─── Cart drawer (mobile) ─────────────────────────────────────────────────────
function openCartDrawer() { qs('cartPanel').classList.add('open'); qs('drawerScrim').classList.add('show'); document.body.classList.add('no-scroll') }
function closeCartDrawer() { qs('cartPanel').classList.remove('open'); qs('drawerScrim').classList.remove('show'); document.body.classList.remove('no-scroll') }

// ─── Add / adjust ─────────────────────────────────────────────────────────────
function addToCart(item, mods, qty = 1) {
  const key = cartKey(item.id, mods)
  if (state.cart[key]) state.cart[key].quantity = Math.min(50, state.cart[key].quantity + qty)
  else state.cart[key] = { item, quantity: qty, modifiers: [...mods], unit: unitPriceOf(item, mods) }
  renderCart()
}

function adjustQty(key, delta) {
  const e = state.cart[key]; if (!e) return
  e.quantity += delta
  if (e.quantity <= 0) { delete state.cart[key]; toast(`${e.item.name} removed`, '#6b7280') }
  else if (e.quantity > 50) e.quantity = 50
  renderCart()
}

function clearCart() { state.cart = {}; renderCart() }

// ─── Item Modal ───────────────────────────────────────────────────────────────
function openItemModal(id) {
  const item = state.menu.find((m) => m.id === id)
  if (!item || !item.available) return
  state.modalItem = item; state.modalMods = {}; state.modalQty = 1
  ;(item.modifiers || []).forEach((g) => { if (g.required && g.options.length) state.modalMods[g.name] = [g.options[0].name] })
  renderModal()
  qs('itemModal').classList.remove('hidden')
  qs('itemModal').querySelector('.modal-close').focus()
}
function closeModal() { qs('itemModal').classList.add('hidden'); state.modalItem = null }

function modalExtra() {
  const item = state.modalItem
  return unitPriceOf(item, Object.values(state.modalMods).flat())
}

function renderModal() {
  const item = state.modalItem; if (!item) return
  const unit = modalExtra()
  qs('modalContent').innerHTML = `
    <div class="modal-emoji" aria-hidden="true">${esc(item.image)}</div>
    <h2 class="modal-name" id="modalTitle">${esc(item.name)}</h2>
    <p class="modal-desc">${esc(item.description)}</p>
    <div class="modal-meta">
      ${item.prepTime ? `<div class="meta-chip"><i class="fas fa-clock" aria-hidden="true"></i> ~${item.prepTime} min</div>` : ''}
      ${item.calories ? `<div class="meta-chip"><i class="fas fa-fire" aria-hidden="true"></i> ${item.calories} cal</div>` : ''}
      ${item.allergens?.length ? `<div class="meta-chip warn"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Contains ${esc(item.allergens.join(', '))}</div>` : ''}
    </div>
    ${(item.modifiers || []).map((g, gi) => `
      <fieldset class="modifier-group">
        <legend class="modifier-label">${esc(g.name)}
          ${g.required ? '<span class="req-badge">Required</span>' : '<span class="opt-badge">Optional</span>'}
          ${g.multiple ? '<span class="opt-badge">Pick any</span>' : ''}
        </legend>
        <div class="modifier-options">
          ${g.options.map((opt, oi) => {
            const sel = state.modalMods[g.name]?.includes(opt.name)
            return `<button type="button" class="mod-option ${sel ? 'selected' : ''}" data-g="${gi}" data-o="${oi}" aria-pressed="${!!sel}">
              ${sel ? '<i class="fas fa-check" aria-hidden="true"></i> ' : ''}${esc(opt.name)}${opt.price && !/\$\d/.test(opt.name) ? ` <span class="opt-price">+${fmt(opt.price)}</span>` : ''}</button>`
          }).join('')}
        </div>
      </fieldset>`).join('')}
    <div class="modal-footer">
      <div class="stepper" role="group" aria-label="Quantity">
        <button class="qty-btn lg" data-mqty="-1" aria-label="Decrease quantity" ${state.modalQty <= 1 ? 'disabled' : ''}><i class="fas fa-minus" aria-hidden="true"></i></button>
        <span class="qty-num lg" aria-live="polite">${state.modalQty}</span>
        <button class="qty-btn lg" data-mqty="1" aria-label="Increase quantity"><i class="fas fa-plus" aria-hidden="true"></i></button>
      </div>
      <button class="modal-add-btn" data-action="add-from-modal"><i class="fas fa-plus" aria-hidden="true"></i> Add · ${fmt(unit * state.modalQty)}</button>
    </div>`
}

function toggleMod(gi, oi) {
  const item = state.modalItem; const g = item.modifiers[gi]; const opt = g.options[oi]
  const cur = state.modalMods[g.name] || []
  const idx = cur.indexOf(opt.name)
  if (g.multiple) { if (idx >= 0) cur.splice(idx, 1); else cur.push(opt.name); state.modalMods[g.name] = cur }
  else if (idx >= 0 && !g.required) delete state.modalMods[g.name]      // tap again to un-pick optional single choice
  else state.modalMods[g.name] = [opt.name]
  const scroller = qs('itemModal').querySelector('.modal'); const top = scroller.scrollTop
  renderModal(); scroller.scrollTop = top
  const again = qs('modalContent').querySelector(`[data-g="${gi}"][data-o="${oi}"]`); if (again) again.focus()
}

function addFromModal() {
  const item = state.modalItem; if (!item) return
  const mods = Object.values(state.modalMods).flat()
  addToCart(item, mods, state.modalQty)
  toast(`${state.modalQty > 1 ? state.modalQty + '× ' : ''}${item.name} added`)
  closeModal()
}

function quickAdd(id) {
  const item = state.menu.find((m) => m.id === id)
  if (!item || !item.available) return
  if (item.modifiers?.some((g) => g.required)) { openItemModal(id); return }
  addToCart(item, [])
  toast(`${item.name} added`)
}

// ─── Payment Modal ────────────────────────────────────────────────────────────
function checkout() { if (Object.keys(state.cart).length) { closeCartDrawer(); openPaymentModal() } }

async function openPaymentModal() {
  const { sub, tax, total } = cartTotal()
  const hasSquare = state.squareMode && state.squareAppId
  const hasStripe = state.stripeMode && state.stripePublishableKey

  const tabs = [
    `<button class="pay-tab active" data-method="demo"><i class="fas fa-money-bill-wave" aria-hidden="true"></i> Cash / Demo</button>`,
    hasSquare ? `<button class="pay-tab" data-method="square"><i class="fas fa-credit-card" aria-hidden="true"></i> Card (Square)</button>` : '',
    hasStripe ? `<button class="pay-tab" data-method="stripe"><i class="fas fa-credit-card" aria-hidden="true"></i> Card (Stripe)</button>` : '',
  ].join('')

  qs('payModalContent').innerHTML = `
    <div class="pay-total">
      <div class="lbl">Order total</div>
      <div class="amt">${fmt(total)}</div>
      <div class="brk">${fmt(sub)} + ${fmt(tax)} tax</div>
    </div>
    ${(hasSquare || hasStripe) ? `<div class="pay-tabs" role="tablist" aria-label="Payment method">${tabs}</div>` : ''}
    <div id="panel-demo" class="pay-panel active">
      <div class="pay-note"><i class="fas fa-receipt" aria-hidden="true"></i>
        <p>Pay <strong>cash at the window</strong>, or use this for testing.</p>
        <p class="sm">Your order goes straight to the kitchen.</p></div>
      <button class="pay-submit-btn demo" id="demoPayBtn" data-action="pay-demo"><i class="fas fa-check-circle" aria-hidden="true"></i> Place order</button>
    </div>
    ${hasSquare ? `<div id="panel-square" class="pay-panel">
      <div class="secure"><i class="fas fa-lock" aria-hidden="true"></i> Secure card entry by Square</div>
      <div id="square-card-container" class="card-box"><div class="card-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading secure form…</div></div>
      <div id="squareError" class="pay-error" role="alert" hidden></div>
      <button class="pay-submit-btn square" id="squarePayBtn" data-action="pay-square"><i class="fas fa-lock" aria-hidden="true"></i> Pay ${fmt(total)}</button>
    </div>` : ''}
    ${hasStripe ? `<div id="panel-stripe" class="pay-panel">
      <div class="secure"><i class="fas fa-lock" aria-hidden="true"></i> Secure card entry by Stripe</div>
      <div id="stripe-card-container" class="card-box"><div class="card-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading secure form…</div></div>
      <div id="stripeError" class="pay-error" role="alert" hidden></div>
      <button class="pay-submit-btn stripe" id="stripePayBtn" data-action="pay-stripe"><i class="fas fa-lock" aria-hidden="true"></i> Pay ${fmt(total)}</button>
    </div>` : ''}`

  qs('payModal').classList.remove('hidden')
  qs('payModal').querySelector('.modal-close').focus()
}

function closePayModal() { qs('payModal').classList.add('hidden') }

async function selectPayMethod(btn) {
  const method = btn.dataset.method
  document.querySelectorAll('.pay-tab').forEach((b) => b.classList.toggle('active', b === btn))
  document.querySelectorAll('.pay-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + method))
  // Load the (heavy, third-party) card SDK only when the customer actually picks it.
  if (method === 'square') await mountSquareCard()
  if (method === 'stripe') await mountStripeElements()
}

// ─── Square ───────────────────────────────────────────────────────────────────
async function mountSquareCard() {
  const box = qs('square-card-container'); if (!box || state.squareCard) return
  try {
    const sdk = state.squareAppId.startsWith('sandbox-')
      ? 'https://sandbox.web.squarecdn.com/v1/square.js' : 'https://web.squarecdn.com/v1/square.js'
    await loadScript(sdk)
    if (!state.squarePayments) state.squarePayments = await window.Square.payments(state.squareAppId, state.squareLocationId)
    state.squareCard = await state.squarePayments.card({
      style: {
        '.input-container': { borderColor: '#374151', borderRadius: '8px' },
        '.input-container.is-focused': { borderColor: '#f97316' },
        '.input-container.is-error': { borderColor: '#ef4444' },
        input: { color: '#f9fafb', backgroundColor: '#1f2937' },
      },
    })
    box.innerHTML = ''
    await state.squareCard.attach('#square-card-container')
  } catch (e) {
    console.warn('Square mount failed:', e.message)
    state.squareCard = null
    box.innerHTML = `<div class="pay-error"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Card form unavailable. Check the Square App ID &amp; Location ID in Admin → Settings, or pay cash.</div>`
  }
}

// ─── Stripe ───────────────────────────────────────────────────────────────────
let stripeInstance = null, stripeCardElement = null
async function mountStripeElements() {
  const box = qs('stripe-card-container'); if (!box || stripeCardElement) return
  try {
    await loadScript('https://js.stripe.com/v3/')
    stripeInstance ||= window.Stripe(state.stripePublishableKey)
    const elements = stripeInstance.elements({ appearance: { theme: 'night', variables: { colorPrimary: '#f97316' } } })
    stripeCardElement = elements.create('card', { hidePostalCode: false })
    box.innerHTML = ''
    stripeCardElement.mount('#stripe-card-container')
    stripeCardElement.on('change', (e) => {
      const el = qs('stripeError'); if (!el) return
      el.textContent = e.error ? e.error.message : ''; el.hidden = !e.error
    })
  } catch (e) {
    console.warn('Stripe mount failed:', e.message)
    stripeCardElement = null
    box.innerHTML = `<div class="pay-error"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Card form unavailable. Check the Stripe key in Admin → Settings, or pay cash.</div>`
  }
}

// ─── Submit helpers ───────────────────────────────────────────────────────────
function cartPayload() {
  return {
    customerName: qs('customerName').value.trim() || 'Guest',
    items: Object.values(state.cart).map((e) => ({ id: e.item.id, quantity: e.quantity, modifiers: e.modifiers })),
  }
}
async function postJSON(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}
function busy(btn, label) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ${label}` }
function unbusy(btn) { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label }
function showPayError(id, msg) { const el = qs(id); if (el) { el.textContent = msg; el.hidden = false } else toast(msg, '#ef4444') }

async function payDemo() {
  const btn = qs('demoPayBtn'); busy(btn, 'Placing order…')
  try {
    const data = await postJSON('/api/orders', { ...cartPayload(), channel: 'kiosk' })
    finishOrder(data.order)
  } catch (err) { unbusy(btn); toast(err.message, '#ef4444') }
}

async function paySquare() {
  if (!state.squareCard) return showPayError('squareError', 'Card form is not ready yet.')
  const btn = qs('squarePayBtn'); busy(btn, 'Processing…'); qs('squareError').hidden = true
  try {
    const r = await state.squareCard.tokenize()
    if (r.status !== 'OK') throw new Error(r.errors?.[0]?.message || 'Please check your card details.')
    const data = await postJSON('/api/payments/square-charge', { ...cartPayload(), sourceId: r.token })
    finishOrder(data.order)
  } catch (err) { unbusy(btn); showPayError('squareError', err.message) }
}

async function payStripe() {
  if (!stripeInstance || !stripeCardElement) return showPayError('stripeError', 'Card form is not ready yet.')
  const btn = qs('stripePayBtn'); busy(btn, 'Processing…'); qs('stripeError').hidden = true
  try {
    const p = cartPayload()
    const intent = await postJSON('/api/payments/stripe-online', p)
    const { paymentIntent, error } = await stripeInstance.confirmCardPayment(intent.clientSecret, {
      payment_method: { card: stripeCardElement, billing_details: { name: p.customerName } },
    })
    if (error) throw new Error(error.message)
    if (paymentIntent.status !== 'succeeded') throw new Error('Payment was not completed.')
    const order = await (await fetch('/api/orders/' + intent.orderId)).json()
    finishOrder(order)
  } catch (err) { unbusy(btn); showPayError('stripeError', err.message) }
}

function finishOrder(order) {
  state.cart = {}
  closePayModal(); closeCartDrawer()
  showConfirmation(order)
}

// ─── Confirmation ─────────────────────────────────────────────────────────────
function showConfirmation(order) {
  qs('confirmTicket').textContent = `#${order.ticketNumber}`
  qs('confirmName').textContent = order.customerName && order.customerName !== 'Guest' ? `Thank you, ${order.customerName}!` : 'Order placed!'
  qs('confirmSummary').innerHTML = order.items.map((i) => `<li><span>${i.quantity}× ${esc(i.name)}</span></li>`).join('')
    + `<li class="tot"><span>Total paid</span><span>${fmt(order.total)}</span></li>`
  qs('customerName').value = ''
  renderCart()
  qs('confirmModal').classList.remove('hidden')
  qs('confirmModal').querySelector('[data-action="close-confirm"]').focus()
  clearTimeout(state.confirmTimer)
  state.confirmTimer = setTimeout(closeConfirm, 20000)
}
function closeConfirm() { clearTimeout(state.confirmTimer); qs('confirmModal').classList.add('hidden') }

// ─── Attract mode (idle video loop) ───────────────────────────────────────────
function pokeActivity() { state.lastActivity = Date.now() }

async function startAttract() {
  try { const d = await (await fetch('/api/videos')).json(); state.videos = d.videos || [] } catch { /* keep old list */ }
  if (!state.videos.length) { pokeActivity(); return }
  state.attractOn = true; state.attractIdx = 0
  qs('attract').classList.remove('hidden')
  playAttract()
}
function playAttract() {
  const v = qs('attractVideo'); const list = state.videos; if (!list.length) return stopAttract()
  const cur = list[state.attractIdx % list.length]
  v.loop = list.length === 1
  v.src = cur.url; qs('attractTitle').textContent = cur.title
  v.play().catch(() => {})
}
function stopAttract() {
  state.attractOn = false
  const v = qs('attractVideo'); v.pause(); v.removeAttribute('src'); v.load()
  qs('attract').classList.add('hidden')
  pokeActivity()
}
function idleTick() {
  if (state.attractOn || !state.settings.attractMode) return
  const idleMs = (state.settings.attractIdleSeconds || 60) * 1000
  const idle = Date.now() - state.lastActivity
  const payOpen = !qs('payModal').classList.contains('hidden')
  if (payOpen) return
  const cartEmpty = !Object.keys(state.cart).length
  if (cartEmpty && !anyModalOpen() && idle > idleMs) startAttract()
  else if (!cartEmpty && idle > idleMs * 3) {   // abandoned cart: reset for the next customer
    clearCart(); closeModal(); closeConfirm(); startAttract()
  }
}

// ─── Events (delegated) ───────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  pokeActivity()
  const t = e.target.closest('[data-cat],[data-open],[data-quick],[data-qty],[data-g],[data-mqty],[data-action],.pay-tab,[data-close]')
  if (!t) return
  if (t.dataset.cat) { state.activeCategory = t.dataset.cat; renderCategories(); renderMenu() }
  else if (t.dataset.open) openItemModal(t.dataset.open)
  else if (t.dataset.quick) quickAdd(t.dataset.quick)
  else if (t.dataset.qty) adjustQty(t.dataset.key, +t.dataset.qty)
  else if (t.dataset.g !== undefined) toggleMod(+t.dataset.g, +t.dataset.o)
  else if (t.dataset.mqty) { state.modalQty = Math.max(1, Math.min(50, state.modalQty + +t.dataset.mqty)); renderModal(); const b = qs('modalContent').querySelector(`[data-mqty="${t.dataset.mqty}"]`); if (b && !b.disabled) b.focus() }
  else if (t.classList.contains('pay-tab')) selectPayMethod(t)
  else if (t.dataset.close === 'item') closeModal()
  else if (t.dataset.close === 'pay') closePayModal()
  else switch (t.dataset.action) {
    case 'add-from-modal': addFromModal(); break
    case 'checkout': checkout(); break
    case 'clear': if (confirm('Clear your whole order?')) clearCart(); break
    case 'pay-demo': payDemo(); break
    case 'pay-square': paySquare(); break
    case 'pay-stripe': payStripe(); break
    case 'close-confirm': closeConfirm(); break
    case 'open-cart': openCartDrawer(); break
    case 'close-cart': closeCartDrawer(); break
    case 'reset-filters': state.search = ''; state.activeCategory = 'All'; qs('searchInput').value = ''; renderCategories(); renderMenu(); break
    case 'clear-search': state.search = ''; qs('searchInput').value = ''; qs('clearSearch').hidden = true; renderMenu(); break
  }
})
// Clicking a modal's dark backdrop closes it
document.addEventListener('mousedown', (e) => {
  if (e.target.id === 'itemModal') closeModal()
  else if (e.target.id === 'payModal') closePayModal()
})
document.addEventListener('keydown', (e) => {
  pokeActivity()
  if (state.attractOn) { stopAttract(); return }
  if (e.key === 'Escape') {
    if (!qs('itemModal').classList.contains('hidden')) closeModal()
    else if (!qs('payModal').classList.contains('hidden')) closePayModal()
    else if (!qs('confirmModal').classList.contains('hidden')) closeConfirm()
    else closeCartDrawer()
  }
})
;['pointerdown', 'touchstart', 'scroll', 'input'].forEach((ev) => document.addEventListener(ev, pokeActivity, { passive: true, capture: true }))

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const data = await (await fetch('/api/menu')).json()
    state.menu = data.menu; state.categories = data.categories; state.settings = data.settings || {}
  } catch {
    qs('menuContainer').innerHTML = `<div class="no-results"><i class="fas fa-wifi" aria-hidden="true"></i><p>Couldn’t load the menu.</p><button class="link-btn" onclick="location.reload()">Try again</button></div>`
    return
  }
  const s = state.settings
  state.squareMode = !!s.squareMode; state.squareAppId = s.squareAppId || ''; state.squareLocationId = s.squareLocationId || ''
  state.stripeMode = !!s.stripeMode; state.stripePublishableKey = s.stripePublishableKey || ''

  if (s.businessName) { qs('bizName').textContent = s.businessName; document.title = `${s.businessName} — Order` }
  qs('bizTagline').textContent = s.tagline || ''
  qs('attractOrderBiz').textContent = s.businessName || "Ara's DNA"

  renderCategories(); renderMenu(); renderCart()
  setInterval(idleTick, 1000)
}

// ─── Mount HTML ───────────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <a class="skip-link" href="#menuContainer">Skip to menu</a>
  <header class="kiosk-header">
    <a class="kiosk-logo" href="/" aria-label="Back to home page">
      <span class="icon" aria-hidden="true">🍦</span>
      <div><h1 id="bizName">Ara's DNA</h1><div id="bizTagline" class="tagline"></div></div>
    </a>
    <nav class="header-right" aria-label="Staff links">
      <a href="/admin"><i class="fas fa-gear" aria-hidden="true"></i><span> Admin</span></a>
      <a href="/kds"><i class="fas fa-utensils" aria-hidden="true"></i><span> Kitchen</span></a>
    </nav>
  </header>

  <div class="kiosk-layout">
    <main class="kiosk-menu">
      <div class="search-wrap">
        <i class="fas fa-magnifying-glass search-icon" aria-hidden="true"></i>
        <input type="search" class="search-input" placeholder="Search the menu…" id="searchInput" aria-label="Search the menu" autocomplete="off"
          oninput="state.search=this.value;qs('clearSearch').hidden=!this.value;renderMenu()">
        <button class="search-clear" id="clearSearch" data-action="clear-search" aria-label="Clear search" hidden><i class="fas fa-xmark" aria-hidden="true"></i></button>
      </div>
      <div id="categoryTabs" class="category-tabs" role="toolbar" aria-label="Menu categories"></div>
      <div id="menuContainer" tabindex="-1"><div class="menu-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading menu…</div></div>
    </main>

    <aside class="kiosk-cart" id="cartPanel" aria-label="Your order">
      <div class="cart-header">
        <div><h2><i class="fas fa-basket-shopping" aria-hidden="true"></i> Your order</h2><div id="cartCount" class="order-count">Empty</div></div>
        <button class="drawer-close" data-action="close-cart" aria-label="Close order panel"><i class="fas fa-xmark" aria-hidden="true"></i></button>
      </div>
      <div id="cartItems" class="cart-items"></div>
      <div class="cart-footer">
        <label class="sr-only" for="customerName">Your name</label>
        <input type="text" id="customerName" class="customer-input" placeholder="Name for your order (optional)" maxlength="40" autocomplete="off">
        <div class="totals">
          <div class="total-row"><span>Subtotal</span><span id="subtotalVal">$0.00</span></div>
          <div class="total-row"><span>Tax</span><span id="taxVal">$0.00</span></div>
          <div class="total-row grand"><span>Total</span><span id="totalVal">$0.00</span></div>
        </div>
        <button class="checkout-btn" id="checkoutBtn" data-action="checkout" disabled></button>
        <button class="clear-btn" id="clearBtn" data-action="clear" hidden><i class="fas fa-trash-can" aria-hidden="true"></i> Clear order</button>
      </div>
    </aside>
  </div>

  <div class="drawer-scrim" id="drawerScrim" data-action="close-cart"></div>
  <button class="mobile-cart-bar" id="mobileCartBar" data-action="open-cart" hidden aria-label="View your order">
    <span class="mb-count" id="mobileBarCount">0</span>
    <span class="mb-label">View order</span>
    <span class="mb-total" id="mobileBarTotal">$0.00</span>
  </button>

  <div id="itemModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal">
      <button class="modal-close" data-close="item" aria-label="Close"><i class="fas fa-xmark" aria-hidden="true"></i></button>
      <div id="modalContent"></div>
    </div>
  </div>

  <div id="payModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="payTitle">
    <div class="modal pay-modal">
      <button class="modal-close" data-close="pay" aria-label="Close"><i class="fas fa-xmark" aria-hidden="true"></i></button>
      <h2 id="payTitle" class="pay-title"><i class="fas fa-credit-card" aria-hidden="true"></i> Checkout</h2>
      <div id="payModalContent"></div>
    </div>
  </div>

  <div id="confirmModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="confirmName">
    <div class="modal confirm-modal">
      <div class="confirm-icon" aria-hidden="true">🎉</div>
      <h2 class="confirm-title" id="confirmName">Order placed!</h2>
      <div class="confirm-subtitle">Your ticket number</div>
      <div class="ticket-number" id="confirmTicket">#101</div>
      <ul class="confirm-summary" id="confirmSummary"></ul>
      <p class="confirm-subtitle sm">We’ll call your name when it’s ready.</p>
      <div class="confirm-links">
        <a href="/kds" class="conf-link secondary"><i class="fas fa-tv" aria-hidden="true"></i> Kitchen screen</a>
        <button class="conf-link primary" data-action="close-confirm"><i class="fas fa-plus" aria-hidden="true"></i> New order</button>
      </div>
    </div>
  </div>

  <div id="attract" class="attract hidden" role="button" tabindex="0" aria-label="Touch anywhere to start your order"
       onpointerdown="stopAttract()">
    <video id="attractVideo" muted playsinline preload="auto" onended="state.attractIdx++;playAttract()" onerror="state.attractIdx++;state.videos.length>1?playAttract():stopAttract()"></video>
    <div class="attract-shade"></div>
    <div class="attract-cta">
      <div class="attract-biz" id="attractOrderBiz"></div>
      <div class="attract-touch"><i class="fas fa-hand-pointer" aria-hidden="true"></i> Touch to order</div>
      <div class="attract-title" id="attractTitle"></div>
    </div>
  </div>
`

init()
