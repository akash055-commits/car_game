// DOM interface: loader / start card, HUD (activity panel, embers + coins, context prompt,
// speedometer / altimeter, toolbar), toasts, now-playing card, activities menu and settings.
import { formatTime } from '../gameplay/Circuit.js'
import { ACTIVITY_INFO } from '../gameplay/Activities.js'

const svg = (path, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`

export const ICONS = {
  autumn: svg('<path d="M12 21v-6"/><path d="M12 15c-4 0-7-3-7-7 2 0 3 1 4 2 0-3 1-5 3-7 2 2 3 4 3 7 1-1 2-2 4-2 0 4-3 7-7 7z"/>'),
  spring: svg('<circle cx="12" cy="12" r="2.2"/><path d="M12 9.8c-1.5-3.5 1.5-6 0-6.8-1.5.8 1.5 3.3 0 6.8zM14.1 11.3c3-2.3 5.9.1 6.3-1.6-1.2-1.2-3.4 2-6.3 1.6zM13.3 14c1.1 3.6-1.7 6 .1 6.6 1.1-1.3-2.4-3.2-.1-6.6zM10.7 14c-2.3 3-5.8 1.6-5.7 3.4 1.6.5 3-3.1 5.7-3.4zM9.9 11.3c-3.6-.8-3.8-4.6-5.4-3.6.1 1.7 3.9.9 5.4 3.6z"/>'),
  monsoon: svg('<path d="M7 15a4 4 0 1 1 .9-7.9A5 5 0 0 1 17.6 8 3.5 3.5 0 0 1 17 15z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  camera: svg('<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.3l1.4-2h7.6l1.4 2h2.3A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.5"/>'),
  music: svg('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  sound: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  mute: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  ember: svg('<path d="M12 2.5l2.4 6.1 6.1 2.4-6.1 2.4L12 19.5l-2.4-6.1L3.5 11l6.1-2.4z" fill="currentColor" stroke="none"/><circle cx="18.5" cy="18.5" r="1.6" fill="currentColor" stroke="none"/>'),
  boost: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  drift: svg('<path d="M4 16c4 0 4-8 8-8s4 8 8 8"/><path d="M4 20h16"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  coin: svg('<circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none" opacity=".9"/><path d="M12 7.5v9M14.5 9.5c-.6-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9-1.1 0-2-.4-2.6-1.2" stroke="#fff8ee"/>'),
}

// When the game is published inside a website (e.g. /games/seasons-valley/), offer a way home
const HOME_LINK = typeof location !== 'undefined' && location.pathname.includes('/games/')
  ? `<a class="home-link" href="/">← Back to portfolio</a>`
  : ''

const LOGO = `<svg class="brand-mark" viewBox="0 0 80 80" aria-hidden="true">
  <circle cx="40" cy="40" r="38" fill="#fff8ee"/>
  <path d="M10 52c8-6 14-8 22-5s14 2 20-3 12-6 18-2v10c0 10-12 18-30 18S10 62 10 52z" fill="#e8742c"/>
  <path d="M10 56c10-4 18-2 26 1s16 1 22-3 10-4 12-2v6C66 66 54 72 40 72S14 66 10 56z" fill="#b5551f"/>
  <circle cx="54" cy="26" r="9" fill="#ffc04d"/>
  <path d="M24 44V31M24 31c-6 0-9-4-9-9 3 0 5 1 6 3 0-4 1-7 3-9 2 2 3 5 3 9 1-2 3-3 6-3 0 5-3 9-9 9z" fill="#cc3526" stroke="#5a3424" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`

export class UI {
  constructor() {
    this.root = document.createElement('div')
    this.root.id = 'ui'
    document.body.appendChild(this.root)
    this.handlers = {}
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    this.buildLoader()
    this.buildHud()
    this.lastHud = 0
  }

  on(name, fn) {
    this.handlers[name] = fn
  }

  fire(name, ...a) {
    if (this.handlers[name]) return this.handlers[name](...a)
  }

  // ------------------------------------------------------------ Loader
  buildLoader() {
    const el = document.createElement('div')
    el.className = 'loader'
    el.innerHTML = `
      <div class="loader-card">
        ${LOGO}
        <h1>Seasons Valley</h1>
        <p class="tagline">A living little town to drive, ride, fly &amp; wander · autumn, spring &amp; monsoon</p>
        <div class="progress"><div></div></div>
        <div class="status">Preparing…</div>
        <button class="start-btn hidden" type="button">Start exploring</button>
        <div class="legend">
          ${this.isTouch
            ? '<span>Joystick to drive &amp; walk</span><span>Tap the prompt to get in / out</span><span>Drag to look around</span>'
            : `<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive / walk</span>
               <span><kbd>F</kbd> get in / out</span><span><kbd>Space</kbd> drift / jump</span><span><kbd>Shift</kbd> boost / run</span>
               <span><kbd>J</kbd> activities</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> seasons</span><span><kbd>N</kbd> night</span>`}
        </div>
        <div class="credits">Best with sound on · Music: “Sudo”, “Boy”, “Baguira” (CC0) via Bruno Simon</div>
        ${HOME_LINK}
      </div>`
    this.root.appendChild(el)
    this.loader = el
    this.bar = el.querySelector('.progress > div')
    this.status = el.querySelector('.status')
    this.startBtn = el.querySelector('.start-btn')
    this.startBtn.addEventListener('click', () => this.fire('start'))
  }

  progress(p, label) {
    this.bar.style.width = `${Math.round(p * 100)}%`
    if (label) this.status.textContent = label
  }

  ready() {
    this.status.textContent = 'The valley is ready'
    this.el(this.loader, '.progress').classList.add('hidden')
    this.startBtn.classList.remove('hidden')
    this.startBtn.focus()
    const onKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        window.removeEventListener('keydown', onKey)
        this.fire('start')
      }
    }
    window.addEventListener('keydown', onKey)
  }

  hideLoader() {
    this.loader.classList.add('fade')
    this.hud.classList.add('show')
    setTimeout(() => this.loader.remove(), 1000)
    setTimeout(() => this.hint && this.hint.classList.add('dim'), 14000)
  }

  el(root, sel) {
    return root.querySelector(sel)
  }

  // ------------------------------------------------------------ HUD
  buildHud() {
    const hud = document.createElement('div')
    hud.className = 'hud'
    const R = 62, C = 2 * Math.PI * R, ARC = 0.75
    this.arc = { C, ARC }
    hud.innerHTML = `
      <div class="panel lap activity hidden">
        <div class="label"><span class="act-name">Town Courier</span><span class="act-step"></span></div>
        <div class="act-goal">—</div>
        <div class="time act-time">0:00</div>
        <div class="act-bar"><i></i></div>
        <div class="rows"><b>EARNED</b><span class="act-coins">0</span></div>
      </div>
      <div class="pills">
        <div class="panel embers" title="Embers found">${ICONS.ember}<span class="n">0</span><span class="of">/ 25</span></div>
        <div class="panel coins" title="Coins">${ICONS.coin}<span class="n">0</span></div>
      </div>
      <div class="panel prompt hidden"><kbd class="p-key">F</kbd><span class="p-text">Drive</span></div>
      <div class="countdown hidden"></div>
      <div class="toolbar">
        <div class="panel group seasons">
          <button class="icon-btn" data-season="autumn" data-tip="Autumn (1)" aria-label="Autumn">${ICONS.autumn}</button>
          <button class="icon-btn" data-season="spring" data-tip="Spring (2)" aria-label="Spring">${ICONS.spring}</button>
          <button class="icon-btn" data-season="monsoon" data-tip="Monsoon (3)" aria-label="Monsoon">${ICONS.monsoon}</button>
        </div>
        <div class="panel group">
          <button class="icon-btn" data-act="activities" data-tip="Activities (J)" aria-label="Activities">${ICONS.flag}</button>
          <button class="icon-btn" data-act="night" data-tip="Day / night (N)" aria-label="Toggle night">${ICONS.moon}</button>
          <button class="icon-btn desk-only" data-act="camera" data-tip="Camera (C)" aria-label="Camera">${ICONS.camera}</button>
          <button class="icon-btn desk-only" data-act="music" data-tip="Music (M)" aria-label="Music">${ICONS.music}</button>
          <button class="icon-btn desk-only" data-act="sound" data-tip="Sound" aria-label="Sound">${ICONS.sound}</button>
          <button class="icon-btn desk-only" data-act="fullscreen" data-tip="Fullscreen" aria-label="Fullscreen">${ICONS.fullscreen}</button>
          <button class="icon-btn" data-act="settings" data-tip="Settings" aria-label="Settings">${ICONS.settings}</button>
        </div>
      </div>
      <div class="panel speedo">
        <svg viewBox="0 0 150 150">
          <circle class="track" cx="75" cy="75" r="${R}" stroke-dasharray="${C * ARC} ${C}" transform="rotate(135 75 75)"/>
          <circle class="value" cx="75" cy="75" r="${R}" stroke-dasharray="0 ${C}" transform="rotate(135 75 75)"/>
          <circle class="rpm" cx="75" cy="75" r="${R - 11}" stroke-dasharray="0 ${C}" transform="rotate(135 75 75)"/>
        </svg>
        <div class="boost">BOOST</div>
        <div class="readout"><div class="kmh">0</div><div class="unit">KM/H</div></div>
        <div class="gear">1</div>
      </div>
      <div class="panel now-playing dim"><div class="disc"></div><div><small>Now playing</small><b class="track">—</b></div></div>
      <div class="toasts"></div>
      <div class="panel hint"></div>`
    this.root.appendChild(hud)
    this.hud = hud
    this.hint = this.el(hud, '.hint')
    this.dom = {
      act: this.el(hud, '.activity'), actName: this.el(hud, '.act-name'), actStep: this.el(hud, '.act-step'), actGoal: this.el(hud, '.act-goal'),
      actTime: this.el(hud, '.act-time'), actBar: this.el(hud, '.act-bar i'), actCoins: this.el(hud, '.act-coins'),
      coins: this.el(hud, '.coins'), coinsN: this.el(hud, '.coins .n'), prompt: this.el(hud, '.prompt'), promptKey: this.el(hud, '.p-key'), promptText: this.el(hud, '.p-text'),
      countdown: this.el(hud, '.countdown'), unit: this.el(hud, '.unit'),
      embers: this.el(hud, '.embers'), embersN: this.el(hud, '.embers .n'), embersOf: this.el(hud, '.embers .of'),
      kmh: this.el(hud, '.kmh'), gear: this.el(hud, '.gear'), value: this.el(hud, '.value'), rpm: this.el(hud, '.rpm'), boost: this.el(hud, '.boost'),
      np: this.el(hud, '.now-playing'), npTrack: this.el(hud, '.now-playing .track'), toasts: this.el(hud, '.toasts'),
      night: this.el(hud, '[data-act="night"]'), music: this.el(hud, '[data-act="music"]'), sound: this.el(hud, '[data-act="sound"]'), camera: this.el(hud, '[data-act="camera"]'),
    }
    this.dom.prompt.addEventListener('click', () => this.fire('promptTap', this.dom.promptKey.textContent))
    hud.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => this.fire('season', b.dataset.season)))
    hud.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.fire(b.dataset.act)))
  }

  setSeason(name) {
    document.documentElement.dataset.season = name
    this.hud.querySelectorAll('[data-season]').forEach((b) => b.classList.toggle('active', b.dataset.season === name))
  }

  setNight(isNight) {
    this.dom.night.innerHTML = isNight ? ICONS.sun : ICONS.moon
    this.dom.night.dataset.tip = isNight ? 'Back to day (N)' : 'Night (N)'
    this.dom.night.classList.toggle('active', isNight)
  }

  setMusic(on) {
    this.dom.music.classList.toggle('off', !on)
  }

  setSound(on) {
    this.dom.sound.innerHTML = on ? ICONS.sound : ICONS.mute
    this.dom.sound.classList.toggle('off', !on)
  }

  setCamera(mode) {
    this.dom.camera.classList.toggle('active', mode === 'chase')
  }

  setEmbers(n, total, pulse = false) {
    this.dom.embersN.textContent = n
    this.dom.embersOf.textContent = `/ ${total}`
    if (pulse) {
      this.dom.embers.classList.remove('pulse')
      void this.dom.embers.offsetWidth
      this.dom.embers.classList.add('pulse')
    }
  }

  nowPlaying(name) {
    this.dom.npTrack.textContent = name
    this.dom.np.classList.remove('dim')
    clearTimeout(this.npTimer)
    this.npTimer = setTimeout(() => this.dom.np.classList.add('dim'), 7000)
  }

  toast(html, { big = false, duration = 2600 } = {}) {
    const t = document.createElement('div')
    t.className = `panel toast${big ? ' big' : ''}`
    t.innerHTML = html
    this.dom.toasts.appendChild(t)
    while (this.dom.toasts.children.length > 3) this.dom.toasts.firstChild.remove()
    setTimeout(() => t.classList.add('out'), duration)
    setTimeout(() => t.remove(), duration + 500)
  }

  update(game) {
    const now = performance.now()
    if (now - this.lastHud < 50) return
    this.lastHud = now
    const active = game.active
    const { C, ARC } = this.arc
    this.dom.speedo = this.dom.speedo || this.el(this.hud, '.speedo')
    this.dom.speedo.classList.toggle('hidden', !active)
    if (active) {
      const vp = active.phys
      if (active.type === 'heli') {
        const alt = Math.max(0, Math.round(vp.altitude))
        this.dom.kmh.textContent = alt
        this.dom.unit.textContent = 'M ALT'
        const frac = Math.min(Math.abs(vp.speed) * 3.6 / 200, 1)
        this.dom.value.setAttribute('stroke-dasharray', `${C * ARC * frac} ${C}`)
        this.dom.value.style.opacity = frac > 0.01 ? 1 : 0
        this.dom.rpm.setAttribute('stroke-dasharray', `${(C - 2 * Math.PI * 11) * ARC * vp.rotor} ${C}`)
        this.dom.rpm.classList.toggle('red', false)
        this.dom.gear.textContent = vp.state === 'off' ? 'OFF' : vp.state === 'starting' ? 'START' : vp.state === 'stopping' ? 'STOP' : `${Math.round(Math.abs(vp.speed) * 3.6)}`
        this.dom.boost.classList.remove('on')
      } else {
        const kmh = Math.round(Math.abs(vp.speed) * 3.6)
        this.dom.kmh.textContent = kmh
        this.dom.unit.textContent = 'KM/H'
        const frac = Math.min(kmh / (active.type === 'bike' ? 150 : 120), 1)
        this.dom.value.setAttribute('stroke-dasharray', `${C * ARC * frac} ${C}`)
        this.dom.value.style.opacity = frac > 0.01 ? 1 : 0
        const rpmFrac = Math.min(vp.rpm / (vp.cfg.redline + 300), 1)
        this.dom.rpm.setAttribute('stroke-dasharray', `${(C - 2 * Math.PI * 11) * ARC * rpmFrac} ${C}`)
        this.dom.rpm.classList.toggle('red', vp.rpm > vp.cfg.upRpm)
        this.dom.gear.textContent = vp.gear === -1 ? 'R' : Math.abs(vp.speed) < 0.3 && vp.throttle < 0.05 ? 'N' : vp.gear
        this.dom.boost.classList.toggle('on', vp.boosting)
      }
    }
    // activity panel
    const a = game.activities?.current
    this.dom.act.classList.toggle('hidden', !a)
    if (a) {
      this.dom.actName.textContent = ACTIVITY_INFO[a.id].name
      this.dom.actGoal.textContent = a.label
      this.dom.actStep.textContent = a.id === 'rally' ? `${a.next}/${a.total}` : `${Math.min(a.step, a.total)}/${a.total}`
      if (a.id === 'rally') {
        this.dom.actTime.textContent = formatTime(a.t)
        this.dom.actBar.style.width = `${(a.next / a.total) * 100}%`
      } else {
        const tl = Math.max(0, a.timer)
        this.dom.actTime.textContent = `${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}`
        this.dom.actBar.style.width = `${(tl / a.limit) * 100}%`
        this.dom.actTime.classList.toggle('late', tl < 10)
      }
      this.dom.actCoins.textContent = a.coins
    }
    // contextual hint
    const mode = active ? active.type : 'foot'
    if (mode !== this.hintMode) {
      this.hintMode = mode
      const H = {
        car: '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive</span><span><kbd>Space</kbd> drift</span><span><kbd>Shift</kbd> boost</span><span><kbd>F</kbd> get out</span><span><kbd>C</kbd> camera</span><span><kbd>H</kbd> horn</span>',
        bike: '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ride</span><span><kbd>Shift</kbd> boost</span><span><kbd>F</kbd> get off</span><span><kbd>C</kbd> camera</span>',
        heli: '<span><kbd>I</kbd> engine</span><span><kbd>Space</kbd>/<kbd>Shift</kbd> up / down</span><span><kbd>W</kbd><kbd>S</kbd> pitch</span><span><kbd>A</kbd><kbd>D</kbd> turn</span><span><kbd>Q</kbd><kbd>E</kbd> strafe</span><span><kbd>F</kbd> get out</span>',
        foot: '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span><span><kbd>Shift</kbd> run</span><span><kbd>Space</kbd> jump</span><span><kbd>F</kbd> enter vehicle</span><span>mouse to look</span><span><kbd>C</kbd> camera</span>',
      }
      this.hint.innerHTML = H[mode]
      this.hint.classList.remove('dim')
      clearTimeout(this.hintTimer)
      this.hintTimer = setTimeout(() => this.hint.classList.add('dim'), 9000)
    }
  }

  setCoins(n, pulse = false) {
    this.dom.coinsN.textContent = n
    if (pulse) {
      this.dom.coins.classList.remove('pulse')
      void this.dom.coins.offsetWidth
      this.dom.coins.classList.add('pulse')
    }
  }

  prompt(key, text) {
    if (!key) return this.dom.prompt.classList.add('hidden')
    this.dom.prompt.classList.remove('hidden')
    this.dom.promptKey.textContent = key
    this.dom.promptText.textContent = text
  }

  countdown(n) {
    const el = this.dom.countdown
    el.textContent = n > 0 ? n : 'GO!'
    el.classList.remove('hidden', 'pop')
    void el.offsetWidth
    el.classList.add('pop')
    clearTimeout(this.cdTimer)
    this.cdTimer = setTimeout(() => el.classList.add('hidden'), n > 0 ? 900 : 700)
  }

  openActivities(acts) {
    if (this.modal) return this.closeSettings()
    const wrap = document.createElement('div')
    wrap.className = 'modal-wrap'
    const fmtBest = (id) => {
      const b = acts.best[id]
      if (!b) return 'No record yet'
      return id === 'rally' ? `Best ${formatTime(b)}` : `Best ${b} coins`
    }
    wrap.innerHTML = `
      <div class="panel modal" role="dialog" aria-label="Activities">
        <h2>Activities <button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></h2>
        <div class="coin-total">${ICONS.coin}<b>${acts.coins}</b> coins earned</div>
        ${Object.entries(ACTIVITY_INFO).map(([id, info]) => `
          <div class="act-card" style="--c:${info.color}">
            <div class="act-top"><b>${info.name}</b><span>${fmtBest(id)}</span></div>
            <p>${info.blurb}</p>
            <button class="chip" data-route="${id}">Show the way</button>
          </div>`).join('')}
        <p class="note">Drive into a glowing marker and press <kbd>G</kbd> to start. Press <kbd>G</kbd> again to quit an activity.</p>
      </div>`
    document.body.appendChild(wrap)
    this.modal = wrap
    wrap.addEventListener('click', (e) => { if (e.target === wrap) this.closeSettings() })
    wrap.querySelector('[data-close]').addEventListener('click', () => this.closeSettings())
    wrap.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => {
      this.fire('route', b.dataset.route)
      this.closeSettings()
    }))
  }

  // ------------------------------------------------------------ Settings
  openSettings(audio, opts) {
    if (this.modal) return this.closeSettings()
    const s = audio.settings
    const wrap = document.createElement('div')
    wrap.className = 'modal-wrap'
    const pct = (v) => Math.round(v * 100)
    wrap.innerHTML = `
      <div class="panel modal" role="dialog" aria-label="Settings">
        <h2>Settings <button class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></h2>
        ${HOME_LINK ? `<div class="home-row">${HOME_LINK}</div>` : ''}
        <h3>Sound</h3>
        <label class="row">Master<input type="range" min="0" max="1" step="0.01" value="${s.master}" data-vol="master"><output>${pct(s.master)}</output></label>
        <label class="row">Music<input type="range" min="0" max="1" step="0.01" value="${s.music}" data-vol="music"><output>${pct(s.music)}</output></label>
        <label class="row">Effects<input type="range" min="0" max="1" step="0.01" value="${s.sfx}" data-vol="sfx"><output>${pct(s.sfx)}</output></label>
        <div class="toggles">
          <button class="chip ${s.musicMuted ? '' : 'on'}" data-t="music">${ICONS.music} Music</button>
          <button class="chip ${s.muted ? '' : 'on'}" data-t="sound">${ICONS.sound} All sound</button>
        </div>
        <h3>View</h3>
        <div class="toggles">
          <button class="chip ${opts.camera === 'chase' ? 'on' : ''}" data-t="camera">${ICONS.camera} Chase camera</button>
          <button class="chip ${opts.tilt ? 'on' : ''}" data-t="tilt">Miniature blur</button>
          <button class="chip" data-t="fullscreen">${ICONS.fullscreen} Fullscreen</button>
        </div>
        <h3>Graphics quality</h3>
        <div class="seg" data-quality>
          <button data-q="high" class="${opts.quality === 'high' ? 'active' : ''}">High</button>
          <button data-q="low" class="${opts.quality === 'low' ? 'active' : ''}">Low</button>
        </div>
        <div class="note">Changing quality reloads the valley.</div>
        <h3>Progress</h3>
        <div class="toggles">
          <button class="chip" data-t="reset-embers">${ICONS.reset} Reset embers</button>
          <button class="chip" data-t="reset-best">${ICONS.reset} Reset activity records</button>
        </div>
        ${this.isTouch ? '' : `<h3>Controls</h3>
        <div class="keys">
          <span><kbd>W</kbd><kbd>S</kbd></span><span>Throttle / brake &amp; reverse (walk on foot)</span>
          <span><kbd>A</kbd><kbd>D</kbd></span><span>Steer</span>
          <span><kbd>Space</kbd></span><span>Handbrake drift · jump · helicopter up</span>
          <span><kbd>Shift</kbd></span><span>Boost · run · helicopter down</span>
          <span><kbd>F</kbd></span><span>Get in / out of the buggy, bike or helicopter</span>
          <span><kbd>I</kbd></span><span>Helicopter engine start / stop</span>
          <span><kbd>Q</kbd><kbd>E</kbd></span><span>Helicopter strafe</span>
          <span><kbd>G</kbd></span><span>Start / quit an activity at a marker</span>
          <span><kbd>J</kbd></span><span>Activities list</span>
          <span>Map</span><span>Click the minimap to enlarge</span>
          <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></span><span>Autumn / Spring / Monsoon</span>
          <span><kbd>N</kbd></span><span>Day / night</span>
          <span><kbd>C</kbd></span><span>Camera</span>
          <span><kbd>R</kbd></span><span>Reset vehicle</span>
          <span><kbd>M</kbd></span><span>Music on / off</span>
          <span><kbd>H</kbd></span><span>Horn</span>
        </div>`}
      </div>`
    document.body.appendChild(wrap)
    this.modal = wrap
    wrap.addEventListener('click', (e) => { if (e.target === wrap) this.closeSettings() })
    wrap.querySelector('[data-close]').addEventListener('click', () => this.closeSettings())
    wrap.querySelectorAll('[data-vol]').forEach((input) => input.addEventListener('input', () => {
      input.nextElementSibling.textContent = pct(+input.value)
      this.fire('volume', input.dataset.vol, +input.value)
    }))
    wrap.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
      const r = this.fire(`setting:${b.dataset.t}`)
      if (typeof r === 'boolean') b.classList.toggle('on', r)
    }))
    wrap.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => this.fire('quality', b.dataset.q)))
  }

  closeSettings() {
    if (!this.modal) return
    this.modal.remove()
    this.modal = null
  }
}
