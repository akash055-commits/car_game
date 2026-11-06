// Construction sites. Each site has a structure made of individual physics pieces
// (bricks, logs, stones, fence panels) and a small crew. Builders fetch material from
// the pile (or pick up fallen pieces), carry it over, kneel or climb the scaffold and
// hammer it into place, bottom row first. Driving into a structure knocks the hit
// pieces loose and anything they were holding up collapses with them; the crew reacts,
// then gathers the pieces and rebuilds.
import * as THREE from 'three'
import { makeCharacter, ITEMS } from './Rig.js'
import { updateReaction, walkTo } from './People.js'
import { EMOTE } from './Emotes.js'
import { makeRandom, angleDelta, damp } from '../core/math.js'
import { wettable } from '../world/Props.js'
import { prism } from '../world/Town.js'

const TYPES = {
  brickHouse: { item: ITEMS.brick, size: [1.0, 0.5, 0.5], color: '#b5553a', material: 'stone', roof: 'gable', crew: 3 },
  brickShop: { item: ITEMS.brick, size: [1.0, 0.5, 0.5], color: '#c9875e', material: 'stone', roof: 'flat', crew: 3 },
  logCabin: { item: ITEMS.log, size: [1, 0.3, 0.3], color: '#9a6a3e', material: 'wood', roof: 'gable', crew: 2 },
  tower: { item: ITEMS.stone, size: [1.0, 0.5, 0.6], color: '#9b8f86', material: 'stone', roof: 'cone', crew: 3 },
  fence: { item: ITEMS.picket, size: [1.2, 0.9, 0.08], color: '#f2ebdd', material: 'wood', roof: null, crew: 2 },
}

// Slots: { x, y, z, ry, sx } in site-local space (front of the lot faces +z)
function slotsFor(type) {
  const s = []
  if (type === 'brickHouse' || type === 'brickShop') {
    const W = type === 'brickShop' ? 8 : 6, D = 5, rows = type === 'brickShop' ? 5 : 6
    for (let r = 0; r < rows; r++) {
      const y = 0.25 + r * 0.5
      const even = r % 2 === 0
      const nFB = even ? W : W - 1
      for (const side of [1, -1]) {
        for (let k = 0; k < nFB; k++) {
          const x = -(nFB - 1) / 2 + k
          const front = side === 1
          if (front && type === 'brickHouse' && r < 4 && Math.abs(x) < 0.8) continue
          if (front && type === 'brickShop' && r < 3 && Math.abs(x) < 2.6) continue
          if (!front && r >= 2 && r <= 3 && Math.abs(Math.abs(x) - 1.5) < 0.6) continue
          s.push({ x, y, z: side * (D / 2 - 0.25), ry: 0 })
        }
      }
      const nS = even ? D - 1 : D
      for (const side of [1, -1]) {
        for (let k = 0; k < nS; k++) {
          const z = -(nS - 1) / 2 + k
          if (r >= 2 && r <= 3 && Math.abs(z) < 0.6) continue
          s.push({ x: side * (W / 2 - 0.25), y, z, ry: Math.PI / 2 })
        }
      }
    }
    return { slots: s, W, D, H: rows * 0.5 }
  }
  if (type === 'logCabin') {
    const W = 5.4, D = 4.6, rows = 9
    for (let r = 0; r < rows; r++) {
      const y = 0.15 + r * 0.3
      for (const side of [1, -1]) {
        if (side === 1 && r < 7) {
          for (const hx of [-1.75, 1.75]) s.push({ x: hx, y, z: D / 2, ry: 0, sx: 1.9 })
        } else s.push({ x: 0, y, z: side * D / 2, ry: 0, sx: W + 0.5 })
        s.push({ x: side * W / 2, y: y + 0.0, z: 0, ry: Math.PI / 2, sx: D + 0.5 })
      }
    }
    return { slots: s, W, D, H: rows * 0.3 }
  }
  if (type === 'tower') {
    const rows = 10, n = 9, R = 1.65
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? Math.PI / n : 0
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + off
        if (r < 4 && k === 0) continue // doorway
        s.push({ x: Math.sin(a) * R, y: 0.25 + r * 0.5, z: Math.cos(a) * R, ry: a + Math.PI / 2 })
      }
    }
    return { slots: s, W: 4, D: 4, H: rows * 0.5 }
  }
  // fence around a garden: 4 sides of panels
  const W = 8.4, D = 6
  for (let k = 0; k < 7; k++) {
    const x = -W / 2 + 0.6 + k * 1.2
    if (Math.abs(x) > 0.7) s.push({ x, y: 0.5, z: D / 2, ry: 0 })
    s.push({ x, y: 0.5, z: -D / 2, ry: 0 })
  }
  for (let k = 0; k < 5; k++) {
    const z = -D / 2 + 0.6 + k * 1.2
    s.push({ x: -W / 2, y: 0.5, z, ry: Math.PI / 2 }, { x: W / 2, y: 0.5, z, ry: Math.PI / 2 })
  }
  return { slots: s, W, D, H: 1 }
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)

export class Construction {
  constructor(scene, physics, layout, town, rig, quality) {
    this.scene = scene
    this.physics = physics
    this.layout = layout
    this.rig = rig
    this.R = physics.RAPIER
    this.rnd = makeRandom(303)
    this.sites = []
    this.builders = []
    this.listeners = {}
    for (const plot of town.sitePlots) this.sites.push(this.buildSite(plot))
    void quality
  }

  on(n, fn) {
    ;(this.listeners[n] ||= []).push(fn)
  }

  emit(n, ...a) {
    for (const fn of this.listeners[n] || []) fn(...a)
  }

  toWorld(site, lx, lz) {
    const c = Math.cos(site.rot), s = Math.sin(site.rot)
    return { x: site.x + lx * c + lz * s, z: site.z - lx * s + lz * c }
  }

  buildSite(plot) {
    this.sitesType = plot.type
    const T = TYPES[plot.type]
    const { slots, W, D, H } = slotsFor(plot.type)
    const R = this.R
    const site = { plot, type: plot.type, T, x: plot.x, z: plot.z, rot: plot.rot, W, D, H, pieces: [], crew: [], complete: false, boost: 0 }
    site.y = this.layout.getHeight(site.x, site.z)
    site.name = `${plot.street} site`
    // pile behind the structure (lot back corner)
    const pile = this.toWorld(site, W / 2 + 1.3, -D / 2 + 0.8)
    site.pile = { x: pile.x, z: pile.z }
    // geometry + instances
    const [sx, sy, sz] = T.size
    const geo = plot.type === 'logCabin' ? new THREE.CylinderGeometry(sy / 2, sy / 2, 1, 10).rotateZ(Math.PI / 2) : new THREE.BoxGeometry(sx, sy, sz)
    const mat = wettable(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }))
    site.mesh = new THREE.InstancedMesh(geo, mat, slots.length)
    site.mesh.castShadow = site.mesh.receiveShadow = true
    site.mesh.frustumCulled = false
    const col = new THREE.Color()
    const base = new THREE.Color(T.color)
    // initial completion 45..80% (bottom rows first)
    const target = Math.floor(slots.length * this.rnd.range(0.45, 0.8))
    slots.forEach((sl, i) => {
      const w = this.toWorld(site, sl.x, sl.z)
      const len = plot.type === 'logCabin' ? sl.sx : sx
      const piece = {
        i, slot: sl, len,
        world: new THREE.Vector3(w.x, site.y + sl.y, w.z),
        rot: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), site.rot + sl.ry),
        state: 'pile', reserved: null,
      }
      piece.scale = new THREE.Vector3(plot.type === 'logCabin' ? len : 1, 1, 1)
      const half = plot.type === 'logCabin' ? { x: len / 2, y: sy / 2, z: sy / 2 } : { x: sx / 2, y: sy / 2, z: sz / 2 }
      piece.half = half
      piece.body = this.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(piece.world.x, piece.world.y, piece.world.z).setRotation(piece.rot).setCanSleep(true).setLinearDamping(0.2).setAngularDamping(0.4))
      piece.collider = this.physics.world.createCollider(R.ColliderDesc.cuboid(half.x * 0.98, half.y * 0.98, half.z * 0.98).setDensity(plot.type === 'logCabin' ? 450 : 1800).setFriction(0.9).setRestitution(0.05)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(1200), piece.body)
      this.physics.tag(piece.collider, { kind: 'piece', material: T.material })
      piece.body.setEnabled(false)
      site.mesh.setColorAt(i, col.copy(base).multiplyScalar(0.85 + this.rnd.random() * 0.25))
      site.pieces.push(piece)
    })
    // support graph: pieces in the row directly below whose footprint overlaps
    for (const p of site.pieces) {
      p.supports = site.pieces.filter((o) => o !== p && Math.abs(o.slot.y - (p.slot.y - (p.half.y * 2))) < 0.05 && this.overlap(p, o))
      p.ground = p.slot.y - p.half.y < 0.05
    }
    // order: bottom rows first
    site.order = [...site.pieces].sort((a, b) => a.slot.y - b.slot.y || a.i - b.i)
    for (let k = 0; k < target; k++) this.place(site, site.order[k], true)
    site.mesh.instanceColor.needsUpdate = true
    this.refreshMesh(site)
    this.scene.add(site.mesh)
    this.buildDecor(site)
    // crew
    for (let k = 0; k < T.crew; k++) {
      const c = this.rig.add(makeCharacter(this.rnd, { kind: 'adult', hat: 'hard', vest: true, longSleeves: this.rnd.random() < 0.5, colors: { hat: this.rnd.pick(['#f2b33d', '#ffffff', '#ff7a2f']), vest: this.rnd.pick(['#ff8a1e', '#d6f03a']), pants: this.rnd.pick(['#3d4f7a', '#6e4228', '#5b6b7a']) } }))
      const spot = this.toWorld(site, this.rnd.range(-W / 2, W / 2), D / 2 + 1.5)
      c.x = spot.x
      c.z = spot.z
      c.y = site.y
      c.role = 'builder'
      c.site = site
      c.state = 'fetch'
      c.timer = this.rnd.range(0, 3)
      c.speed = this.rnd.range(1.6, 1.9)
      site.crew.push(c)
      this.builders.push(c)
    }
    site.complete = site.pieces.every((p) => p.state === 'placed')
    return site
  }

  overlap(a, b) {
    // compare footprints in site-local XZ using the slot rotation (0 or 90°) / radius
    const ax = a.slot.x, az = a.slot.z, bx = b.slot.x, bz = b.slot.z
    const ar = Math.abs(Math.sin(a.slot.ry)) > 0.7, br = Math.abs(Math.sin(b.slot.ry)) > 0.7
    const aw = (ar ? a.half.z : a.half.x), ad = (ar ? a.half.x : a.half.z)
    const bw = (br ? b.half.z : b.half.x), bd = (br ? b.half.x : b.half.z)
    if (this.sitesType === 'tower') return Math.hypot(ax - bx, az - bz) < 1.0
    return Math.abs(ax - bx) < aw + bw - 0.05 && Math.abs(az - bz) < ad + bd - 0.05 || Math.hypot(ax - bx, az - bz) < 0.7
  }

  buildDecor(site) {
    const g = new THREE.Group()
    const L = this.layout
    const barrier = new THREE.MeshStandardMaterial({ color: 0xff7a2f, roughness: 0.6 })
    const white = new THREE.MeshStandardMaterial({ color: 0xf8f5ee, roughness: 0.6 })
    const wood = wettable(new THREE.MeshStandardMaterial({ color: 0xb98552, roughness: 0.85 }))
    // barrier posts around the lot (gap at the front)
    const lw = site.plot.w / 2 + 0.2, ld = site.plot.d / 2
    const posts = []
    for (let x = -lw; x <= lw + 0.01; x += 2) { posts.push([x, -ld]); if (Math.abs(x) > 2) posts.push([x, ld]) }
    for (let z = -ld + 2; z < ld; z += 2) posts.push([-lw, z], [lw, z])
    for (const [lx, lz] of posts) {
      const w = this.toWorld(site, lx, lz)
      const y = L.getHeight(w.x, w.z)
      for (const [h, m] of [[0.45, barrier], [0.75, white]]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 8), m)
        p.position.set(w.x, y + h, w.z)
        g.add(p)
      }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.12, 10), barrier)
      base.position.set(w.x, y + 0.06, w.z)
      g.add(base)
    }
    // material pile
    const [sx, sy, sz] = site.T.size
    const pm = new THREE.MeshStandardMaterial({ color: site.T.color, roughness: 0.85 })
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 4 - r; k++) {
        const len = site.type === 'logCabin' ? 2.4 : sx
        const geo = site.type === 'logCabin' ? new THREE.CylinderGeometry(sy / 2, sy / 2, len, 10).rotateZ(Math.PI / 2) : new THREE.BoxGeometry(sx, sy, sz)
        const m = new THREE.Mesh(geo, pm)
        const lx = site.W / 2 + 1.3 + (k - (3 - r) / 2) * (site.type === 'logCabin' ? 0.32 : sz + 0.02)
        const w = this.toWorld(site, lx, -site.D / 2 + 0.8)
        m.position.set(w.x, site.y + sy / 2 + r * sy, w.z)
        m.rotation.y = site.rot + Math.PI / 2
        m.castShadow = true
        g.add(m)
      }
    }
    // pallet under the pile
    const pal = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 1.4), wood)
    const pw = this.toWorld(site, site.W / 2 + 1.3, -site.D / 2 + 0.8)
    pal.position.set(pw.x, site.y + 0.0, pw.z)
    g.add(pal)
    // scaffold planks along the back (for high rows)
    if (site.H > 2) {
      for (const side of [-1, 1]) {
        const w = this.toWorld(site, 0, side * (site.D / 2 + 0.9))
        const plank = new THREE.Mesh(new THREE.BoxGeometry(site.W + 1, 0.08, 0.7), wood)
        plank.position.set(w.x, site.y + 1.2, w.z)
        plank.rotation.y = site.rot
        plank.castShadow = true
        g.add(plank)
        for (const lx of [-site.W / 2 - 0.4, site.W / 2 + 0.4]) {
          const pw2 = this.toWorld(site, lx, side * (site.D / 2 + 0.9))
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), white)
          pole.position.set(pw2.x, site.y + 1.3, pw2.z)
          g.add(pole)
        }
      }
    }
    // roof (appears when complete)
    let roof = null
    const rm = wettable(new THREE.MeshStandardMaterial({ color: site.type === 'logCabin' ? 0x5b6b7a : 0xb4473a, roughness: 0.7 }))
    if (site.T.roof === 'gable') roof = new THREE.Mesh(prism(site.W + 0.8, 1.8, site.D + 0.8), rm)
    if (site.T.roof === 'flat') roof = new THREE.Mesh(new THREE.BoxGeometry(site.W + 0.4, 0.25, site.D + 0.4), rm)
    if (site.T.roof === 'cone') roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.4, 9), rm)
    if (roof) {
      roof.position.set(site.x, site.y + site.H + (site.T.roof === 'cone' ? 1.2 : 0), site.z)
      roof.rotation.y = site.rot
      roof.castShadow = true
      roof.scale.setScalar(site.complete ? 1 : 0.001)
      g.add(roof)
      site.roof = roof
    }
    this.scene.add(g)
  }

  // --- piece state changes
  place(site, p, silent = false) {
    p.state = 'placed'
    p.reserved = null
    p.body.setEnabled(true)
    p.body.setBodyType(this.R.RigidBodyType.Fixed, true)
    p.body.setTranslation(p.world, true)
    p.body.setRotation(p.rot, true)
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    _m.compose(p.world, p.rot, p.scale)
    site.mesh.setMatrixAt(p.i, _m)
    site.mesh.instanceMatrix.needsUpdate = true
    if (!silent) {
      const done = site.pieces.every((o) => o.state === 'placed')
      if (done && !site.complete) {
        site.complete = true
        this.emit('complete', site)
        for (const c of site.crew) {
          c.cheerTime = 2.5
          this.ctx?.emotes.show(c, EMOTE.party, 2.5)
        }
      }
    }
  }

  loosen(site, p, impulse) {
    if (p.state !== 'placed') return
    p.state = 'loose'
    p.body.setBodyType(this.R.RigidBodyType.Dynamic, true)
    p.body.wakeUp()
    if (impulse) p.body.applyImpulse(impulse, true)
    site.complete = false
    site.damaged = true
  }

  refreshMesh(site) {
    for (const p of site.pieces) {
      if (p.state === 'placed') _m.compose(p.world, p.rot, p.scale)
      else if (p.state === 'loose') {
        const t = p.body.translation(), r = p.body.rotation()
        _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), p.scale)
      } else _m.copy(ZERO)
      site.mesh.setMatrixAt(p.i, _m)
    }
    site.mesh.instanceMatrix.needsUpdate = true
  }

  // A vehicle smashing into a structure: break the pieces it touches + unsupported ones
  checkImpact(site, veh) {
    if (!veh || veh.speed < 2.5) return
    const dx = veh.x - site.x, dz = veh.z - site.z
    if (dx * dx + dz * dz > (Math.max(site.W, site.D) / 2 + 6) ** 2) return
    const look = 0.12
    const px = veh.x + veh.vx * look, pz = veh.z + veh.vz * look
    let broke = 0
    for (const p of site.pieces) {
      if (p.state !== 'placed') continue
      if (Math.abs(p.world.y - veh.y) > veh.h + 0.6) continue
      const d = Math.hypot(p.world.x - px, p.world.z - pz)
      if (d < veh.r + Math.max(p.half.x, p.half.z) * 0.7) {
        const k = veh.mass * 0.0025 * Math.min(veh.speed, 20) * 0.2
        this.loosen(site, p, { x: veh.vx * k + (Math.random() - 0.5), y: Math.random() * k * 2, z: veh.vz * k + (Math.random() - 0.5) })
        broke++
      }
    }
    if (broke) {
      this.cascade(site)
      this.emit('smash', site, broke)
      for (const c of site.crew) {
        if (c.reaction) continue
        c.upset = 2.2
        this.ctx?.emotes.show(c, Math.random() < 0.5 ? EMOTE.angry : EMOTE.alarm, 2.2)
        c.fist = 1
        if (c.carry && c.state === 'deliver' && c.target?.reserved === c) c.target.reserved = null
      }
    }
  }

  // An explosion: blow apart nearby pieces of every site within reach
  blast(x, y, z, r, power = 1) {
    for (const site of this.sites) {
      if ((site.x - x) ** 2 + (site.z - z) ** 2 > (r + Math.max(site.W, site.D)) ** 2) continue
      let broke = 0
      for (const p of site.pieces) {
        if (p.state !== 'placed') continue
        const dx = p.world.x - x, dy = p.world.y - y, dz = p.world.z - z
        const d = Math.hypot(dx, dy, dz)
        if (d > r) continue
        const v = (1 - d / r) * 14 * power
        this.loosen(site, p, null)
        p.body.setLinvel({ x: (dx / (d || 1)) * v, y: v * 0.7 + 3, z: (dz / (d || 1)) * v }, true)
        p.body.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, true)
        broke++
      }
      if (broke) {
        this.cascade(site)
        this.emit('smash', site, broke)
      }
    }
  }

  cascade(site) {
    let changed = true
    let guard = 0
    while (changed && guard++ < 20) {
      changed = false
      for (const p of site.pieces) {
        if (p.state !== 'placed' || p.ground) continue
        if (!p.supports.some((s) => s.state === 'placed')) {
          this.loosen(site, p, { x: (Math.random() - 0.5) * 2, y: 0, z: (Math.random() - 0.5) * 2 })
          changed = true
        }
      }
    }
  }

  nextSlot(site, c) {
    for (const p of site.order) {
      if (p.state !== 'pile' || (p.reserved && p.reserved !== c)) continue
      if (p.ground || p.supports.some((s) => s.state === 'placed')) return p
    }
    return null
  }

  nearestLoose(site, c) {
    let best = null, bd = 196
    for (const p of site.pieces) {
      if (p.state !== 'loose' || p.reserved) continue
      if (!p.body.isSleeping() && p.body.linvel && Math.hypot(p.body.linvel().x, p.body.linvel().z) > 0.3) continue
      const t = p.body.translation()
      const d = (t.x - c.x) ** 2 + (t.z - c.z) ** 2
      if (d < bd) { bd = d; best = p }
    }
    return best
  }

  standSpot(site, p) {
    // stand just outside the wall, facing the slot
    const sl = p.slot
    const len = Math.hypot(sl.x, sl.z) || 1
    const out = site.type === 'tower' ? 1.1 : 1.0
    let lx = sl.x + (sl.x / len) * out, lz = sl.z + (sl.z / len) * out
    if (site.type !== 'tower') {
      if (Math.abs(Math.sin(sl.ry)) > 0.7) lx = sl.x + Math.sign(sl.x || 1) * out
      else lz = sl.z + Math.sign(sl.z || 1) * out
    }
    return this.toWorld(site, lx, lz)
  }

  update(dt, time, ctx, vehicle) {
    this.ctx = ctx
    for (const site of this.sites) {
      if (vehicle) this.checkImpact(site, vehicle)
      // loose pieces: recover lost ones, update visuals
      let anyLoose = false
      for (const p of site.pieces) {
        if (p.state !== 'loose') continue
        anyLoose = true
        const t = p.body.translation()
        if (t.y < -3 || Math.hypot(t.x - site.x, t.z - site.z) > 30) {
          p.state = 'pile'
          p.reserved = null
          p.body.setEnabled(false)
        }
      }
      if (anyLoose || site.dirty) {
        this.refreshMesh(site)
        site.dirty = false
      }
      if (site.roof) {
        const target = site.complete ? 1 : 0.001
        const s = damp(site.roof.scale.x, target, site.complete ? 3 : 12, dt)
        site.roof.scale.setScalar(s)
        site.roof.visible = s > 0.01
      }
      site.boost = Math.max(0, site.boost - dt)
      for (const c of site.crew) this.updateBuilder(site, c, dt, time, ctx)
    }
  }

  updateBuilder(site, c, dt, time, ctx) {
    if (updateReaction(c, dt, ctx)) {
      if (c.carrying) this.drop(site, c)
      c.state = 'fetch'
      return
    }
    const speedMul = site.boost > 0 ? 1.6 : 1
    c.y = damp(c.y, ctx.ground(c.x, c.z) + (c.high ? 1.25 : 0), 10, dt)
    if (c.upset > 0) {
      c.upset -= dt
      c.walk = damp(c.walk, 0, 8, dt)
      if (c.upset <= 0) c.fist = 0
      return
    }
    if (c.cheerTime > 0) {
      c.cheerTime -= dt
      c.cheer = 1
      c.hop = Math.abs(Math.sin(time * 8)) * 0.2
      if (c.cheerTime <= 0) { c.cheer = 0; c.hop = 0 }
      return
    }
    c.timer -= dt
    switch (c.state) {
      case 'fetch': {
        c.carry = 0
        c.hammer = 0
        c.kneel = damp(c.kneel, 0, 8, dt)
        c.high = false
        if (site.complete) { c.state = 'inspect'; c.timer = 0; break }
        // prefer fallen pieces that have come to rest
        const loose = this.nearestLoose(site, c)
        if (loose) {
          loose.reserved = c
          c.pickup = loose
          c.state = 'toLoose'
          break
        }
        const slot = this.nextSlot(site, c)
        if (!slot) { c.state = 'inspect'; c.timer = 2; break }
        slot.reserved = c
        c.target = slot
        c.state = 'toPile'
        break
      }
      case 'toLoose': {
        const p = c.pickup
        if (!p || p.state !== 'loose') { c.state = 'fetch'; break }
        const t = p.body.translation()
        if (walkTo(c, t.x, t.z, c.speed * speedMul, dt, ctx, 0.8)) {
          c.kneel = 1
          c.timer = 0.6
          c.state = 'pickLoose'
        }
        break
      }
      case 'pickLoose': {
        c.kneel = damp(c.kneel, 1, 10, dt)
        if (c.timer > 0) break
        const p = c.pickup
        if (p.state === 'loose') {
          p.state = 'pile' // returns to the pool, carried as an item
          p.reserved = null
          p.body.setEnabled(false)
          site.dirty = true
        }
        c.pickup = null
        this.startCarry(site, c)
        break
      }
      case 'toPile':
        if (walkTo(c, site.pile.x, site.pile.z, c.speed * speedMul, dt, ctx, 1.0)) {
          c.kneel = 1
          c.timer = 0.5 / speedMul
          c.state = 'pick'
        }
        break
      case 'pick':
        c.kneel = damp(c.kneel, 1, 10, dt)
        if (c.timer <= 0) this.startCarry(site, c)
        break
      case 'deliver': {
        const p = c.target
        if (!p || p.state !== 'pile') { c.state = 'fetch'; this.drop(site, c); break }
        const spot = this.standSpot(site, p)
        if (walkTo(c, spot.x, spot.z, c.speed * 0.9 * speedMul, dt, ctx, 0.3)) {
          c.heading += angleDelta(c.heading, Math.atan2(p.world.x - c.x, p.world.z - c.z)) * Math.min(1, dt * 8)
          c.high = p.slot.y > 1.6 && site.H > 2
          c.kneel = p.slot.y < 0.6 ? 1 : 0
          c.carry = 0
          c.hammer = 1
          c.timer = 1.0 / speedMul
          c.state = 'place'
          ctx.onHammer?.(c.x, c.z)
        }
        break
      }
      case 'place':
        c.heading += angleDelta(c.heading, Math.atan2(c.target.world.x - c.x, c.target.world.z - c.z)) * Math.min(1, dt * 8)
        if (c.timer <= 0) {
          const p = c.target
          if (p && p.state === 'pile' && (p.ground || p.supports.some((s) => s.state === 'placed'))) this.place(site, p)
          else if (p) p.reserved = null
          c.target = null
          c.carrying = false
          c.hammer = 0
          c.state = 'fetch'
        }
        break
      case 'inspect': {
        c.carry = 0
        if (!site.complete) { c.state = 'fetch'; break }
        if (c.timer <= 0) {
          const a = this.rnd.random() * Math.PI * 2
          c.goal = this.toWorld(site, Math.cos(a) * (site.W / 2 + 1.2), Math.sin(a) * (site.D / 2 + 1.2))
          c.timer = this.rnd.range(4, 8)
        }
        if (c.goal && walkTo(c, c.goal.x, c.goal.z, 1.0, dt, ctx, 0.4)) {
          c.hammer = Math.sin(time * 0.7 + c.index) > 0.3 ? 1 : 0
          c.heading += angleDelta(c.heading, Math.atan2(site.x - c.x, site.z - c.z)) * Math.min(1, dt * 4)
        }
        break
      }
    }
  }

  startCarry(site, c) {
    c.kneel = 0
    c.carry = 1
    c.carrying = true
    this.rig.setItem(c, site.T.item)
    if (!c.target || c.target.state !== 'pile') {
      const slot = this.nextSlot(site, c)
      if (c.target && c.target !== slot) c.target.reserved = null
      c.target = slot
      if (slot) slot.reserved = c
    }
    c.state = c.target ? 'deliver' : 'fetch'
  }

  drop(site, c) {
    c.carry = 0
    c.carrying = false
    if (c.target && c.target.reserved === c) c.target.reserved = null
    c.target = null
    if (c.pickup && c.pickup.reserved === c) c.pickup.reserved = null
    c.pickup = null
  }

  // Courier supply delivery speeds a site up for a while
  supply(site, seconds = 60) {
    site.boost = seconds
    for (const c of site.crew) this.ctx?.emotes.show(c, EMOTE.love, 2)
  }

  progress(site) {
    return site.pieces.filter((p) => p.state === 'placed').length / site.pieces.length
  }
}
