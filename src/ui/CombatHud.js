// Action HUD: crosshair (with spread + hit marker), weapon + ammo, health / armour bars,
// wanted stars, damage flashes with a direction arc, sniper scope, the weapon wheel and
// big centre messages ("KNOCKED OUT", "ARRESTED", "MISSION PASSED").
import { WEAPONS, WEAPON_BY_ID } from '../combat/Weapons.js'

const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 6 6.6.8-4.9 4.6 1.2 6.5L12 17.3l-5.8 3.2 1.2-6.5L2.5 9.4l6.6-.8z"/></svg>'

export class CombatHud {
  constructor(root) {
    const el = document.createElement('div')
    el.className = 'combat-hud'
    el.innerHTML = `
      <div class="crosshair hidden"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><b class="dot"></b><s class="hitmark"></s></div>
      <div class="scope hidden"><div class="lens"></div></div>
      <div class="hurt-flash"></div>
      <div class="hurt-dir"></div>
      <div class="panel weapon-hud"><div class="w-icon"></div><div class="w-text"><b class="w-name">Pistol</b><span class="w-ammo">12 / 96</span></div><div class="w-reload"><i></i></div></div>
      <div class="vitals"><div class="bar hp"><i></i></div><div class="bar ar"><i></i></div></div>
      <div class="wanted">${STAR.repeat(5)}</div>
      <div class="veh-health hidden"><i></i></div>
      <div class="wheel hidden"><div class="wheel-ring"></div><div class="wheel-center"><b></b><span></span></div></div>
      <div class="bigmsg hidden"><b></b><span></span></div>`
    root.appendChild(el)
    this.el = el
    const q = (s) => el.querySelector(s)
    this.dom = {
      cross: q('.crosshair'), hit: q('.hitmark'), scope: q('.scope'), flash: q('.hurt-flash'), dir: q('.hurt-dir'),
      wpn: q('.weapon-hud'), wIcon: q('.w-icon'), wName: q('.w-name'), wAmmo: q('.w-ammo'), wReload: q('.w-reload'), wReloadBar: q('.w-reload i'),
      vitals: q('.vitals'), hp: q('.hp i'), ar: q('.ar i'), arBar: q('.ar'), wanted: q('.wanted'), stars: [...el.querySelectorAll('.wanted svg')],
      veh: q('.veh-health'), vehBar: q('.veh-health i'), wheel: q('.wheel'), ring: q('.wheel-ring'), wheelName: q('.wheel-center b'), wheelAmmo: q('.wheel-center span'),
      big: q('.bigmsg'), bigTitle: q('.bigmsg b'), bigSub: q('.bigmsg span'),
    }
    // weapon wheel slots
    this.slots = WEAPONS.map((w, i) => {
      const a = (i / WEAPONS.length) * Math.PI * 2 - Math.PI / 2
      const s = document.createElement('div')
      s.className = 'slot'
      s.style.left = `${50 + Math.cos(a) * 38}%`
      s.style.top = `${50 + Math.sin(a) * 38}%`
      s.innerHTML = `<span>${w.icon}</span><small>${w.slot}</small>`
      this.dom.ring.appendChild(s)
      return { w, el: s, a }
    })
    this.wheelOpen = false
    this.wheelPick = null
    this.wheelVec = { x: 0, y: 0 }
    this.last = 0
    this.lastHp = 100
  }

  hitMarker(kill = false) {
    const h = this.dom.hit
    h.classList.remove('on', 'kill')
    void h.offsetWidth
    h.classList.add('on')
    if (kill) h.classList.add('kill')
  }

  hurt(fromAngle = null) {
    const f = this.dom.flash
    f.classList.remove('on')
    void f.offsetWidth
    f.classList.add('on')
    if (fromAngle !== null) {
      const d = this.dom.dir
      d.style.transform = `translate(-50%, -50%) rotate(${fromAngle}rad)`
      d.classList.remove('on')
      void d.offsetWidth
      d.classList.add('on')
    }
  }

  big(title, sub = '', ms = 3200, kind = '') {
    this.dom.bigTitle.textContent = title
    this.dom.bigSub.textContent = sub
    this.dom.big.className = `bigmsg ${kind}`
    clearTimeout(this.bigT)
    if (ms) this.bigT = setTimeout(() => this.dom.big.classList.add('hidden'), ms)
  }

  hideBig() {
    this.dom.big.classList.add('hidden')
  }

  // ---- weapon wheel (hold Tab)
  openWheel(combat) {
    this.wheelOpen = true
    this.wheelVec = { x: 0, y: 0 }
    this.wheelPick = combat.current
    this.dom.wheel.classList.remove('hidden')
    this.refreshWheel(combat)
  }

  moveWheel(dx, dy, combat) {
    if (!this.wheelOpen) return
    this.wheelVec.x = Math.max(-80, Math.min(80, this.wheelVec.x + dx))
    this.wheelVec.y = Math.max(-80, Math.min(80, this.wheelVec.y + dy))
    if (Math.hypot(this.wheelVec.x, this.wheelVec.y) < 20) return
    const a = Math.atan2(this.wheelVec.y, this.wheelVec.x)
    let best = null, bd = Infinity
    for (const s of this.slots) {
      const d = Math.abs(Math.atan2(Math.sin(a - s.a), Math.cos(a - s.a)))
      if (d < bd) { bd = d; best = s }
    }
    if (best) this.wheelPick = best.w.id
    this.refreshWheel(combat)
  }

  refreshWheel(combat) {
    for (const s of this.slots) {
      s.el.classList.toggle('on', s.w.id === this.wheelPick)
      s.el.classList.toggle('empty', !combat.has(s.w.id))
    }
    const w = WEAPON_BY_ID[this.wheelPick]
    const inv = combat.inv[w.id]
    this.dom.wheelName.textContent = w.name
    this.dom.wheelAmmo.textContent = w.melee ? '' : `${inv.clip} / ${inv.ammo}`
  }

  closeWheel() {
    this.wheelOpen = false
    this.dom.wheel.classList.add('hidden')
    return this.wheelPick
  }

  update(game) {
    const now = performance.now()
    const g = game
    const c = g.combat
    if (!c) return
    // crosshair follows every frame (cursor in the overhead view)
    const onFoot = !g.active
    const showCross = !g.player.dead && ((onFoot && !c.weapon.melee) || (g.active && (c.canShoot() || g.active.type === 'tank')))
    const cross = this.dom.cross
    cross.classList.toggle('hidden', !showCross || g.rig.scope)
    if (showCross) {
      const diorama = g.rig.mode === 'diorama'
      const ndc = g.rig.aimNdc(g.input.cursor)
      cross.style.left = `${(ndc.x * 0.5 + 0.5) * 100}%`
      cross.style.top = `${(-ndc.y * 0.5 + 0.5) * 100}%`
      const w = c.weapon
      const sp = g.active?.type === 'tank' ? 0.004 : (g.rig.aiming ? w.aimSpread || 0 : w.spread || 0) + c.bloom
      cross.style.setProperty('--gap', `${6 + sp * 260}px`)
      cross.classList.toggle('cursor', diorama)
    }
    this.dom.scope.classList.toggle('hidden', !g.rig.scope)
    if (now - this.last < 60) return
    this.last = now
    // weapon panel
    const w = c.weapon
    const inv = c.inv[w.id]
    const tank = g.active?.type === 'tank'
    this.dom.wpn.classList.toggle('dim', !!g.active && !c.canShoot() && !tank)
    if (tank) {
      this.dom.wIcon.textContent = '💣'
      this.dom.wName.textContent = 'Tank cannon'
      this.dom.wAmmo.textContent = g.tank?.reload > 0 ? 'reloading' : 'ready'
    } else {
      this.dom.wIcon.textContent = w.icon
      this.dom.wName.textContent = w.name
      this.dom.wAmmo.textContent = w.melee ? '—' : `${inv.clip} / ${inv.ammo}`
    }
    const rl = tank ? g.tank?.reload || 0 : c.reloadT
    this.dom.wReload.classList.toggle('on', rl > 0)
    if (rl > 0) this.dom.wReloadBar.style.transform = `scaleX(${1 - rl / (tank ? 2.5 : w.reload || 1)})`
    // vitals
    const p = g.player
    this.dom.hp.style.transform = `scaleX(${Math.max(0, p.health / 100).toFixed(3)})`
    this.dom.hp.parentElement.classList.toggle('low', p.health < 30)
    this.dom.ar.style.transform = `scaleX(${Math.max(0, p.armor / 100).toFixed(3)})`
    this.dom.arBar.classList.toggle('none', p.armor <= 0)
    // wanted stars
    const wanted = g.wanted
    const stars = wanted ? wanted.level : 0
    const flashing = wanted?.searching
    this.dom.stars.forEach((s, i) => s.classList.toggle('on', i < stars))
    this.dom.wanted.classList.toggle('flash', !!flashing && stars > 0)
    this.dom.wanted.classList.toggle('none', stars === 0)
    // vehicle health
    const v = g.active
    this.dom.veh.classList.toggle('hidden', !v || v.type === 'heli')
    if (v && v.phys.maxHealth) {
      const k = v.phys.health / v.phys.maxHealth
      this.dom.vehBar.style.transform = `scaleX(${Math.max(0, k).toFixed(3)})`
      this.dom.veh.classList.toggle('low', k < 0.3)
    }
  }
}
