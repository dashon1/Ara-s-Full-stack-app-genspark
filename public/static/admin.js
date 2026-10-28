// ─── Admin PIN: attach to every /api/admin call; show login on 401 ───────────
let adminPin = sessionStorage.getItem('adminPin') || ''
const _fetch = window.fetch.bind(window)
window.fetch = async (url, opts = {}) => {
  if (typeof url === 'string' && url.startsWith('/api/admin/') && adminPin) {
    opts = { ...opts, headers: { ...(opts.headers || {}), 'x-admin-pin': adminPin } }
  }
  const res = await _fetch(url, opts)
  if (res.status === 401 && typeof url === 'string' && url.startsWith('/api/admin/')) showLogin('Wrong or missing PIN')
  return res
}
function showLogin(msg) {
  const o = document.getElementById('loginOverlay'); if (!o) return
  o.classList.remove('hidden')
  document.getElementById('loginMsg').textContent = msg || ''
  setTimeout(() => document.getElementById('loginPin').focus(), 50)
}
window.submitLogin = async function() {
  const pin = document.getElementById('loginPin').value.trim()
  if (!pin) return
  const r = await _fetch('/api/admin/ping', { headers: { 'x-admin-pin': pin } })
  if (r.ok) {
    adminPin = pin; sessionStorage.setItem('adminPin', pin)
    document.getElementById('loginOverlay').classList.add('hidden')
    document.getElementById('loginPin').value = ''
    bootAdmin()
  } else { document.getElementById('loginMsg').textContent = 'Incorrect PIN'; document.getElementById('loginPin').select() }
}
window.logoutAdmin = function() { sessionStorage.removeItem('adminPin'); adminPin = ''; location.reload() }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  videos: [], caps: { pinRequired: false, uploads: false, storage: false },
  page: 'dashboard',
  orders: [],
  menu: [],
  analytics: {},
  settings: {},
  orderFilter: 'all',
  orderSearch: '',
  salesChart: null,
  itemChart: null,
}

const fmt = (cents) => `$${(cents / 100).toFixed(2)}`
const qs = (id) => document.getElementById(id)

function toast(msg, type = '') {
  let t = document.querySelector('.toast')
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg
  t.className = `toast ${type}`
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 3000)
}

// ─── Navigation ───────────────────────────────────────────────────────────────
window.navigate = function(page) {
  state.page = page
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page)
  })
  document.querySelectorAll('.page-section').forEach(s => {
    s.classList.toggle('active', s.id === `page-${page}`)
  })
  const titles = { dashboard: 'Dashboard', orders: 'Orders', menu: 'Menu Management', videos: 'Videos', analytics: 'Analytics', settings: 'Settings' }
  qs('pageTitle').textContent = titles[page] || page
  qs('backBtn').hidden = page === 'dashboard'
  window.scrollTo(0, 0)
  if (page === 'dashboard') loadDashboard()
  if (page === 'orders') loadOrders()
  if (page === 'menu') loadMenu()
  if (page === 'videos') loadVideos()
  if (page === 'analytics') loadAnalytics()
  if (page === 'settings') loadSettings()
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const [ordersRes, analyticsRes] = await Promise.all([
    fetch('/api/admin/orders'),
    fetch('/api/admin/analytics')
  ])
  const ordersData = await ordersRes.json()
  const analyticsData = await analyticsRes.json()
  state.orders = ordersData.orders || []
  state.analytics = analyticsData

  qs('dashRevenue').textContent = fmt(analyticsData.revenue)
  qs('dashOrders').textContent = analyticsData.totalOrders
  qs('dashAvg').textContent = fmt(analyticsData.avgOrderValue)
  qs('dashRefunds').textContent = analyticsData.refundedOrders

  // Active orders
  const active = state.orders.filter(o => ['paid','queued','in_prep','ready'].includes(o.status))
  qs('activeOrdersCount').textContent = active.length
  renderActiveOrdersList(active.slice(0, 8))
  updateNavBadge(active.length)
}

function renderActiveOrdersList(orders) {
  const el = qs('activeOrdersList')
  if (!orders.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280"><i class="fas fa-check-circle" style="font-size:32px;opacity:0.3"></i><p style="margin-top:10px">No active orders</p></div>'
    return
  }
  el.innerHTML = orders.map(o => `
    <tr>
      <td><strong>#${o.ticketNumber}</strong>${o.priority ? ' <span style="color:#f97316">⚡</span>' : ''}</td>
      <td>${esc(o.customerName || 'Guest')}</td>
      <td>${esc(o.items.map(i => `${i.quantity}× ${i.name}`).join(', '))}</td>
      <td><span class="status-badge status-${o.status}">${o.status.replace('_',' ')}</span></td>
      <td><strong>${fmt(o.total)}</strong></td>
      <td>
        <div class="order-actions">
          <select class="btn btn-secondary btn-sm" onchange="changeStatus('${o.id}',this.value)">
            <option value="">Change...</option>
            <option value="queued">Queued</option>
            <option value="in_prep">In Prep</option>
            <option value="ready">Ready</option>
            <option value="completed">Complete</option>
          </select>
          <button class="btn btn-danger btn-sm" onclick="refundOrder('${o.id}')"><i class="fas fa-undo"></i></button>
        </div>
      </td>
    </tr>
  `).join('')
}

// ─── Orders ───────────────────────────────────────────────────────────────────
async function loadOrders() {
  const res = await fetch('/api/admin/orders')
  const data = await res.json()
  state.orders = data.orders || []
  renderOrdersTable()
}

function renderOrdersTable() {
  let orders = state.orders
  if (state.orderFilter !== 'all') orders = orders.filter(o => o.status === state.orderFilter)
  if (state.orderSearch) {
    const q = state.orderSearch.toLowerCase()
    orders = orders.filter(o =>
      String(o.ticketNumber).includes(q) ||
      (o.customerName || '').toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q)
    )
  }

  qs('ordersCount').textContent = `${orders.length} orders`
  const tbody = qs('ordersTableBody')
  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#6b7280">No orders found</td></tr>`
    return
  }
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td>
        <span class="priority-star" onclick="togglePriority('${o.id}')">${o.priority ? '⚡' : '☆'}</span>
        <strong style="margin-left:4px">#${o.ticketNumber}</strong>
      </td>
      <td>${esc(o.customerName || 'Guest')}</td>
      <td>${esc(o.items.map(i => `${i.quantity}× ${i.name}`).join(', '))}</td>
      <td><span class="status-badge status-${o.status}">${o.status.replace('_',' ')}</span></td>
      <td>${o.channel}</td>
      <td><strong>${fmt(o.total)}</strong></td>
      <td>
        <div class="order-actions">
          <select class="btn btn-secondary btn-sm" onchange="changeStatus('${o.id}',this.value)">
            <option value="">Move...</option>
            <option value="queued">Queued</option>
            <option value="in_prep">In Prep</option>
            <option value="ready">Ready</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancel</option>
          </select>
          <button class="btn btn-danger btn-sm" onclick="refundOrder('${o.id}')">Refund</button>
        </div>
      </td>
    </tr>
  `).join('')
}

window.setFilter = function(filter) {
  state.orderFilter = filter
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter))
  renderOrdersTable()
}

window.searchOrders = function(val) {
  state.orderSearch = val
  renderOrdersTable()
}

// ─── Order Actions ────────────────────────────────────────────────────────────
window.changeStatus = async function(id, status) {
  if (!status) return
  await fetch(`/api/admin/orders/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  })
  toast(`Order status → ${status}`)
  if (state.page === 'orders') loadOrders()
  else loadDashboard()
}

window.refundOrder = async function(id) {
  if (!confirm('Refund this order?')) return
  await fetch(`/api/admin/orders/${id}/refund`, { method: 'POST' })
  toast('Order refunded', 'error')
  if (state.page === 'orders') loadOrders()
  else loadDashboard()
}

window.togglePriority = async function(id) {
  const o = state.orders.find(o => o.id === id)
  if (!o) return
  await fetch(`/api/admin/orders/${id}/priority`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority: !o.priority })
  })
  if (state.page === 'orders') loadOrders()
  else loadDashboard()
}

window.seedOrders = async function() {
  await fetch('/api/admin/seed', { method: 'POST' })
  toast('8 demo orders added!')
  loadDashboard()
}

function updateNavBadge(count) {
  const badge = qs('ordersBadge')
  if (badge) badge.textContent = count || ''
  badge.style.display = count > 0 ? '' : 'none'
}

// ─── Menu ─────────────────────────────────────────────────────────────────────
async function loadMenu() {
  const res = await fetch('/api/admin/menu')
  const data = await res.json()
  state.menu = data.menu || []
  renderMenuList()
}

function renderMenuList() {
  const categories = [...new Set(state.menu.map(i => i.category))]
  const container = qs('menuListContainer')
  container.innerHTML = categories.map(cat => {
    const items = state.menu.filter(i => i.category === cat)
    return `
      <div style="margin-bottom:24px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:10px">${cat}</div>
        <div class="menu-list">
          ${items.map(item => `
            <div class="menu-row">
              <div class="emoji">${item.image}</div>
              <div class="info">
                <div class="name">${item.name}</div>
                <div class="desc">${item.description}</div>
              </div>
              <span class="cat-tag">${item.category}</span>
              <div class="price">${fmt(item.price)}</div>
              <label class="toggle-sw" title="${item.available ? 'Available - click to 86' : 'Sold Out - click to restore'}">
                <input type="checkbox" ${item.available ? 'checked' : ''} onchange="toggleItemAvailable('${item.id}',this.checked)">
                <span class="slider"></span>
              </label>
              <button class="btn btn-secondary btn-sm" onclick="openEditItem('${item.id}')"><i class="fas fa-pen"></i></button>
            </div>
          `).join('')}
        </div>
      </div>
    `
  }).join('')
}

window.toggleItemAvailable = async function(id, available) {
  await fetch(`/api/admin/menu/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ available })
  })
  toast(available ? 'Item available' : 'Item marked sold out')
  state.menu = state.menu.map(i => i.id === id ? { ...i, available } : i)
}

window.openEditItem = function(id) {
  const item = state.menu.find(i => i.id === id)
  if (!item) return
  qs('editItemName').value = item.name
  qs('editItemPrice').value = (item.price / 100).toFixed(2)
  qs('editItemDesc').value = item.description
  qs('editItemImage').value = item.image
  qs('editItemCategory').value = item.category
  qs('editItemCalories').value = item.calories || ''
  qs('editItemPrepTime').value = item.prepTime || 5
  qs('editItemPopular').checked = item.popular
  qs('editItemModal').dataset.itemId = id
  qs('editItemModal').classList.remove('hidden')
}

window.closeEditModal = function() { qs('editItemModal').classList.add('hidden') }

window.saveEditItem = async function() {
  const id = qs('editItemModal').dataset.itemId
  const price = Math.round(parseFloat(qs('editItemPrice').value) * 100)
  const body = {
    name: qs('editItemName').value,
    price,
    description: qs('editItemDesc').value,
    image: qs('editItemImage').value,
    category: qs('editItemCategory').value,
    calories: parseInt(qs('editItemCalories').value) || null,
    prepTime: parseInt(qs('editItemPrepTime').value) || 5,
    popular: qs('editItemPopular').checked,
  }
  await fetch(`/api/admin/menu/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  toast('Item updated!')
  closeEditModal()
  loadMenu()
}

window.openAddItemModal = function() {
  qs('addItemName').value = ''
  qs('addItemPrice').value = ''
  qs('addItemDesc').value = ''
  qs('addItemImage').value = '🍽️'
  qs('addItemCategory').value = 'Mains'
  qs('addItemModal').classList.remove('hidden')
}

window.closeAddModal = function() { qs('addItemModal').classList.add('hidden') }

window.saveNewItem = async function() {
  const price = Math.round(parseFloat(qs('addItemPrice').value) * 100) || 0
  const body = {
    name: qs('addItemName').value,
    price,
    description: qs('addItemDesc').value,
    image: qs('addItemImage').value,
    category: qs('addItemCategory').value,
  }
  if (!body.name) { toast('Name is required', 'error'); return }
  await fetch('/api/admin/menu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  toast('Item added!')
  closeAddModal()
  loadMenu()
}

// ─── Analytics ────────────────────────────────────────────────────────────────
async function loadAnalytics() {
  const res = await fetch('/api/admin/analytics')
  state.analytics = await res.json()
  const a = state.analytics

  qs('analyticsRevenue').textContent = fmt(a.revenue)
  qs('analyticsOrders').textContent = a.totalOrders
  qs('analyticsAvg').textContent = fmt(a.avgOrderValue)
  qs('analyticsCompleted').textContent = a.completedOrders

  // Channel breakdown
  qs('channelKiosk').textContent = a.byChannel?.kiosk || 0
  qs('channelStaff').textContent = a.byChannel?.staff || 0
  qs('channelOnline').textContent = a.byChannel?.online || 0

  // Top items
  qs('topItemsList').innerHTML = (a.topItems || []).map((item, i) => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #374151;font-size:14px">
      <span style="color:#9ca3af">${i + 1}. ${item.name}</span>
      <strong style="color:#f97316">${item.count} sold</strong>
    </div>
  `).join('') || '<div style="color:#6b7280;text-align:center;padding:20px">Place orders to see data</div>'

  // Charts
  renderSalesChart(a.byHour || {})
  renderItemChart(a.topItems || [])
}

function renderSalesChart(byHour) {
  const ctx = qs('salesChart')
  if (!ctx) return
  if (state.salesChart) state.salesChart.destroy()
  const labels = Object.keys(byHour)
  const values = Object.values(byHour).map(v => v / 100)
  state.salesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['No data'],
      datasets: [{
        label: 'Revenue ($)',
        data: values.length ? values : [0],
        backgroundColor: 'rgba(249,115,22,0.6)',
        borderColor: '#f97316',
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af' } },
        x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
      }
    }
  })
}

function renderItemChart(topItems) {
  const ctx = qs('itemChart')
  if (!ctx) return
  if (state.itemChart) state.itemChart.destroy()
  if (!topItems.length) return
  const colors = ['#f97316','#3b82f6','#22c55e','#a855f7','#fbbf24']
  state.itemChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: topItems.map(i => i.name),
      datasets: [{ data: topItems.map(i => i.count), backgroundColor: colors, borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9ca3af', padding: 16, usePointStyle: true } }
      }
    }
  })
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const res = await fetch('/api/admin/settings')
  state.settings = await res.json()
  const s = state.settings
  qs('settBizName').value = s.businessName || ''
  qs('settTagline').value = s.tagline || ''
  qs('settOpHours').value = s.operatingHours || ''
  qs('settTaxRate').value = (s.taxRate * 100).toFixed(1)
  qs('settPhone').value = s.phone || ''
  qs('settStripeMode').checked = s.stripeMode || false
  qs('settStripePk').value = s.stripePublishableKey || ''
  qs('settSquareMode').checked = s.squareMode || false
  qs('settSquareAppId').value = s.squareAppId || ''
  qs('settSquareLocationId').value = s.squareLocationId || ''
  qs('settAttractMode').checked = s.attractMode !== false
  qs('settAttractIdle').value = s.attractIdleSeconds || 60
}

window.saveSettings = async function() {
  const body = {
    businessName: qs('settBizName').value,
    tagline: qs('settTagline').value,
    operatingHours: qs('settOpHours').value,
    taxRate: parseFloat(qs('settTaxRate').value) / 100,
    phone: qs('settPhone').value,
    stripeMode: qs('settStripeMode').checked,
    stripePublishableKey: qs('settStripePk').value.trim(),
    squareMode: qs('settSquareMode').checked,
    squareAppId: qs('settSquareAppId').value.trim(),
    squareLocationId: qs('settSquareLocationId').value.trim(),
    attractMode: qs('settAttractMode').checked,
    attractIdleSeconds: parseInt(qs('settAttractIdle').value, 10) || 60,
  }
  if (!(body.taxRate >= 0)) { toast('Enter a valid tax rate', 'error'); return }
  const res = await fetch('/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (res.ok) toast('Settings saved!'); else toast('Could not save settings', 'error')
}

// ─── Videos ───────────────────────────────────────────────────────────────────
const MAX_MB = 95
const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'

async function loadVideos() {
  try { state.caps = await (await fetch('/api/admin/ping')).json() } catch {}
  const note = qs('videoNotice'); const c = state.caps
  if (!c.storage) note.innerHTML = '<i class="fas fa-triangle-exclamation"></i> <div><strong>Video storage isn’t connected.</strong> Create the R2 bucket and bind it as <code>VIDEOS</code> (see README → Videos), then redeploy.</div>'
  else if (!c.pinRequired) note.innerHTML = '<i class="fas fa-lock"></i> <div><strong>Set an admin PIN to enable uploads.</strong> Run <code>wrangler pages secret put ADMIN_PIN</code> (or add <code>ADMIN_PIN=…</code> to <code>.dev.vars</code> locally). Uploads stay disabled until a PIN exists so strangers can’t fill your storage.</div>'
  else note.innerHTML = ''
  note.hidden = !note.innerHTML
  qs('dropzone').classList.toggle('disabled', !c.uploads)
  qs('videoFile').disabled = !c.uploads
  const res = await fetch('/api/videos'); const data = await res.json()
  state.videos = data.videos || []
  renderVideoList()
}

function renderVideoList() {
  const el = qs('videoList')
  qs('videoCount').textContent = state.videos.length ? `(${state.videos.length})` : ''
  if (!state.videos.length) {
    el.innerHTML = '<div class="empty-state"><i class="fas fa-film"></i><p>No videos yet</p><small>Uploaded videos appear on the homepage and loop on the kiosk when it is idle.</small></div>'
    return
  }
  el.innerHTML = state.videos.map((v) => `
    <div class="video-row">
      <video src="${esc(v.url)}#t=0.5" preload="metadata" muted playsinline controls></video>
      <div class="video-meta">
        <input class="form-input video-title" value="${esc(v.title)}" maxlength="80" aria-label="Video title" onchange="renameVideo('${esc(v.id)}',this.value)">
        <div class="video-sub">${fmtSize(v.size)} · ${new Date(v.uploadedAt).toLocaleDateString()}</div>
        <div class="video-actions">
          <button class="btn btn-sm ${v.featured ? 'btn-primary' : 'btn-secondary'}" onclick="toggleFeatured('${esc(v.id)}',${!v.featured})" title="Plays behind the homepage hero">
            <i class="fas fa-star"></i> ${v.featured ? 'Hero video' : 'Make hero'}</button>
          <button class="btn btn-danger btn-sm" onclick="deleteVideo('${esc(v.id)}')"><i class="fas fa-trash"></i> Delete</button>
        </div>
      </div>
    </div>`).join('')
}

function uploadOne(file, title, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/videos')
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.setRequestHeader('x-video-title', encodeURIComponent(title))
    if (adminPin) xhr.setRequestHeader('x-admin-pin', adminPin)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      let body = {}; try { body = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status === 401) showLogin('Wrong or missing PIN')
      xhr.status >= 200 && xhr.status < 300 ? resolve(body) : reject(new Error(body.error || `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(file)
  })
}

async function handleFiles(fileList) {
  if (!state.caps.uploads) { toast('Uploads are not enabled yet — see the notice above', 'error'); return }
  const files = [...fileList]
  for (const file of files) {
    const okType = ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)
    if (!okType) { toast(`${file.name}: only MP4, WebM or MOV`, 'error'); continue }
    if (file.size > MAX_MB * 1048576) { toast(`${file.name} is ${fmtSize(file.size)} — max is ${MAX_MB} MB. Compress it first.`, 'error'); continue }
    const row = document.createElement('div'); row.className = 'upload-row'
    row.innerHTML = `<div class="u-name">${esc(file.name)}</div><div class="u-bar"><div class="u-fill"></div></div><div class="u-pct">0%</div>`
    qs('uploadQueue').appendChild(row)
    const fill = row.querySelector('.u-fill'), pct = row.querySelector('.u-pct')
    try {
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80)
      await uploadOne(file, title, (f) => { fill.style.width = (f * 100) + '%'; pct.textContent = Math.round(f * 100) + '%' })
      fill.style.width = '100%'; pct.textContent = 'Done'; row.classList.add('ok')
      toast('Video uploaded!')
    } catch (err) {
      row.classList.add('err'); pct.textContent = 'Failed'; row.querySelector('.u-name').insertAdjacentHTML('beforeend', ` — ${esc(err.message)}`)
      toast(err.message, 'error')
    }
  }
  qs('videoFile').value = ''
  loadVideos()
  setTimeout(() => qs('uploadQueue').querySelectorAll('.ok').forEach((r) => r.remove()), 4000)
}

window.renameVideo = async function(id, title) {
  const r = await fetch('/api/admin/videos/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
  toast(r.ok ? 'Title saved' : 'Could not rename', r.ok ? '' : 'error')
}
window.toggleFeatured = async function(id, featured) {
  // Only one hero video at a time
  for (const v of state.videos.filter((v) => v.featured && v.id !== id)) {
    await fetch('/api/admin/videos/' + encodeURIComponent(v.id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ featured: false }) })
  }
  await fetch('/api/admin/videos/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ featured }) })
  toast(featured ? 'Set as homepage hero video' : 'Hero video cleared'); loadVideos()
}
window.deleteVideo = async function(id) {
  const v = state.videos.find((x) => x.id === id)
  if (!confirm(`Delete “${v ? v.title : 'this video'}”? This cannot be undone.`)) return
  const r = await fetch('/api/admin/videos/' + encodeURIComponent(id), { method: 'DELETE' })
  toast(r.ok ? 'Video deleted' : 'Could not delete', r.ok ? '' : 'error'); loadVideos()
}

// ─── Clock ────────────────────────────────────────────────────────────────────
function updateClock() {
  const el = qs('headerTime')
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
setInterval(updateClock, 1000)
updateClock()

// ─── Auto-refresh dashboard ───────────────────────────────────────────────────
setInterval(() => { if (state.page === 'dashboard') loadDashboard() }, 8000)

// ─── Mount HTML ───────────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <div class="sidebar">
    <div class="sidebar-logo">
      <h1>🚚 Trailer <span>Admin</span></h1>
      <div class="sub">Operations Dashboard</div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-group-label">Operations</div>
      <a class="nav-item active" data-page="dashboard" onclick="navigate('dashboard')">
        <span class="nav-icon"><i class="fas fa-tachometer-alt"></i></span> Dashboard
      </a>
      <a class="nav-item" data-page="orders" onclick="navigate('orders')">
        <span class="nav-icon"><i class="fas fa-receipt"></i></span> Orders
        <span class="nav-badge" id="ordersBadge" style="display:none">0</span>
      </a>
      <div class="nav-group-label">Management</div>
      <a class="nav-item" data-page="menu" onclick="navigate('menu')">
        <span class="nav-icon"><i class="fas fa-burger"></i></span> Menu
      </a>
      <a class="nav-item" data-page="videos" onclick="navigate('videos')">
        <span class="nav-icon"><i class="fas fa-film"></i></span> Videos
      </a>
      <a class="nav-item" data-page="analytics" onclick="navigate('analytics')">
        <span class="nav-icon"><i class="fas fa-chart-bar"></i></span> Analytics
      </a>
      <a class="nav-item" data-page="settings" onclick="navigate('settings')">
        <span class="nav-icon"><i class="fas fa-cog"></i></span> Settings
      </a>
    </nav>
    <div class="sidebar-footer">
      <div class="sidebar-links">
        <a href="/" class="sb-link"><i class="fas fa-house"></i> Site</a>
        <a href="/kiosk" class="sb-link"><i class="fas fa-tablet-alt"></i> Kiosk</a>
        <a href="/kds" class="sb-link"><i class="fas fa-tv"></i> KDS</a>
      </div>
      <button class="btn btn-secondary btn-sm" id="logoutBtn" onclick="logoutAdmin()" style="margin:10px 14px 0;width:calc(100% - 28px)" hidden><i class="fas fa-right-from-bracket"></i> Lock</button>
    </div>
  </div>

  <div class="main">
    <div class="main-header">
      <div class="page-title" id="pageTitle">Dashboard</div>
      <div class="header-actions">
        <button class="btn btn-secondary" id="backBtn" onclick="navigate('dashboard')" hidden><i class="fas fa-arrow-left"></i> Dashboard</button>
        <span class="header-time" id="headerTime"></span>
        <button class="btn btn-secondary" onclick="seedOrders()"><i class="fas fa-database"></i> Seed Demo</button>
        <button class="btn btn-primary" onclick="navigate('orders')"><i class="fas fa-list"></i> All Orders</button>
      </div>
    </div>

    <div class="main-content">

      <!-- DASHBOARD PAGE -->
      <div id="page-dashboard" class="page-section active">
        <div class="stats-grid">
          <div class="stat-card green">
            <div class="label"><i class="fas fa-dollar-sign"></i> Revenue Today</div>
            <div class="value" id="dashRevenue">$0.00</div>
            <div class="sub">All paid orders</div>
          </div>
          <div class="stat-card orange">
            <div class="label"><i class="fas fa-receipt"></i> Total Orders</div>
            <div class="value" id="dashOrders">0</div>
            <div class="sub">All channels</div>
          </div>
          <div class="stat-card blue">
            <div class="label"><i class="fas fa-calculator"></i> Avg Order Value</div>
            <div class="value" id="dashAvg">$0.00</div>
            <div class="sub">Per ticket</div>
          </div>
          <div class="stat-card purple">
            <div class="label"><i class="fas fa-undo"></i> Refunds</div>
            <div class="value" id="dashRefunds">0</div>
            <div class="sub">Total refunded</div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span><i class="fas fa-fire" style="color:#f97316"></i> Active Orders (<span id="activeOrdersCount">0</span>)</span>
            <button class="btn btn-secondary btn-sm" onclick="loadDashboard()"><i class="fas fa-sync-alt"></i> Refresh</button>
          </div>
          <div class="table-wrap">
            <table class="order-table">
              <thead>
                <tr>
                  <th>#</th><th>Customer</th><th>Items</th><th>Status</th><th>Total</th><th>Actions</th>
                </tr>
              </thead>
              <tbody id="activeOrdersList"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ORDERS PAGE -->
      <div id="page-orders" class="page-section">
        <div class="card">
          <div class="card-title">
            <span><i class="fas fa-receipt"></i> All Orders <span id="ordersCount" style="color:#9ca3af;font-weight:400"></span></span>
            <button class="btn btn-primary" onclick="loadOrders()"><i class="fas fa-sync-alt"></i> Refresh</button>
          </div>
          <div class="orders-filters">
            <button class="filter-btn active" data-filter="all" onclick="setFilter('all')">All</button>
            <button class="filter-btn" data-filter="paid" onclick="setFilter('paid')">Paid</button>
            <button class="filter-btn" data-filter="queued" onclick="setFilter('queued')">Queued</button>
            <button class="filter-btn" data-filter="in_prep" onclick="setFilter('in_prep')">In Prep</button>
            <button class="filter-btn" data-filter="ready" onclick="setFilter('ready')">Ready</button>
            <button class="filter-btn" data-filter="completed" onclick="setFilter('completed')">Completed</button>
            <button class="filter-btn" data-filter="refunded" onclick="setFilter('refunded')">Refunded</button>
            <input type="text" class="search-bar" placeholder="Search by name or ticket #..." oninput="searchOrders(this.value)">
          </div>
          <div class="table-wrap">
            <table class="order-table">
              <thead>
                <tr>
                  <th>Ticket</th><th>Customer</th><th>Items</th><th>Status</th><th>Channel</th><th>Total</th><th>Actions</th>
                </tr>
              </thead>
              <tbody id="ordersTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- MENU PAGE -->
      <div id="page-menu" class="page-section">
        <div class="card">
          <div class="card-title">
            <span><i class="fas fa-burger"></i> Menu Items</span>
            <button class="btn btn-primary" onclick="openAddItemModal()"><i class="fas fa-plus"></i> Add Item</button>
          </div>
          <p style="font-size:13px;color:#9ca3af;margin-bottom:18px">Toggle items on/off to mark them sold out. Edit prices, descriptions, and details anytime.</p>
          <div id="menuListContainer"></div>
        </div>
      </div>

      <!-- VIDEOS PAGE -->
      <div id="page-videos" class="page-section">
        <div id="videoNotice" class="notice" hidden></div>
        <div class="card">
          <div class="card-title"><span><i class="fas fa-upload" style="color:#f97316"></i> Upload videos</span></div>
          <label class="dropzone" id="dropzone" for="videoFile">
            <i class="fas fa-film"></i>
            <strong>Drag &amp; drop videos here, or click to choose</strong>
            <small>MP4, WebM or MOV · up to 95 MB each · short clips (15–60 s) work best</small>
            <input type="file" id="videoFile" accept="video/mp4,video/webm,video/quicktime" multiple hidden>
          </label>
          <div id="uploadQueue"></div>
        </div>
        <div class="card">
          <div class="card-title"><span><i class="fas fa-photo-film"></i> Your videos <span id="videoCount" style="color:#9ca3af;font-weight:400"></span></span></div>
          <p style="font-size:13px;color:#9ca3af;margin-bottom:16px">Videos show on the public homepage, and loop on the kiosk screen when nobody is using it. Mark one as the <strong>hero</strong> to play silently behind the homepage headline.</p>
          <div id="videoList"></div>
        </div>
      </div>

      <!-- ANALYTICS PAGE -->
      <div id="page-analytics" class="page-section">
        <div class="stats-grid">
          <div class="stat-card green">
            <div class="label">Revenue</div>
            <div class="value" id="analyticsRevenue">$0.00</div>
          </div>
          <div class="stat-card orange">
            <div class="label">Orders</div>
            <div class="value" id="analyticsOrders">0</div>
          </div>
          <div class="stat-card blue">
            <div class="label">Avg Order</div>
            <div class="value" id="analyticsAvg">$0.00</div>
          </div>
          <div class="stat-card purple">
            <div class="label">Completed</div>
            <div class="value" id="analyticsCompleted">0</div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-title"><span><i class="fas fa-chart-bar"></i> Sales by Hour</span></div>
            <div class="chart-wrap"><canvas id="salesChart"></canvas></div>
          </div>
          <div class="card">
            <div class="card-title"><span><i class="fas fa-chart-pie"></i> Top Items</span></div>
            <div class="chart-wrap"><canvas id="itemChart"></canvas></div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-title"><span><i class="fas fa-store"></i> Order Channels</span></div>
            <div style="display:flex;gap:20px;padding:10px 0">
              <div style="text-align:center;flex:1">
                <div style="font-size:32px;font-weight:900;color:#f97316" id="channelKiosk">0</div>
                <div style="font-size:12px;color:#9ca3af;margin-top:4px">Kiosk</div>
              </div>
              <div style="text-align:center;flex:1">
                <div style="font-size:32px;font-weight:900;color:#3b82f6" id="channelStaff">0</div>
                <div style="font-size:12px;color:#9ca3af;margin-top:4px">Staff</div>
              </div>
              <div style="text-align:center;flex:1">
                <div style="font-size:32px;font-weight:900;color:#22c55e" id="channelOnline">0</div>
                <div style="font-size:12px;color:#9ca3af;margin-top:4px">Online</div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-title"><span><i class="fas fa-star"></i> Best Sellers</span></div>
            <div id="topItemsList"></div>
          </div>
        </div>
      </div>

      <!-- SETTINGS PAGE -->
      <div id="page-settings" class="page-section">
        <div class="settings-section">
          <h3><i class="fas fa-store" style="color:#f97316"></i> Business Info</h3>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Business Name</label>
              <input type="text" id="settBizName" class="form-input" placeholder="Street Eats Trailer">
            </div>
            <div class="form-group">
              <label class="form-label">Tagline</label>
              <input type="text" id="settTagline" class="form-input" placeholder="Fresh. Fast. Fired Up.">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Operating Hours</label>
              <input type="text" id="settOpHours" class="form-input" placeholder="11am – 9pm">
            </div>
            <div class="form-group">
              <label class="form-label">Tax Rate (%)</label>
              <input type="number" id="settTaxRate" class="form-input" placeholder="8.0" step="0.1" min="0" max="50">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Phone (shown on the website)</label>
            <input type="tel" id="settPhone" class="form-input" placeholder="813-522-3553">
          </div>
        </div>

        <div class="settings-section">
          <h3><i class="fas fa-film" style="color:#f97316"></i> Kiosk idle screen</h3>
          <p style="font-size:13px;color:#9ca3af;margin-bottom:16px">When nobody touches the kiosk, loop your uploaded videos full-screen with a “Touch to order” prompt. Needs at least one video.</p>
          <div class="form-group" style="display:flex;align-items:center;gap:12px">
            <label class="toggle-sw"><input type="checkbox" id="settAttractMode" aria-label="Enable idle screen"><span class="slider"></span></label>
            <span style="font-size:14px">Play videos when idle</span>
          </div>
          <div class="form-group" style="max-width:260px">
            <label class="form-label">Start after (seconds idle)</label>
            <input type="number" id="settAttractIdle" class="form-input" min="15" max="600" step="5">
          </div>
        </div>

        <div class="settings-section">
          <h3><i class="fas fa-square" style="color:#0d9488"></i> Square — card payments</h3>
          <p style="font-size:13px;color:#9ca3af;margin-bottom:16px">Customers type their card on screen. Find these in the <strong>Square Developer Dashboard → your app → Credentials</strong>. IDs starting with <code>sandbox-</code> use Square’s test mode (no real charges). The secret access token is <em>not</em> entered here — set it as the <code>SQUARE_ACCESS_TOKEN</code> secret.</p>
          <div class="form-group" style="display:flex;align-items:center;gap:12px">
            <label class="toggle-sw"><input type="checkbox" id="settSquareMode" aria-label="Enable Square"><span class="slider"></span></label>
            <span style="font-size:14px">Accept cards with Square</span>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Application ID</label><input type="text" id="settSquareAppId" class="form-input" placeholder="sq0idp-… or sandbox-sq0idb-…" autocomplete="off"></div>
            <div class="form-group"><label class="form-label">Location ID</label><input type="text" id="settSquareLocationId" class="form-input" placeholder="L…" autocomplete="off"></div>
          </div>
        </div>

        <div class="settings-section">
          <h3><i class="fas fa-credit-card" style="color:#6772e5"></i> Stripe</h3>
          <p style="font-size:13px;color:#9ca3af;margin-bottom:16px">Customers type their card on screen. Tap to Pay with an iPhone comes later. The secret key is <em>not</em> entered here — set it as the <code>STRIPE_SECRET_KEY</code> secret.</p>
          <div class="form-group" style="display:flex;align-items:center;gap:12px">
            <label class="toggle-sw">
              <input type="checkbox" id="settStripeMode">
              <span class="slider"></span>
            </label>
            <span style="font-size:14px">Accept cards with Stripe</span>
          </div>
          <div class="form-group">
            <label class="form-label">Stripe Publishable Key (pk_live_... or pk_test_...)</label>
            <input type="text" id="settStripePk" class="form-input" placeholder="pk_test_...">
          </div>
        </div>

        <button class="btn btn-primary" onclick="saveSettings()" style="padding:12px 28px;font-size:15px">
          <i class="fas fa-save"></i> Save Settings
        </button>
      </div>

    </div>
  </div>

  <!-- PIN login -->
  <div id="loginOverlay" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
    <form class="modal-box" style="max-width:360px;text-align:center" onsubmit="event.preventDefault();submitLogin()">
      <h3 id="loginTitle" style="justify-content:center"><i class="fas fa-lock"></i> Staff PIN</h3>
      <p style="color:#9ca3af;font-size:13px;margin-bottom:14px">Enter the admin PIN to continue.</p>
      <input id="loginPin" type="password" inputmode="numeric" autocomplete="current-password" class="form-input" style="text-align:center;font-size:22px;letter-spacing:6px" aria-label="Admin PIN">
      <div id="loginMsg" role="alert" style="color:#fca5a5;font-size:13px;min-height:20px;margin:8px 0"></div>
      <button class="btn btn-primary" type="submit" style="width:100%;padding:12px">Unlock</button>
    </form>
  </div>

  <!-- Edit Item Modal -->
  <div id="editItemModal" class="modal-overlay hidden" onclick="if(event.target===this)closeEditModal()">
    <div class="modal-box">
      <button class="modal-close-btn" onclick="closeEditModal()"><i class="fas fa-times"></i></button>
      <h3><i class="fas fa-pen"></i> Edit Menu Item</h3>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Name</label><input type="text" id="editItemName" class="form-input"></div>
        <div class="form-group"><label class="form-label">Price ($)</label><input type="number" id="editItemPrice" class="form-input" step="0.01"></div>
      </div>
      <div class="form-group"><label class="form-label">Description</label><input type="text" id="editItemDesc" class="form-input"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Emoji/Image</label><input type="text" id="editItemImage" class="form-input" placeholder="🍔"></div>
        <div class="form-group"><label class="form-label">Category</label><input type="text" id="editItemCategory" class="form-input" placeholder="Burgers"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Calories</label><input type="number" id="editItemCalories" class="form-input"></div>
        <div class="form-group"><label class="form-label">Prep Time (min)</label><input type="number" id="editItemPrepTime" class="form-input"></div>
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="editItemPopular" style="width:18px;height:18px;accent-color:#f97316">
        <label for="editItemPopular" style="font-size:14px">Mark as Popular ⭐</label>
      </div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn btn-primary" onclick="saveEditItem()" style="flex:1">Save Changes</button>
        <button class="btn btn-secondary" onclick="closeEditModal()">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Add Item Modal -->
  <div id="addItemModal" class="modal-overlay hidden" onclick="if(event.target===this)closeAddModal()">
    <div class="modal-box">
      <button class="modal-close-btn" onclick="closeAddModal()"><i class="fas fa-times"></i></button>
      <h3><i class="fas fa-plus"></i> Add Menu Item</h3>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Name *</label><input type="text" id="addItemName" class="form-input" placeholder="New Item"></div>
        <div class="form-group"><label class="form-label">Price ($) *</label><input type="number" id="addItemPrice" class="form-input" step="0.01" placeholder="0.00"></div>
      </div>
      <div class="form-group"><label class="form-label">Description</label><input type="text" id="addItemDesc" class="form-input" placeholder="What's in it?"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Emoji</label><input type="text" id="addItemImage" class="form-input" value="🍽️"></div>
        <div class="form-group"><label class="form-label">Category</label><input type="text" id="addItemCategory" class="form-input" value="Mains"></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn btn-primary" onclick="saveNewItem()" style="flex:1"><i class="fas fa-plus"></i> Add Item</button>
        <button class="btn btn-secondary" onclick="closeAddModal()">Cancel</button>
      </div>
    </div>
  </div>
`

// Dropzone wiring
const dz = qs('dropzone')
dz.addEventListener('dragover', (e) => { e.preventDefault(); if (state.caps.uploads) dz.classList.add('over') })
dz.addEventListener('dragleave', () => dz.classList.remove('over'))
dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); handleFiles(e.dataTransfer.files) })
qs('videoFile').addEventListener('change', (e) => handleFiles(e.target.files))
dz.addEventListener('click', (e) => { if (!state.caps.uploads) { e.preventDefault(); toast('Uploads are not enabled yet — see the notice above', 'error') } })

// Initialize: find out whether a PIN is needed before loading anything
async function bootAdmin() {
  try {
    const r = await _fetch('/api/admin/ping', { headers: adminPin ? { 'x-admin-pin': adminPin } : {} })
    if (r.status === 401) { showLogin(adminPin ? 'Wrong or missing PIN' : ''); return }
    state.caps = await r.json()
    qs('logoutBtn').hidden = !state.caps.pinRequired
  } catch {}
  navigate(state.page || 'dashboard')
}
bootAdmin()
