// Customer order tracking page: /track/:id  (works on any phone, no login)
const qs = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = (c) => `$${(c / 100).toFixed(2)}`
const id = decodeURIComponent(location.pathname.split('/').pop() || '')
const STEPS = [['Received', 'fa-receipt'], ['Making it', 'fa-fire'], ['Ready!', 'fa-bell-concierge']]
let lastStatus = null, timer = null

document.getElementById('app').innerHTML = `
  <main class="trk">
    <a class="trk-back" href="/order"><i class="fas fa-arrow-left" aria-hidden="true"></i> Order more</a>
    <div id="trkBody"><div class="trk-card"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading your order…</div></div>
  </main>`

function render(o) {
  const idx = o.status === 'ready' || o.status === 'completed' ? 2 : o.status === 'in_prep' ? 1 : 0
  const bad = o.status === 'refunded' || o.status === 'cancelled'
  let msg
  if (bad) msg = `<p class="trk-msg warn">This order was cancelled. If you were charged, you will be refunded.</p>`
  else if (o.status === 'pending_payment') msg = `<p class="trk-msg warn">Payment hasn’t gone through yet. If you were charged, refresh in a minute.</p>`
  else if (o.status === 'ready') msg = `<p class="trk-msg ready"><strong>Your order is ready!</strong><br>${esc(o.pickupInstructions || '')}</p>`
  else if (o.status === 'completed') msg = `<p class="trk-msg">Picked up. Thanks for stopping by! 🍦</p>`
  else msg = `<p class="trk-msg">${o.ahead > 0 ? `${o.ahead} order${o.ahead === 1 ? '' : 's'} ahead of you.` : 'You’re up next!'} This page updates by itself.</p>`

  qs('trkBody').innerHTML = `
    <div class="trk-card ${o.status === 'ready' ? 'is-ready' : ''}">
      <div class="trk-biz">${esc(o.businessName || "Ara's DNA")}</div>
      <div class="trk-label">Your ticket number</div>
      <div class="trk-ticket">#${esc(o.ticketNumber)}</div>
      ${o.customerName && o.customerName !== 'Guest' ? `<div class="trk-name">${esc(o.customerName)}</div>` : ''}
      ${bad ? '' : `<ol class="trk-steps" aria-label="Order progress">${STEPS.map((s, i) =>
        `<li class="${i < idx || o.status === 'completed' ? 'done' : i === idx ? 'now' : ''}"><i class="fas ${s[1]}" aria-hidden="true"></i><span>${s[0]}</span></li>`).join('')}</ol>`}
      <div role="status" aria-live="polite">${msg}</div>
      <ul class="trk-items">${o.items.map((i) => `<li><span>${i.quantity}× ${esc(i.name)}${i.modifiers?.length ? `<small>${esc(i.modifiers.join(' · '))}</small>` : ''}</span></li>`).join('')}
        <li class="tot"><span>Total paid</span><span>${fmt(o.total)}</span></li></ul>
    </div>`
  if (o.status === 'ready' && lastStatus && lastStatus !== 'ready') { try { navigator.vibrate && navigator.vibrate([300, 150, 300]) } catch {} }
  document.title = o.status === 'ready' ? `✅ #${o.ticketNumber} is ready!` : `#${o.ticketNumber} — Ara's DNA`
  lastStatus = o.status
}

async function tick() {
  try {
    const r = await fetch('/api/orders/' + encodeURIComponent(id), { cache: 'no-store' })
    if (r.status === 404) { qs('trkBody').innerHTML = `<div class="trk-card"><h2>Order not found</h2><p class="trk-msg">Check the link, or <a href="/order">place a new order</a>.</p></div>`; return }
    if (r.ok) { const o = await r.json(); render(o); if (['completed', 'refunded', 'cancelled'].includes(o.status)) return }
  } catch { /* offline blip */ }
  timer = setTimeout(tick, 4000)
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { clearTimeout(timer); tick() } })
tick()
