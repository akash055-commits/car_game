// Town traffic: NPC cars driving lane loops around blocks (and the ring road), keeping
// right, slowing for corners, braking for the player, pedestrians on crosswalks and the
// car ahead. Each car is a kinematic body, so you can bump it; a rammed driver stops,
// honks and shakes a fist before driving on. Drivers are visible townspeople.
import * as THREE from 'three'
import { carGeometry, trafficMaterial, burntMaterial } from '../vehicle/CarVisuals.js'
import { walkTo } from '../characters/People.js'
import { WORLD } from '../world/Layout.js'
import { TOWNS, HIGHWAY_LOOPS } from '../world/Regions.js'
import { makeCharacter } from '../characters/Rig.js'
import { EMOTE } from '../characters/Emotes.js'
import { makeRandom, clamp, damp, angleDelta } from '../core/math.js'

const COLORS = ['#d84b3a', '#2f8f95', '#e8a33a', '#4a7bd0', '#f2f0ea', '#5aa05a', '#3d4f7a', '#8a5bd0', '#2a2626', '#c9875e', '#9fb1c4']
const LANE = 1.9
const _imp = new THREE.Vector3()

export class Traffic {
  constructor(scene, physics, layout, rig, quality) {
    this.scene = scene
    this.physics = physics
    this.layout = layout
    this.rnd = makeRandom(515)
    this.cars = []
    this.rig = rig
    this.listeners = {}
    const mat = trafficMaterial()
    const count = quality.name === 'low' ? 14 : 26
    const loops = this.makeLoops()
    this.loops = loops
    // Weighted by length so long loops (the ring highway) get more cars
    const pickLoop = (i) => {
      const total = loops.reduce((a, l) => a + Math.sqrt(l.total), 0)
      let t = ((i + 0.5) / count) * total
      for (const l of loops) { t -= Math.sqrt(l.total); if (t <= 0) return l }
      return loops[loops.length - 1]
    }
    for (let i = 0; i < count; i++) {
      const loop = pickLoop(i)
      const kind = this.rnd.pick(['sedan', 'sedan', 'hatch', 'van'])
      const mesh = new THREE.Mesh(carGeometry(kind, this.rnd.pick(COLORS)), mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
      const R = physics.RAPIER
      const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased())
      // density gives a real car mass (~1.5 t) once a wreck turns it into a physics object
      physics.tag(physics.world.createCollider(R.ColliderDesc.cuboid(0.9, kind === 'van' ? 0.95 : 0.7, 2.05).setTranslation(0, kind === 'van' ? 1.0 : 0.8, 0).setDensity(150), body), { kind: 'traffic', material: 'metal' })
      const driver = rig.add(makeCharacter(this.rnd, { kind: 'adult' }))
      driver.noReact = true
      driver.drive = 1
      const color = this.rnd.pick(COLORS)
      const collider = body.collider(0)
      const car = { kind, color, mesh, body, collider, driver, loop, s: this.rnd.range(0, loop.total), speed: 0, max: loop.highway ? this.rnd.range(15, 20) : this.rnd.range(8, 11), stopped: 0, honk: 0, pos: new THREE.Vector3(), heading: 0, health: 100, state: 'drive', panic: 0, timer: 0 }
      mesh.geometry.dispose()
      mesh.geometry = carGeometry(kind, color)
      this.cars.push(car)
    }
    this._t = new THREE.Vector3()
    this._p = new THREE.Vector3()
  }

  // Closed lane loops (clockwise around a few blocks + the ring road), driving on the right
  makeLoops() {
    const rects = []
    for (const t of TOWNS) for (const [a, b, c, d] of t.loops || []) rects.push([t.xs[a], t.zs[b], t.xs[c], t.zs[d], false])
    for (const r of HIGHWAY_LOOPS) rects.push([...r, true])
    return rects.map(([x0, z0, x1, z1, highway]) => {
      // counter-clockwise when viewed from above with +z north => right-hand traffic keeps the block on the left
      const o = LANE
      const corners = [[x0 + o, z0 + o], [x1 - o, z0 + o], [x1 - o, z1 - o], [x0 + o, z1 - o]]
      const pts = []
      const r = 6
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k]
        const [bx, bz] = corners[(k + 1) % 4]
        const len = Math.hypot(bx - ax, bz - az)
        const dx = (bx - ax) / len, dz = (bz - az) / len
        const n = Math.ceil((len - 2 * r) / 2)
        for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3(ax + dx * (r + (i / n) * (len - 2 * r)), 0, az + dz * (r + (i / n) * (len - 2 * r))))
        // rounded corner
        const [cx2, cz2] = corners[(k + 2) % 4]
        const len2 = Math.hypot(cx2 - bx, cz2 - bz)
        const ex = (cx2 - bx) / len2, ez = (cz2 - bz) / len2
        for (let i = 1; i < 6; i++) {
          const t = i / 6
          const p0x = bx - dx * r, p0z = bz - dz * r, p2x = bx + ex * r, p2z = bz + ez * r
          pts.push(new THREE.Vector3((1 - t) ** 2 * p0x + 2 * (1 - t) * t * bx + t * t * p2x, 0, (1 - t) ** 2 * p0z + 2 * (1 - t) * t * bz + t * t * p2z))
        }
      }
      for (const p of pts) p.y = this.layout.getDriveHeight(p.x, p.z)
      const len = [0]
      for (let i = 1; i <= pts.length; i++) len.push(len[i - 1] + pts[i % pts.length].distanceTo(pts[i - 1]))
      return { pts, len, total: len[len.length - 1], highway }
    })
  }

  sample(loop, s, out, tan) {
    s = ((s % loop.total) + loop.total) % loop.total
    let lo = 0, hi = loop.len.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (loop.len[m] < s) lo = m
      else hi = m
    }
    const a = loop.pts[lo % loop.pts.length], b = loop.pts[hi % loop.pts.length]
    const t = (s - loop.len[lo]) / (loop.len[hi] - loop.len[lo] || 1)
    out.copy(a).lerp(b, t)
    tan.copy(b).sub(a).normalize()
  }

  // obstacles: [{x,z,speed?}] — player vehicle, people on the road, other cars
  on(n, fn) {
    ;(this.listeners[n] ||= []).push(fn)
  }

  emit(n, ...a) {
    for (const fn of this.listeners[n] || []) fn(...a)
  }

  update(dt, ctx) {
    const { player, walkers } = ctx
    this.updateStates(dt, ctx)
    for (const c of this.cars) {
      if (c.state !== 'drive') continue
      // look ahead for anything in our lane
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading)
      let gap = 40
      const check = (x, z, w = 1.6) => {
        const dx = x - c.pos.x, dz = z - c.pos.z
        const ahead = dx * fx + dz * fz
        const side = Math.abs(dx * fz - dz * fx)
        if (ahead > 0 && ahead < gap && side < w) gap = ahead
      }
      if (player) check(player.x, player.z, 2.0)
      for (const o of this.cars) if (o !== c && o.state !== 'hidden') check(o.pos.x, o.pos.z, 1.5)
      for (const o of ctx.obstacles || []) check(o.x, o.z, o.w || 1.8)
      for (const w of walkers) if (w.visible && (w.crossing || w.reaction || w.isPlayer)) check(w.x, w.z, 1.8)
      // slow for corners
      this.sample(c.loop, c.s + 10, this._p, this._t)
      const turn = Math.abs(angleDelta(c.heading, Math.atan2(this._t.x, this._t.z)))
      // panicking drivers floor it (but still won't drive into you)
      c.panic = Math.max(0, c.panic - dt)
      let target = c.max * (c.panic > 0 ? 1.6 : 1) * (1 - clamp(turn / 1.2, 0, 0.6))
      if (gap < 14) target = Math.min(target, Math.max(0, (gap - 5) * 0.8))
      // blocked for a while by the player: lean on the horn
      if (gap < 8 && player && (player.x - c.pos.x) ** 2 + (player.z - c.pos.z) ** 2 < 100) {
        c.blocked = (c.blocked || 0) + dt
        if (c.blocked > 2.5 && c.honk <= 0) {
          c.honk = 1.5
          c.blocked = 0
          this.emit('honk', c.pos.x, c.pos.z)
        }
      } else c.blocked = 0
      if (c.stopped > 0) {
        c.stopped -= dt
        target = 0
      }
      c.speed += clamp(target - c.speed, -9 * dt, 3 * dt)
      c.s += c.speed * dt
      this.sample(c.loop, c.s, c.pos, this._t)
      c.heading = Math.atan2(this._t.x, this._t.z)
      c.pos.y = this.layout.getDriveHeight(c.pos.x, c.pos.z)
      c.mesh.position.copy(c.pos)
      // pitch with the road on hills
      const ah = this.layout.getDriveHeight(c.pos.x + fx * 2, c.pos.z + fz * 2), bh = this.layout.getDriveHeight(c.pos.x - fx * 2, c.pos.z - fz * 2)
      c.mesh.rotation.set(-Math.atan2(ah - bh, 4), c.heading, 0, 'YXZ')
      const q = c.mesh.quaternion
      c.body.setNextKinematicTranslation({ x: c.pos.x, y: c.pos.y, z: c.pos.z })
      c.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      // driver
      const d = c.driver
      const off = 0.38
      d.x = c.pos.x + Math.cos(c.heading) * off - fx * 0.2
      d.z = c.pos.z - Math.sin(c.heading) * off - fz * 0.2
      d.y = c.pos.y + (c.kind === 'van' ? 0.55 : 0.3)
      d.heading = c.heading
      d.steer = 0
      d.fist = c.honk > 0 ? 1 : 0
      c.honk = Math.max(0, c.honk - dt)
    }
  }

  // ---------------------------------------------------------------- damage & reactions
  byBody(body) {
    return this.cars.find((k) => k.body === body)
  }

  // Gunfire / explosions nearby: drivers panic and speed off, honking
  panicNear(x, z, r) {
    for (const c of this.cars) {
      if (c.state !== 'drive') continue
      if ((c.pos.x - x) ** 2 + (c.pos.z - z) ** 2 < r * r) {
        if (c.panic <= 0) this.emit('honk', c.pos.x, c.pos.z)
        c.panic = 7
        c.stopped = 0
      }
    }
  }

  // Bullets / blasts / rams. impulse: optional THREE.Vector3 for a wreck.
  damage(c, amount, impulse = null, kind = 'bullet') {
    if (!c || c.state === 'hidden') return
    if (c.state === 'wrecked') {
      if (impulse) c.body.applyImpulse(impulse, true)
      return
    }
    c.health -= amount
    c.panic = 7
    if (c.health <= 0) this.wreck(c, impulse, kind)
  }

  // The car is destroyed: becomes a burnt physics object, driver gone, respawns later
  wreck(c, impulse = null, kind = 'bullet') {
    const R = this.physics.RAPIER
    c.state = 'wrecked'
    c.health = 0
    c.timer = 0
    c.driver.visible = false
    c.mesh.material = burntMaterial()
    c.body.setBodyType(R.RigidBodyType.Dynamic, true)
    c.body.setLinearDamping(0.3)
    c.body.setAngularDamping(0.6)
    c.body.setLinvel({ x: Math.sin(c.heading) * c.speed, y: 0, z: Math.cos(c.heading) * c.speed }, true)
    if (impulse) c.body.applyImpulse(impulse, true)
    if (!c.sync) {
      c.sync = this.physics.addDynamic(c.body, (prev, curr, a) => {
        if (c.state !== 'wrecked') return
        c.mesh.position.set(prev.p.x + (curr.p.x - prev.p.x) * a, prev.p.y + (curr.p.y - prev.p.y) * a, prev.p.z + (curr.p.z - prev.p.z) * a)
        c.mesh.quaternion.set(curr.q.x, curr.q.y, curr.q.z, curr.q.w)
        c.pos.copy(c.mesh.position)
      })
    }
    this.emit('wrecked', c, kind)
  }

  // Back to life somewhere on its loop, out of the player's sight
  respawn(c, player) {
    const R = this.physics.RAPIER
    let best = this.rnd.range(0, c.loop.total)
    for (let k = 0; k < 10; k++) {
      const s = this.rnd.range(0, c.loop.total)
      this.sample(c.loop, s, this._p, this._t)
      if (!player || (this._p.x - player.x) ** 2 + (this._p.z - player.z) ** 2 > 140 * 140) { best = s; break }
    }
    c.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true)
    c.collider.setEnabled(true)
    c.s = best
    c.speed = 0
    c.health = 100
    c.state = 'drive'
    c.panic = 0
    c.mesh.visible = true
    c.mesh.material = trafficMaterial()
    c.color = this.rnd.pick(COLORS)
    c.mesh.geometry.dispose()
    c.mesh.geometry = carGeometry(c.kind, c.color)
    c.driver.visible = true
    c.driver.drive = 1
    calmDriver(c.driver)
    this.sample(c.loop, c.s, c.pos, this._t)
    c.body.setTranslation({ x: c.pos.x, y: c.pos.y, z: c.pos.z }, true)
  }

  // Carjacking: the driver is pulled out and runs off; the caller swaps in a drivable car
  carjack(c, player) {
    if (c.state !== 'drive') return null
    c.state = 'hidden'
    c.timer = 0
    c.mesh.visible = false
    c.collider.setEnabled(false)
    const d = c.driver
    d.drive = 0
    d.x = c.pos.x + Math.cos(c.heading) * 1.4
    d.z = c.pos.z - Math.sin(c.heading) * 1.4
    d.y = this.layout.getDriveHeight(d.x, d.z)
    d.ejected = { t: 0, fx: player.x, fz: player.z }
    d.fist = 1
    return { kind: c.kind, color: c.color, x: c.pos.x, y: c.pos.y, z: c.pos.z, heading: c.heading, speed: c.speed }
  }

  // Wreck timers, burning, respawns, ejected drivers running away
  updateStates(dt, ctx) {
    const player = ctx.player
    for (const c of this.cars) {
      if (c.state === 'wrecked') {
        c.timer += dt
        c.burning = c.timer < 18
        if (c.timer > 30 && (!player || (c.pos.x - player.x) ** 2 + (c.pos.z - player.z) ** 2 > 90 * 90)) this.respawn(c, player)
      } else if (c.state === 'hidden') {
        c.timer += dt
        const d = c.driver
        if (d.ejected) {
          d.ejected.t += dt
          d.panic = 1
          const dx = d.x - d.ejected.fx, dz = d.z - d.ejected.fz, l = Math.hypot(dx, dz) || 1
          walkTo(d, d.x + (dx / l) * 5, d.z + (dz / l) * 5, 4.8, dt, { ground: (x, z) => this.layout.getDriveHeight(x, z) }, 0.01)
          if (d.ejected.t > 7) { d.ejected = null; d.visible = false }
        }
        if (c.timer > 25) this.respawn(c, player)
      }
    }
  }

  // The player rammed a traffic car: it stops, honks, the driver gets cross
  rammed(body, emotes, onHonk) {
    const c = this.cars.find((k) => k.body === body)
    if (!c || c.honk > 0 || c.state !== 'drive') return
    c.stopped = 2.5
    c.honk = 2
    emotes.show(c.driver, EMOTE.angry, 2)
    onHonk?.(c.pos.x, c.pos.z)
  }

  near(x, z, r) {
    return this.cars.some((c) => c.state === 'drive' && c.speed > 1 && (c.pos.x - x) ** 2 + (c.pos.z - z) ** 2 < r * r)
  }

  // Nearest drivable traffic car within reach (for carjacking)
  nearestDriving(x, z, r = 3.2) {
    let best = null, bd = r * r
    for (const c of this.cars) {
      if (c.state !== 'drive') continue
      const d = (c.pos.x - x) ** 2 + (c.pos.z - z) ** 2
      if (d < bd) { bd = d; best = c }
    }
    return best
  }
}

function calmDriver(d) {
  d.panic = 0
  d.fist = 0
  d.ejected = null
  d.walk = 0
  d.run = 0
}

export { WORLD, damp, _imp }
