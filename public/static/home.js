// Public homepage — menu preview, video gallery, visit info.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = (cents) => `$${(cents / 100).toFixed(2)}`
const $ = (id) => document.getElementById(id)

document.getElementById('app').innerHTML = `
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/" aria-label="Ara's DNA home"><span aria-hidden="true">🍦</span> Ara's <span>DNA</span></a>
    <nav class="nav" aria-label="Main">
      <a href="#menu">Menu</a>
      <a href="#videos">Videos</a>
      <a href="#visit">Visit</a>
      <a class="nav-admin" href="/admin"><i class="fas fa-lock" aria-hidden="true"></i> Admin</a>
      <a class="btn btn-primary" href="/order"><i class="fas fa-bag-shopping" aria-hidden="true"></i> Order now</a>
    </nav>
  </div>
</header>

<main id="main">
  <section class="hero" id="hero" aria-labelledby="hero-title">
    <video class="hero-video" id="heroVideo" muted loop playsinline preload="metadata" aria-hidden="true" hidden></video>
    <div class="wrap">
      <div class="hero-inner">
        <div class="eyebrow"><i class="fas fa-truck" aria-hidden="true"></i> Food trailer · Fresh daily</div>
        <h1 id="hero-title">Hand-crafted <em>ice cream</em>, Island Ice &amp; hot dogs.</h1>
        <p class="lead" id="heroTagline">Old-fashioned ice cream, premium Italian ice, all-beef dogs and fresh lemonade — made with love.</p>
        <div class="hero-cta">
          <a class="btn btn-primary" href="/order"><i class="fas fa-bag-shopping" aria-hidden="true"></i> Start your order</a>
          <a class="btn btn-ghost" href="#videos"><i class="fas fa-circle-play" aria-hidden="true"></i> Watch videos</a>
        </div>
        <div class="hero-meta">
          <span id="heroHours"><i class="fas fa-clock" aria-hidden="true"></i> <span></span></span>
          <a id="heroPhone" href="tel:" hidden><i class="fas fa-phone" aria-hidden="true"></i> <span></span></a>
        </div>
      </div>
    </div>
  </section>

  <section id="popular" aria-labelledby="pop-title">
    <div class="wrap">
      <div class="section-head"><h2 id="pop-title">Crowd favorites</h2><p>The things people come back for.</p></div>
      <div class="pop-grid" id="popGrid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
    </div>
  </section>

  <section id="menu" aria-labelledby="menu-title">
    <div class="wrap">
      <div class="section-head"><h2 id="menu-title">The menu</h2><p>Starting prices — pick sizes and flavors when you order.</p></div>
      <div class="menu-cols" id="menuCols"></div>
    </div>
  </section>

  <section id="videos" class="videos" aria-labelledby="vid-title">
    <div class="wrap">
      <div class="section-head"><h2 id="vid-title">See us in action</h2><p>Behind the trailer, fresh scoops and good times.</p></div>
      <div class="video-grid" id="videoGrid"><div class="skeleton"></div><div class="skeleton"></div></div>
    </div>
  </section>

  <section id="visit" aria-labelledby="visit-title">
    <div class="wrap">
      <div class="section-head"><h2 id="visit-title">Come say hi</h2></div>
      <div class="visit-grid">
        <div class="visit-card"><i class="fas fa-clock" aria-hidden="true"></i><h3>Hours</h3><p id="visitHours">—</p></div>
        <div class="visit-card"><i class="fas fa-phone" aria-hidden="true"></i><h3>Call us</h3><p id="visitPhone">—</p></div>
        <div class="visit-card"><i class="fas fa-bag-shopping" aria-hidden="true"></i><h3>Order ahead</h3><p><a href="/order">Order online</a> or at the trailer kiosk — pay by card, track your order live, and pick up when your name shows on the <a href="/pickup">pickup board</a>.</p></div>
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="wrap">
    <span>&copy; <span id="year"></span> <span id="footName">Ara's DNA</span></span>
    <span><a href="/order">Order online</a><a href="/pickup">Pickup board</a><a href="/kds">Kitchen</a><a href="/admin">Admin</a></span>
  </div>
</footer>

<dialog class="lightbox" id="lightbox" aria-label="Video player">
  <div class="lightbox-box">
    <button class="close" id="lbClose" aria-label="Close video"><i class="fas fa-xmark" aria-hidden="true"></i></button>
    <video id="lbVideo" controls playsinline></video>
    <h3 id="lbTitle"></h3>
  </div>
</dialog>
`

$('year').textContent = new Date().getFullYear()

function renderSettings(s) {
  if (!s) return
  if (s.businessName) { $('footName').textContent = s.businessName; document.title = `${s.businessName} — Ice Cream, Island Ice & Hot Dogs` }
  if (s.tagline) $('heroTagline').textContent = s.tagline
  const hours = s.operatingHours || ''
  $('heroHours').querySelector('span').textContent = hours
  $('heroHours').hidden = !hours
  $('visitHours').textContent = hours || 'Check back soon'
  if (s.phone) {
    const tel = String(s.phone).replace(/[^\d+]/g, '')
    const a = $('heroPhone'); a.href = `tel:${tel}`; a.hidden = false; a.querySelector('span').textContent = s.phone
    $('visitPhone').innerHTML = `<a href="tel:${esc(tel)}">${esc(s.phone)}</a>`
  }
}

function renderMenu(menu) {
  const pops = menu.filter((m) => m.popular && m.available)
  $('popGrid').innerHTML = pops.length
    ? pops.map((m) => `
      <article class="pop-card">
        <span class="emoji" aria-hidden="true">${esc(m.image)}</span>
        <h3>${esc(m.name)}</h3>
        <p>${esc(m.description)}</p>
        <div class="price">${m.modifiers?.some((g) => g.required && g.options.some((o) => o.price > 0)) ? 'from ' : ''}${fmt(m.price)}</div>
      </article>`).join('')
    : '<div class="empty"><i class="fas fa-ice-cream" aria-hidden="true"></i>Menu coming soon.</div>'

  const cats = [...new Set(menu.map((m) => m.category))]
  $('menuCols').innerHTML = cats.map((cat) => `
    <div class="menu-cat"><h3>${esc(cat)}</h3>
      ${menu.filter((m) => m.category === cat).map((m) => `
        <div class="menu-row ${m.available ? '' : 'sold'}">
          <span class="n">${esc(m.name)}${m.available ? '' : ' <small>(sold out)</small>'}</span>
          <span class="p">${fmt(m.price)}</span>
        </div>`).join('')}
    </div>`).join('')
}

function renderVideos(data) {
  const grid = $('videoGrid')
  const vids = data?.videos || []
  if (!vids.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><i class="fas fa-film" aria-hidden="true"></i>
      Videos are coming soon. Check back for a peek inside the trailer!</div>`
    return
  }
  grid.innerHTML = vids.map((v, i) => `
    <button class="video-card" data-i="${i}" aria-label="Play video: ${esc(v.title)}">
      <video src="${esc(v.url)}#t=0.5" preload="metadata" muted playsinline tabindex="-1"></video>
      <span class="play" aria-hidden="true"><i class="fas fa-play"></i></span>
      <div class="cap">${esc(v.title)}</div>
    </button>`).join('')

  const dlg = $('lightbox'), player = $('lbVideo')
  const close = () => { player.pause(); player.removeAttribute('src'); player.load(); if (dlg.open) dlg.close() }
  grid.querySelectorAll('.video-card').forEach((btn) => btn.addEventListener('click', () => {
    const v = vids[+btn.dataset.i]
    player.src = v.url; $('lbTitle').textContent = v.title
    dlg.showModal(); player.play().catch(() => {})
  }))
  $('lbClose').addEventListener('click', close)
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
  dlg.addEventListener('close', () => { player.pause() })

  // Featured (or newest) video plays silently behind the hero, unless the visitor prefers reduced motion.
  const hero = vids.find((v) => v.featured) || vids[0]
  if (hero && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const hv = $('heroVideo'); hv.src = hero.url; hv.hidden = false
    hv.play().catch(() => { hv.hidden = true })
  }
}

Promise.allSettled([fetch('/api/menu').then((r) => r.json()), fetch('/api/videos').then((r) => r.json())]).then(([m, v]) => {
  if (m.status === 'fulfilled') { renderSettings(m.value.settings); renderMenu(m.value.menu) }
  else { $('popGrid').innerHTML = '<div class="empty">Could not load the menu. Please refresh.</div>' }
  renderVideos(v.status === 'fulfilled' ? v.value : null)
})
