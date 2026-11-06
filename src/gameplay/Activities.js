// Activities: Town Courier (parcels to doors + supplies to building sites), Town Taxi
// (pick up waving fares, drive them to named places) and Checkpoint Rally (timed hoops
// through the streets, medals). Start markers glow around town; a beam marks the current
// target and an arrow above the vehicle points the way. Coins are saved between visits.
import * as THREE from 'three'
import { makeCharacter } from '../characters/Rig.js'
import { EMOTE } from '../characters/Emotes.js'
import { walkTo } from '../characters/People.js'
import { U } from '../world/Uniforms.js'
import { WORLD } from '../world/Layout.js'
import { makeRandom, clamp, angleDelta } from '../core/math.js'

export const ACTIVITY_INFO = {
  courier: { name: 'Town Courier', blurb: 'Deliver 5 parcels and building supplies before the clock runs out. Supplies speed up the builders.', color: '#e8a33a' },
  taxi: { name: 'Town Taxi', blurb: 'Pick up 4 waving passengers and drive them where they need to go. Smooth, quick rides earn tips.', color: '#f2c94c' },
  rally: { name: 'Checkpoint Rally', blurb: 'Race through 12 glowing hoops across town against the clock. Gold, silver or bronze.', color: '#4fe0c8' },
}

const _v = new THREE.Vector3()

function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: U.uTime, uColor: { value: new THREE.Color(color) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor;
      void main(){ float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.6) * (0.55 + 0.45 * sin(uTime * 4.0 - vUv.y * 12.0)); gl_FragColor = vec4(uColor * a * 0.9, 1.0); }`,
  })
}

export class Activities {
  constructor(scene, layout, town, construction, rig, emotes) {
    this.scene = scene
    this.layout = layout
    this.town = town
    this.construction = construction
    this.rig = rig
    this.emotes = emotes
    this.rnd = makeRandom(4242)
    this.listeners = {}
    this.current = null
    let saved = {}
    try { saved = JSON.parse(localStorage.getItem('sv-activities') || '{}') } catch {}
    this.coins = saved.coins || 0
    this.best = saved.best || {}

    const post = town.places.find((p) => p.name === 'Post Office') || town.shops[0]
    const stand = town.taxiStand
    const stunt = town.stuntPark
    this.starts = [
      { id: 'courier', x: post.door.x, z: post.door.z },
      { id: 'taxi', x: stand.x, z: stand.z },
      { id: 'rally', x: stunt.cx, z: stunt.z0 - 3 },
    ].map((s) => {
      // snap the marker onto the nearest street
      const q = layout.queryRoad(s.x, s.z)
      const side = Math.sign(q.side || 1) * (WORLD.roadHalfWidth - 1.8)
      const x = layout.roadX[q.i] - layout.roadTZ[q.i] * side, z = layout.roadZ[q.i] + layout.roadTX[q.i] * side
      return { ...s, x, z, y: layout.getDriveHeight(x, z) }
    })
    for (const s of this.starts) s.mesh = this.marker(s, ACTIVITY_INFO[s.id].color)

    // current target beam + rally hoops
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 60, 24, 1, true).translate(0, 30, 0), beamMaterial('#ffd27a'))
    this.beam.visible = false
    scene.add(this.beam)
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.12, 8, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 0.8) }))
    this.ring.visible = false
    scene.add(this.ring)
    this.hoopMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.2, 2.6) })
    this.hoops = []
    // guidance arrow above the player
    const arrow = new THREE.Group()
    const am = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.05, 0.35) })
    arrow.add(new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.0, 12).rotateX(Math.PI / 2).translate(0, 0, 0.6), am))
    arrow.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 8).rotateX(Math.PI / 2).translate(0, 0, -0.2), am))
    arrow.visible = false
    scene.add(arrow)
    this.arrow = arrow
    this.waypoint = null
    // a dedicated passenger / recipient character
    this.npc = rig.add(makeCharacter(this.rnd))
    this.npc.visible = false
    this.npc.noReact = true
  }

  on(n, fn) {
    ;(this.listeners[n] ||= []).push(fn)
  }

  emit(n, ...a) {
    for (const fn of this.listeners[n] || []) fn(...a)
  }

  save() {
    try { localStorage.setItem('sv-activities', JSON.stringify({ coins: this.coins, best: this.best })) } catch {}
  }

  marker(s, color) {
    const g = new THREE.Group()
    g.position.set(s.x, s.y, s.z)
    const disc = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.8, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, opacity: 0.85, depthWrite: false }))
    disc.position.y = 0.08
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 32, 1, true).translate(0, 1.6, 0), beamMaterial(color))
    const icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5) }))
    icon.position.y = 3.6
    g.add(disc, beam, icon)
    g.userData.icon = icon
    this.scene.add(g)
    return g
  }

  info(id) {
    return { ...ACTIVITY_INFO[id], best: this.best[id] }
  }

  // ---------------------------------------------------------------- lifecycle
  nearStart(pos) {
    if (this.current) return null
    for (const s of this.starts) if ((s.x - pos.x) ** 2 + (s.z - pos.z) ** 2 < 4.5 * 4.5) return s
    return null
  }

  start(id, ctx) {
    if (this.current) return
    const a = { id, t: 0, coins: 0, step: 0, ctx }
    this.current = a
    for (const s of this.starts) s.mesh.visible = false
    if (id === 'courier') {
      a.total = 5
      this.nextDelivery(a)
    } else if (id === 'taxi') {
      a.total = 4
      this.nextFare(a)
    } else if (id === 'rally') {
      this.buildRally(a)
    }
    this.emit('start', id)
  }

  stop(reason = 'quit') {
    const a = this.current
    if (!a) return
    this.current = null
    this.target = null
    this.beam.visible = this.ring.visible = this.arrow.visible = false
    for (const h of this.hoops) this.scene.remove(h)
    this.hoops = []
    this.npc.visible = false
    this.npc.taken = false
    for (const s of this.starts) s.mesh.visible = true
    this.emit('end', a.id, reason, a.coins)
  }

  award(coins, a = this.current) {
    coins = Math.round(coins)
    this.coins += coins
    if (a) a.coins += coins
    this.save()
    this.emit('coins', coins, this.coins)
  }

  setTarget(x, z, radius = 4) {
    const y = this.layout.getDriveHeight(x, z)
    this.target = { x, y, z, r: radius }
    this.beam.position.set(x, y, z)
    this.ring.position.set(x, y + 0.15, z)
    this.beam.visible = this.ring.visible = true
  }

  // ---------------------------------------------------------------- courier
  nextDelivery(a) {
    a.step++
    const supplies = a.step === 2 || a.step === 4
    const from = a.ctx.pos()
    if (supplies) {
      const sites = this.construction.sites.filter((s) => !s.complete)
      const site = sites[Math.floor(this.rnd.random() * sites.length)] || this.construction.sites[0]
      a.dest = { name: site.name, site, x: site.plot.front ? site.plot.front.x : site.x, z: site.plot.front ? site.plot.front.z : site.z }
      a.label = `Bring building supplies to the ${site.plot.street} site`
    } else {
      let house
      for (let k = 0; k < 20; k++) {
        house = this.town.houses[Math.floor(this.rnd.random() * this.town.houses.length)]
        const d = Math.hypot(house.x - from.x, house.z - from.z)
        if (d > 90 && d < 280) break
      }
      a.dest = { name: house.name, x: house.gate?.x ?? house.door.x, z: house.gate?.z ?? house.door.z, house }
      a.label = `Deliver a parcel to ${house.name}`
    }
    const dist = Math.hypot(a.dest.x - from.x, a.dest.z - from.z)
    a.limit = Math.round(dist / 9 + 25)
    a.timer = a.limit
    this.setTarget(a.dest.x, a.dest.z, 5)
    this.emit('objective', a)
  }

  // ---------------------------------------------------------------- taxi
  nextFare(a) {
    a.step++
    a.stage = 'pickup'
    const from = a.ctx.pos()
    // a waving passenger on a sidewalk somewhere ahead
    const nodes = this.layout.walk.nodes
    let n
    for (let k = 0; k < 30; k++) {
      n = nodes[Math.floor(this.rnd.random() * nodes.length)]
      const d = Math.hypot(n.x - from.x, n.z - from.z)
      if (d > 60 && d < 220) break
    }
    const c = this.npc
    Object.assign(c, makeCharacter(this.rnd), { index: c.index })
    this.rig.applyColors(c)
    c.x = n.x
    c.z = n.z
    c.y = this.layout.getDriveHeight(n.x, n.z)
    c.visible = true
    c.noReact = true
    c.wave = 1
    c.state = 'waiting'
    a.passenger = c
    a.label = 'Pick up the waving passenger'
    a.limit = Math.round(Math.hypot(n.x - from.x, n.z - from.z) / 8 + 30)
    a.timer = a.limit
    a.bumps = 0
    this.setTarget(n.x, n.z, 6)
    this.emit('objective', a)
  }

  // ---------------------------------------------------------------- rally
  buildRally(a) {
    const L = this.layout
    const route = [[-100, 75], [-75, 40], [-75, -25], [-25, -40], [25, -25], [50, 25], [25, 75], [-25, 100], [-75, 125], [-125, 100], [-125, 30], [-100, 75]]
    a.gates = route.map(([x, z]) => {
      const q = L.queryRoad(x, z)
      return { x: L.roadX[q.i], z: L.roadZ[q.i], y: L.roadH[q.i], tx: L.roadTX[q.i], tz: L.roadTZ[q.i] }
    })
    a.gates.forEach((gt, i) => {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.32, 10, 40), this.hoopMat)
      hoop.position.set(gt.x, gt.y + 4.2, gt.z)
      hoop.rotation.y = Math.atan2(gt.tx, gt.tz)
      hoop.visible = i < 3
      this.scene.add(hoop)
      this.hoops.push(hoop)
    })
    a.next = 0
    a.countdown = 3.5
    a.label = 'Get ready…'
    a.total = a.gates.length
    let len = 0
    for (let i = 1; i < a.gates.length; i++) len += Math.hypot(a.gates[i].x - a.gates[i - 1].x, a.gates[i].z - a.gates[i - 1].z) * 1.15
    a.medals = { gold: Math.round(len / 17), silver: Math.round(len / 13.5), bronze: Math.round(len / 10.5) }
    this.setTarget(a.gates[0].x, a.gates[0].z, 6)
    this.emit('objective', a)
  }

  // ---------------------------------------------------------------- update
  update(dt, time, ctx) {
    for (const s of this.starts) {
      if (!s.mesh.visible) continue
      s.mesh.userData.icon.rotation.y = time * 1.5
      s.mesh.userData.icon.position.y = 3.6 + Math.sin(time * 2) * 0.2
    }
    const a = this.current
    if (!a) return
    a.ctx = ctx
    const pos = ctx.pos()
    const speed = ctx.speed()
    a.t += dt
    this.ring.rotation.y = time
    // guidance arrow
    if (this.target) {
      this.arrow.visible = true
      this.arrow.position.set(pos.x, pos.y + (ctx.inVehicle() ? 3.2 : 2.6), pos.z)
      this.arrow.rotation.y = Math.atan2(this.target.x - pos.x, this.target.z - pos.z)
    }
    const dist = this.target ? Math.hypot(this.target.x - pos.x, this.target.z - pos.z) : 999

    if (a.id === 'courier') {
      a.timer -= dt
      if (a.timer <= 0) {
        this.emit('toast', 'Too late! That delivery was missed')
        return this.advanceCourier(a, false)
      }
      if (dist < this.target.r && speed < 3.5) this.advanceCourier(a, true)
    } else if (a.id === 'taxi') {
      this.updateTaxi(a, dt, ctx, dist, speed)
    } else if (a.id === 'rally') {
      if (a.countdown > 0) {
        const before = Math.ceil(a.countdown)
        a.countdown -= dt
        const after = Math.ceil(a.countdown)
        if (after !== before && after >= 0) this.emit('countdown', after)
        if (a.countdown <= 0) { a.t = 0; a.label = 'Go!'; this.emit('objective', a) }
        a.t = 0
        return
      }
      const gt = a.gates[a.next]
      const d = Math.hypot(gt.x - pos.x, gt.z - pos.z)
      if (d < 6.5) {
        this.hoops[a.next].visible = false
        a.next++
        this.emit('checkpoint', a.next, a.total, a.t)
        if (a.next >= a.total) {
          const t = a.t
          const medal = t < a.medals.gold ? 'gold' : t < a.medals.silver ? 'silver' : t < a.medals.bronze ? 'bronze' : null
          const isBest = !this.best.rally || t < this.best.rally
          if (isBest) this.best.rally = t
          this.award(medal === 'gold' ? 300 : medal === 'silver' ? 200 : medal === 'bronze' ? 120 : 60)
          this.emit('rallyDone', t, medal, isBest)
          return this.stop('done')
        }
        for (let k = a.next; k < Math.min(a.next + 3, a.total); k++) this.hoops[k].visible = true
        const n = a.gates[a.next]
        this.setTarget(n.x, n.z, 6)
        a.label = `Hoop ${a.next + 1} of ${a.total}`
        this.emit('objective', a)
      }
    }
  }

  advanceCourier(a, success) {
    if (success) {
      const bonus = Math.max(0, a.timer) * 3
      this.award(40 + bonus)
      if (a.dest.site) {
        this.construction.supply(a.dest.site, 75)
        this.emit('toast', 'Supplies delivered — the builders speed up!')
      } else {
        // the recipient pops out to say thanks
        const c = this.npc
        Object.assign(c, makeCharacter(this.rnd), { index: c.index })
        this.rig.applyColors(c)
        const door = a.dest.house.door
        c.x = door.x
        c.z = door.z
        c.y = this.layout.getDriveHeight(door.x, door.z)
        c.heading = Math.atan2(a.ctx.pos().x - door.x, a.ctx.pos().z - door.z)
        c.visible = true
        c.wave = 1
        c.noReact = true
        this.emotes.show(c, EMOTE.love, 2.5)
        this.emit('delivered', a.step, a.total)
        clearTimeout(this.hideNpc)
        this.hideNpc = setTimeout(() => { if (!this.current || this.current.id !== 'taxi') this.npc.visible = false }, 4000)
      }
    }
    if (a.step >= a.total) {
      const isBest = !this.best.courier || a.coins > this.best.courier
      if (isBest) this.best.courier = a.coins
      this.save()
      this.emit('summary', a.id, a.coins, isBest)
      return this.stop('done')
    }
    this.nextDelivery(a)
  }

  updateTaxi(a, dt, ctx, dist, speed) {
    const c = a.passenger
    a.timer -= dt
    if (a.stage === 'pickup') {
      c.heading += angleDelta(c.heading, Math.atan2(ctx.pos().x - c.x, ctx.pos().z - c.z)) * Math.min(1, dt * 4)
      c.wave = 1
      if (dist < 9 && speed < 2.5 && ctx.inVehicle()) {
        a.stage = 'boarding'
        c.wave = 0
      }
      if (a.timer <= 0) {
        this.emit('toast', 'The passenger got tired of waiting')
        return this.nextFare(a)
      }
    } else if (a.stage === 'boarding') {
      const seat = ctx.passengerSeat()
      if (walkTo(c, seat.x, seat.z, 2.2, dt, { ground: (x, z) => this.layout.getDriveHeight(x, z) }, 0.9) || speed > 4) {
        a.stage = 'riding'
        const from = ctx.pos()
        let dest
        for (let k = 0; k < 20; k++) {
          dest = this.town.places[Math.floor(this.rnd.random() * this.town.places.length)]
          const d = Math.hypot(dest.door.x - from.x, dest.door.z - from.z)
          if (d > 100 && d < 320) break
        }
        a.dest = dest
        a.label = `Take them to ${dest.name}`
        a.limit = Math.round(Math.hypot(dest.door.x - from.x, dest.door.z - from.z) / 9 + 30)
        a.timer = a.limit
        a.distance = Math.hypot(dest.door.x - from.x, dest.door.z - from.z)
        this.setTarget(dest.door.x, dest.door.z, 7)
        this.emotes.show(c, EMOTE.music, 2)
        this.emit('objective', a)
      }
    } else if (a.stage === 'riding') {
      const seat = ctx.passengerSeat()
      c.x = seat.x
      c.y = seat.y
      c.z = seat.z
      c.heading = seat.heading
      c.drive = ctx.vehicleType() === 'bike' ? 0 : 1
      c.ride = ctx.vehicleType() === 'bike' ? 1 : 0
      c.lean = seat.lean || 0
      if (dist < this.target.r && speed < 3) {
        const fare = 30 + a.distance * 0.25
        const tip = Math.max(0, a.timer) * 2 - a.bumps * 8
        this.award(fare + Math.max(0, tip))
        this.emit('fare', Math.round(fare), Math.round(Math.max(0, tip)), a.step, a.total)
        c.drive = c.ride = 0
        c.lean = 0
        this.emotes.show(c, tip > 0 ? EMOTE.love : EMOTE.coin, 2)
        if (a.step >= a.total) {
          const isBest = !this.best.taxi || a.coins > this.best.taxi
          if (isBest) this.best.taxi = a.coins
          this.save()
          this.emit('summary', a.id, a.coins, isBest)
          return this.stop('done')
        }
        return this.nextFare(a)
      }
    }
  }

  // a hard crash while carrying a passenger
  bump() {
    const a = this.current
    if (a && a.id === 'taxi' && a.stage === 'riding') {
      a.bumps++
      this.emotes.show(a.passenger, EMOTE.alarm, 1.4)
      this.emit('passengerUpset')
    }
  }

  // Waypoint to an activity start (from the menu)
  route(id) {
    const s = this.starts.find((k) => k.id === id)
    if (s && !this.current) this.setTarget(s.x, s.z, 4)
  }

  clearWaypoint() {
    if (!this.current) {
      this.target = null
      this.beam.visible = this.ring.visible = this.arrow.visible = false
    }
  }

  checkWaypoint(pos) {
    if (!this.current && this.target && Math.hypot(this.target.x - pos.x, this.target.z - pos.z) < 6) this.clearWaypoint()
    else if (!this.current && this.target) {
      this.arrow.visible = true
      this.arrow.position.set(pos.x, pos.y + 3, pos.z)
      this.arrow.rotation.y = Math.atan2(this.target.x - pos.x, this.target.z - pos.z)
    }
  }
}

export { clamp, _v }
