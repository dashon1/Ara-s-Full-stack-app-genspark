function escH(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  orders: [],
  lastIds: new Set(),
  soundOn: true,
  showDone: false,
  pollInterval: null,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (cents) => `$${(cents / 100).toFixed(2)}`
const qs = (id) => document.getElementById(id)

function elapsed(iso) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function elapsedMins(iso) {
  return (Date.now() - new Date(iso).getTime()) / 60000
}

function timeClass(iso) {
  const m = elapsedMins(iso)
  if (m > 15) return 'danger'
  if (m > 8) return 'warn'
  return ''
}

function playBeep() {
  if (!state.soundOn) return
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch (e) {}
}

function playAlert() {
  if (!state.soundOn) return
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[0, 0.15, 0.3].forEach(delay => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 440
      gain.gain.setValueAtTime(0.2, ctx.currentTime + delay)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.15)
      osc.start(ctx.currentTime + delay)
      osc.stop(ctx.currentTime + delay + 0.15)
    })
  } catch (e) {}
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function fetchOrders() {
  const res = await fetch('/api/kds')
  const data = await res.json()
  const newOrders = data.orders || []

  // Detect new arrivals
  const newIds = new Set(newOrders.map(o => o.id))
  newOrders.forEach(o => {
    if (!state.lastIds.has(o.id) && o.status === 'paid') {
      playBeep()
      showAlert(`New order #${o.ticketNumber} arrived!`)
    }
  })
  state.lastIds = newIds
  state.orders = newOrders
  renderKDS()
}

async function updateStatus(id, status) {
  await fetch(`/api/kds/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  })
  if (status === 'ready') playAlert()
  await fetchOrders()
}

async function togglePriority(id) {
  const order = state.orders.find(o => o.id === id)
  if (!order) return
  await fetch(`/api/admin/orders/${id}/priority`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority: !order.priority })
  })
  await fetchOrders()
}

function showAlert(msg) {
  const existing = document.querySelector('.kds-alert')
  if (existing) existing.remove()
  const div = document.createElement('div')
  div.className = 'kds-alert'
  div.innerHTML = `<i class="fas fa-bell"></i> ${msg}`
  document.body.appendChild(div)
  setTimeout(() => div.remove(), 4000)
}

// ─── Render ──────────────────────────────────────────────────────────────────
function renderKDS() {
  const queued = state.orders.filter(o => o.status === 'paid' || o.status === 'queued')
  const inPrep = state.orders.filter(o => o.status === 'in_prep')
  const ready = state.orders.filter(o => o.status === 'ready')

  // Fetch done from admin if needed
  const done = [] // We only show active orders in KDS; done handled separately

  // Stats
  qs('statNew').textContent = queued.length
  qs('statPrep').textContent = inPrep.length
  qs('statReady').textContent = ready.length
  qs('statTotal').textContent = state.orders.length
  qs('queuedCount').textContent = queued.length
  qs('prepCount').textContent = inPrep.length
  qs('readyCount').textContent = ready.length

  // Render columns
  renderColumn('queuedCol', queued, [
    { label: '<i class="fas fa-fire"></i> Start', cls: 'start', action: (id) => updateStatus(id, 'in_prep') }
  ])
  renderColumn('prepCol', inPrep, [
    { label: '<i class="fas fa-check"></i> Mark Ready', cls: 'ready', action: (id) => updateStatus(id, 'ready') },
    { label: '<i class="fas fa-arrow-left"></i>', cls: 'back', action: (id) => updateStatus(id, 'queued') }
  ])
  renderColumn('readyCol', ready, [
    { label: '<i class="fas fa-handshake"></i> Complete', cls: 'done', action: (id) => updateStatus(id, 'completed') }
  ])

  // Pickup board
  renderPickupBoard(ready)
}

function renderColumn(colId, orders, actions) {
  const col = qs(colId)
  if (!col) return
  if (!orders.length) {
    col.innerHTML = `<div class="col-empty"><div class="empty-ico"><i class="fas fa-check-circle"></i></div><p>All clear</p></div>`
    return
  }
  // Sort: priority first, then oldest first
  const sorted = [...orders].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1
    return new Date(a.createdAt) - new Date(b.createdAt)
  })
  col.innerHTML = sorted.map(o => renderTicket(o, actions)).join('')
}

function renderTicket(o, actions) {
  const mins = elapsedMins(o.createdAt)
  const cls = timeClass(o.createdAt)
  return `
    <div class="ticket ${o.priority ? 'priority' : ''}" id="ticket-${o.id}">
      <div class="ticket-top">
        <div>
          <div class="ticket-num"><span>#</span>${o.ticketNumber}</div>
          <div class="ticket-name">${escH(o.customerName || 'Guest')}</div>
          <span class="ticket-channel">${o.channel}</span>
        </div>
        <div class="ticket-meta">
          <div class="ticket-time ${cls}"><i class="fas fa-clock"></i> ${elapsed(o.createdAt)}</div>
          <div style="margin-top:4px;color:#6b7280">${fmt(o.total)}</div>
          ${o.priority ? '<div style="color:#f97316;font-weight:800;font-size:11px;margin-top:2px">⚡ PRIORITY</div>' : ''}
        </div>
      </div>
      <div class="ticket-items">
        ${o.items.map(i => `
          <div class="ticket-item">
            <div><span class="qty">${i.quantity}x</span>${escH(i.name)}${i.modifiers?.length ? `<div class="mods">${escH(i.modifiers.join(', '))}</div>` : ''}</div>
          </div>
        `).join('')}
        ${o.notes ? `<div style="margin-top:6px;font-size:11px;color:#f97316;font-style:italic"><i class="fas fa-sticky-note"></i> ${escH(o.notes)}</div>` : ''}
      </div>
      <div class="ticket-actions">
        ${actions.map(a => `<button class="tick-btn ${a.cls}" onclick="handleTicketAction('${o.id}','${a.cls}')">${a.label}</button>`).join('')}
        <button class="tick-btn priority-btn ${o.priority ? 'active' : ''}" onclick="togglePriority('${o.id}')">⚡</button>
      </div>
    </div>
  `
}

window.handleTicketAction = function(id, cls) {
  const map = { start: 'in_prep', ready: 'ready', done: 'completed', back: 'queued' }
  if (map[cls]) updateStatus(id, map[cls])
}

function renderPickupBoard(readyOrders) {
  const board = qs('pickupBoard')
  if (!board) return
  if (!readyOrders.length) {
    board.style.display = 'none'
    return
  }
  board.style.display = 'flex'
  qs('pickupNumbers').innerHTML = readyOrders.map(o =>
    `<div class="pickup-num">#${o.ticketNumber}</div>`
  ).join('')
}

// ─── Mount + Start ────────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <div class="kds-header">
    <div class="kds-title">
      <div class="dot"></div>
      <h1>🍳 Kitchen Display</h1>
    </div>
    <div class="kds-stats">
      <div class="stat-chip"><span style="color:#fbbf24"><i class="fas fa-inbox"></i></span><span id="statNew" class="stat-val">0</span> New</div>
      <div class="stat-chip"><span style="color:#3b82f6"><i class="fas fa-fire"></i></span><span id="statPrep" class="stat-val">0</span> Prep</div>
      <div class="stat-chip"><span style="color:#22c55e"><i class="fas fa-check"></i></span><span id="statReady" class="stat-val">0</span> Ready</div>
      <div class="stat-chip"><i class="fas fa-list"></i><span id="statTotal" class="stat-val">0</span> Active</div>
    </div>
    <div class="kds-controls">
      <button id="soundBtn" class="sound-btn on" onclick="toggleSound()"><i class="fas fa-volume-up"></i> Sound</button>
      <button class="ctrl-btn" onclick="fetchOrders()"><i class="fas fa-sync-alt"></i> Refresh</button>
      <a href="/kiosk" class="ctrl-btn" style="text-decoration:none"><i class="fas fa-tablet-alt"></i> Kiosk</a>
      <a href="/admin" class="ctrl-btn" style="text-decoration:none"><i class="fas fa-cog"></i> Admin</a>
    </div>
  </div>

  <div class="kds-body">
    <div class="kds-col">
      <div class="col-header queued"><span><i class="fas fa-inbox"></i> New / Queued</span><span class="col-count" id="queuedCount">0</span></div>
      <div class="col-tickets" id="queuedCol"></div>
    </div>
    <div class="kds-col">
      <div class="col-header in-prep"><span><i class="fas fa-fire"></i> In Prep</span><span class="col-count" id="prepCount">0</span></div>
      <div class="col-tickets" id="prepCol"></div>
    </div>
    <div class="kds-col">
      <div class="col-header ready"><span><i class="fas fa-check-circle"></i> Ready for Pickup</span><span class="col-count" id="readyCount">0</span></div>
      <div class="col-tickets" id="readyCol"></div>
    </div>
  </div>

  <div class="pickup-board" id="pickupBoard" style="display:none">
    <div class="pickup-label"><i class="fas fa-bell"></i> Now Ready:</div>
    <div class="pickup-numbers" id="pickupNumbers"></div>
  </div>
`

window.toggleSound = function() {
  state.soundOn = !state.soundOn
  const btn = qs('soundBtn')
  btn.className = state.soundOn ? 'sound-btn on' : 'sound-btn'
  btn.innerHTML = state.soundOn ? '<i class="fas fa-volume-up"></i> Sound' : '<i class="fas fa-volume-mute"></i> Muted'
}

// Initial load + auto-refresh every 3s
fetchOrders()
setInterval(fetchOrders, 3000)

// Update elapsed times every 15s
setInterval(() => {
  if (state.orders.length) renderKDS()
}, 15000)
