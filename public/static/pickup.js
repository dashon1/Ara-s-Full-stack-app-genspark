// Public pickup board: put /pickup on a TV or tablet at the trailer.
const qs = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
let seenReady = new Set(), first = true

document.getElementById('app').innerHTML = `
  <main class="pk">
    <header class="pk-head"><span class="pk-biz" id="pkBiz">Ara's DNA</span><span class="pk-sub">Order pickup</span></header>
    <div id="pkClosed" class="pk-closed" hidden></div>
    <section class="pk-ready" aria-labelledby="rdh">
      <h2 id="rdh"><i class="fas fa-bell-concierge" aria-hidden="true"></i> Ready — come get it!</h2>
      <div id="pkReady" class="pk-grid" aria-live="polite"></div>
    </section>
    <section class="pk-prep" aria-labelledby="pph">
      <h2 id="pph"><i class="fas fa-fire" aria-hidden="true"></i> Being made</h2>
      <div id="pkPrep" class="pk-grid small"></div>
    </section>
    <footer class="pk-foot" id="pkFoot"></footer>
  </main>`

function chip(o, cls) {
  return `<div class="pk-chip ${cls}"><b>#${esc(o.ticket)}</b>${o.name ? `<span>${esc(o.name)}</span>` : ''}</div>`
}
async function tick() {
  try {
    const d = await (await fetch('/api/pickup', { cache: 'no-store' })).json()
    qs('pkBiz').textContent = d.businessName || "Ara's DNA"
    qs('pkFoot').textContent = d.pickupInstructions || ''
    const cl = qs('pkClosed'); cl.hidden = d.open; cl.textContent = d.open ? '' : d.closedMessage
    qs('pkReady').innerHTML = d.ready.length ? d.ready.map((o) => chip(o, 'ready')).join('') : '<p class="pk-empty">Nothing waiting right now</p>'
    qs('pkPrep').innerHTML = d.preparing.length ? d.preparing.map((o) => chip(o, 'prep')).join('') : '<p class="pk-empty">No orders in the queue</p>'
    const now = new Set(d.ready.map((o) => o.ticket))
    if (!first && [...now].some((t) => !seenReady.has(t))) chime()
    seenReady = now; first = false
  } catch { /* keep last screen */ }
}
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[660, 880].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = f; g.gain.setValueAtTime(.25, ctx.currentTime + i * .18); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + i * .18 + .3); o.start(ctx.currentTime + i * .18); o.stop(ctx.currentTime + i * .18 + .3) })
  } catch {}
}
tick(); setInterval(tick, 3000)
