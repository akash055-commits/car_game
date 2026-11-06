// Combat: the player's arsenal, aiming, hitscan bullets (Rapier ray casts against the
// world + CPU capsule tests against the instanced townsfolk), rockets / tank shells,
// explosions (damage, impulses, wrecks, scorch marks), tracers, muzzle flashes, bullet
// holes and vehicle fires. NPC shooters (police, gang members) use the same bullets.
import * as THREE from 'three'
import { WEAPONS, WEAPON_BY_ID } from './Weapons.js'
import { clamp, damp } from '../core/math.js'

const _o = new THREE.Vector3()
const _d = new THREE.Vector3()
const _p = new THREE.Vector3()
const _n = new THREE.Vector3()
const _t = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const Z = new THREE.Vector3(0, 0, 1)
const _ray = new THREE.Raycaster()

// Ray (o + d·t) against an upright capsule; returns the hit distance or -1
function rayCapsule(o, d, cx, y0, y1, cz, r, maxT) {
  const ox = o.x - cx, oz = o.z - cz
  const a = d.x * d.x + d.z * d.z
  let t = -1
  if (a > 1e-8) {
    const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r
    const disc = b * b - 4 * a * c
    if (disc >= 0) {
      const sq = Math.sqrt(disc)
      t = (-b - sq) / (2 * a)
      if (t < 0) t = (-b + sq) / (2 * a)
    }
  } else if (ox * ox + oz * oz <= r * r) t = (y1 - o.y) / (d.y || -1)
  if (t < 0 || t > maxT) return -1
  const y = o.y + d.y * t
  return y >= y0 && y <= y1 ? t : -1
}

function spotTexture(inner, outer) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const g = cv.getContext('2d')
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, inner)
  grd.addColorStop(0.45, inner)
  grd.addColorStop(1, outer)
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Combat {
  constructor(game) {
    this.game = game
    this.scene = game.scene
    this.physics = game.physics
    this.R = game.physics.RAPIER
    this.listeners = {}
    this.inv = {}
    for (const w of WEAPONS) this.inv[w.id] = { clip: w.clip ?? Infinity, ammo: w.ammo ?? Infinity }
    this.current = 'pistol'
    this.cooldown = 0
    this.reloadT = 0
    this.bloom = 0
    this.punchT = -1
    this.faceT = 0
    this.lastScare = 0
    this.aimScan = 0
    this.projectiles = []
    this.burning = new Set()
    this.buildPools()
  }

  on(n, fn) {
    ;(this.listeners[n] ||= []).push(fn)
  }

  emit(n, ...a) {
    for (const fn of this.listeners[n] || []) fn(...a)
  }

  get weapon() {
    return WEAPON_BY_ID[this.current]
  }

  // ---------------------------------------------------------------- visuals pools
  buildPools() {
    // tracers
    this.tracerMax = 64
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.tracerMax * 6), 3).setUsage(THREE.DynamicDrawUsage))
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.tracerMax * 6), 3).setUsage(THREE.DynamicDrawUsage))
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.tracers.frustumCulled = false
    this.tracers.renderOrder = 8
    this.scene.add(this.tracers)
    this.tracerList = []
    this.tracerCursor = 0
    // bullet holes + scorch marks (instanced decals)
    const decalMat = (tex) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
    const plane = new THREE.PlaneGeometry(1, 1)
    this.holes = new THREE.InstancedMesh(plane, decalMat(spotTexture('rgba(20,16,14,0.95)', 'rgba(20,16,14,0)')), 160)
    this.scorch = new THREE.InstancedMesh(plane, decalMat(spotTexture('rgba(12,10,9,0.85)', 'rgba(30,24,20,0)')), 24)
    for (const m of [this.holes, this.scorch]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.frustumCulled = false
      m.count = 0
      m.renderOrder = 2
      this.scene.add(m)
    }
    this.holeCursor = 0
    this.scorchCursor = 0
    // muzzle / explosion flash light
    this.flash = new THREE.PointLight(0xffb060, 0, 12, 1.6)
    this.scene.add(this.flash)
    this.flashK = 0
    // rockets / shells
    this.rocketGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8).rotateX(Math.PI / 2)
    this.rocketMat = new THREE.MeshStandardMaterial({ color: 0x4f5b3a, emissive: 0xff8030, emissiveIntensity: 0.4 })
    this.shellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2) })
  }

  addTracer(a, b, strength = 1) {
    const i = this.tracerCursor
    this.tracerCursor = (i + 1) % this.tracerMax
    this.tracerList[i] = { a: a.clone(), b: b.clone(), life: 0.07, max: 0.07, k: strength }
  }

  addHole(p, n) {
    const i = this.holeCursor
    this.holeCursor = (i + 1) % this.holes.instanceMatrix.count
    _q.setFromUnitVectors(Z, n)
    const sc = 0.13 + Math.random() * 0.06
    _m.compose(_p.copy(p).addScaledVector(n, 0.02), _q, _s.set(sc, sc, 1))
    this.holes.setMatrixAt(i, _m)
    this.holes.count = Math.max(this.holes.count, i + 1)
    this.holes.instanceMatrix.needsUpdate = true
  }

  addScorch(p, r) {
    const i = this.scorchCursor
    this.scorchCursor = (i + 1) % this.scorch.instanceMatrix.count
    const n = this.game.layout.getNormal(p.x, p.z, _n)
    _q.setFromUnitVectors(Z, n)
    _m.compose(_p.set(p.x, this.game.layout.getDriveHeight(p.x, p.z) + 0.04, p.z), _q, _s.set(r, r, 1))
    this.scorch.setMatrixAt(i, _m)
    this.scorch.count = Math.max(this.scorch.count, i + 1)
    this.scorch.instanceMatrix.needsUpdate = true
  }

  flashAt(p, intensity = 30, distance = 12) {
    this.flash.position.copy(p)
    this.flash.distance = distance
    this.flashK = Math.max(this.flashK, intensity)
  }

  // ---------------------------------------------------------------- arsenal
  has(id) {
    const w = WEAPON_BY_ID[id]
    const inv = this.inv[id]
    return w.melee || inv.clip > 0 || inv.ammo > 0
  }

  select(id) {
    if (!WEAPON_BY_ID[id] || id === this.current) return
    if (!this.has(id)) return this.emit('notice', `No ammo for the ${WEAPON_BY_ID[id].name}`)
    this.current = id
    this.reloadT = 0
    this.cooldown = 0.25
    this.emit('switch', WEAPON_BY_ID[id])
  }

  selectSlot(slot) {
    const w = WEAPONS.find((k) => k.slot === slot)
    if (w) this.select(w.id)
  }

  cycle(dir) {
    const list = WEAPONS.filter((w) => this.has(w.id) && (!this.game.active || w.driveBy || w.melee))
    let i = list.findIndex((w) => w.id === this.current)
    i = (i + dir + list.length) % list.length
    this.select(list[i].id)
  }

  reload() {
    const w = this.weapon
    const inv = this.inv[w.id]
    if (w.melee || this.reloadT > 0 || inv.clip >= w.clip || inv.ammo <= 0) return
    this.reloadT = w.reload
    this.emit('reload', w)
  }

  finishReload() {
    const w = this.weapon
    const inv = this.inv[w.id]
    const take = Math.min(w.clip - inv.clip, inv.ammo)
    inv.clip += take
    inv.ammo -= take
  }

  addAmmo(id, n) {
    const inv = this.inv[id]
    if (inv) inv.ammo += n
  }

  refillAll() {
    for (const w of WEAPONS) {
      if (w.melee) continue
      this.inv[w.id].ammo = Math.max(this.inv[w.id].ammo, w.ammo)
      this.inv[w.id].clip = w.clip
    }
  }

  // ---------------------------------------------------------------- aiming
  // Where the player is aiming: screen centre (third / chase) or the cursor (overhead)
  aim() {
    const g = this.game
    const ndc = g.rig.aimNdc(g.input.cursor)
    _ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), g.camera)
    const o = _ray.ray.origin, d = _ray.ray.direction
    const excludeBody = g.active ? g.active.phys.body : g.player.body
    const hit = this.castWorld(o, d, 500, excludeBody, 'player')
    let t = hit ? hit.timeOfImpact : 500
    const ch = this.castCharacters(o, d, t, 'player')
    if (ch) t = ch.t
    // in the overhead view, aim at chest height over the ground point
    const point = o.clone().addScaledVector(d, t)
    if (g.rig.mode === 'diorama' && !ch) point.y += 1.0
    return { origin: o.clone(), dir: d.clone(), point, char: ch?.c || null, dist: t }
  }

  muzzle(aimPoint) {
    const g = this.game
    const p = new THREE.Vector3()
    if (g.active) {
      // drive-by: from the driver's window
      const v = g.active
      const side = new THREE.Vector3(v.type === 'bike' ? 0.35 : 0.85, v.type === 'bike' ? 1.15 : 0.95, 0.2).applyQuaternion(v.quat)
      p.copy(v.pos).add(side)
    } else {
      const c = g.player.char
      if (c.handMatrix) p.setFromMatrixPosition(c.handMatrix)
      else p.set(g.player.pos.x, g.player.pos.y + 1.35, g.player.pos.z)
      const d = _d.copy(aimPoint).sub(p).normalize()
      p.addScaledVector(d, this.weapon.hold === 'pistol' ? 0.25 : 0.6)
    }
    return p
  }

  canShoot() {
    const g = this.game
    if (g.player.dead || g.player.knock) return false
    const a = g.active
    if (!a) return true
    if (a.type === 'heli' || a.type === 'tank') return false
    return !!this.weapon.driveBy
  }

  // ---------------------------------------------------------------- firing (player)
  update(dt, input) {
    const g = this.game
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.bloom = Math.max(0, this.bloom - dt * 0.12)
    this.faceT = Math.max(0, this.faceT - dt)
    if (this.reloadT > 0) {
      this.reloadT -= dt
      if (this.reloadT <= 0) this.finishReload()
    }
    const w = this.weapon
    const onFoot = !g.active
    const pc = g.player.char
    // aiming (right mouse on foot)
    const aiming = onFoot && !g.player.dead && input.aimHeld && !w.melee
    g.rig.aiming = aiming && g.rig.mode === 'third'
    g.rig.scope = g.rig.aiming && !!w.scope
    const firing = input.fire && this.canShoot()
    if (firing && this.cooldown <= 0 && (w.auto || !this.held)) this.fire()
    this.held = input.fire
    // weapon pose on the player
    if (onFoot) {
      pc.weapon = w.melee ? null : w.id
      pc.aim = damp(pc.aim || 0, aiming || this.faceT > 0 ? 1 : 0, 14, dt)
      pc.holdGun = !w.melee
      pc.aimPitch = g.rig.mode === 'third' ? clamp(-g.rig.pitch * 0.9, -0.6, 0.8) : 0
      if ((aiming || this.faceT > 0 || (g.rig.mode === 'diorama' && input.fire)) && !g.player.dead) {
        const a = this.lastAim || this.aim()
        g.player.faceYaw = Math.atan2(a.point.x - g.player.pos.x, a.point.z - g.player.pos.z)
      } else g.player.faceYaw = undefined
      // pointing a gun at someone makes them put their hands up
      this.aimScan -= dt
      if (aiming && this.aimScan <= 0) {
        this.aimScan = 0.3
        const a = this.aim()
        this.lastAim = a
        const c = a.char
        if (c && a.dist < 18 && !c.reaction && !c.fights && !c.noReact) c.reaction = { type: 'handsup', t: 0, d: 2.5, fx: g.player.pos.x, fz: g.player.pos.z }
      }
    } else {
      pc.aim = 0
      pc.holdGun = false
      g.player.faceYaw = undefined
    }
    // punch animation
    if (this.punchT >= 0) {
      this.punchT += dt
      pc.punch = Math.min(1, this.punchT / 0.35)
      if (!this.punchHit && this.punchT > 0.15) this.resolvePunch()
      if (this.punchT > 0.4) { this.punchT = -1; pc.punch = 0 }
    }
    this.updateProjectiles(dt)
    this.updateFires(dt)
    this.updateVisuals(dt)
  }

  fire() {
    const g = this.game
    const w = this.weapon
    if (w.melee) {
      if (g.active) return
      this.cooldown = 1 / w.rate
      this.punchT = 0
      this.punchHit = false
      g.player.faceYaw = g.rig.mode === 'diorama' ? undefined : g.rig.forwardYaw()
      this.faceT = 0.4
      return
    }
    const inv = this.inv[w.id]
    if (this.reloadT > 0) return
    if (inv.clip <= 0) {
      this.cooldown = 0.3
      if (inv.ammo > 0) this.reload()
      else this.emit('empty', w)
      return
    }
    inv.clip--
    this.cooldown = 1 / w.rate
    const a = this.aim()
    this.lastAim = a
    const muzzle = this.muzzle(a.point)
    const base = _t.copy(a.point).sub(muzzle).normalize().clone()
    const spread = (g.rig.aiming ? w.aimSpread : w.spread) + this.bloom
    if (w.projectile) this.launchRocket(muzzle, base, 'player')
    else {
      for (let k = 0; k < (w.pellets || 1); k++) {
        const dir = base.clone()
        if (spread > 0) {
          dir.x += (Math.random() - 0.5) * 2 * spread
          dir.y += (Math.random() - 0.5) * 2 * spread
          dir.z += (Math.random() - 0.5) * 2 * spread
          dir.normalize()
        }
        this.hitscan(muzzle, dir, w.range, w.damage, 'player', k === 0)
      }
    }
    this.bloom = Math.min(0.08, this.bloom + (w.bloom || 0))
    g.effects.muzzle(muzzle, base)
    this.flashAt(muzzle, w.id === 'sniper' ? 40 : 22, 10)
    g.rig.kick(w.recoil || 0.05)
    this.faceT = 0.7
    if (inv.clip === 0 && inv.ammo > 0) setTimeout(() => this.reload(), 250)
    this.emit('shot', w, muzzle, 'player')
    this.disturb(muzzle, w.id === 'sniper' || w.id === 'shotgun' ? 55 : 40)
  }

  // Shots scare people and make drivers panic (throttled)
  disturb(p, radius) {
    const now = performance.now()
    if (now - this.lastScare < 400) return
    this.lastScare = now
    const seen = this.game.people.scare(p.x, p.z, radius, 'gunshot')
    this.game.traffic.panicNear(p.x, p.z, radius)
    this.emit('disturbance', p, seen)
  }

  resolvePunch() {
    const g = this.game
    this.punchHit = true
    const p = g.player.pos
    const h = g.player.heading
    const fx = Math.sin(h), fz = Math.cos(h)
    let best = null, bd = 1.9 * 1.9
    for (const c of g.crowd.list) {
      if (c.isPlayer || c.down || !c.visible || c.drive > 0.5) continue
      const dx = c.x - p.x, dz = c.z - p.z
      const d2 = dx * dx + dz * dz
      if (d2 > bd || Math.abs(c.y - p.y) > 1.2) continue
      if ((dx * fx + dz * fz) / Math.sqrt(d2 || 1) < 0.35) continue
      bd = d2
      best = c
    }
    this.emit('punch', !!best)
    if (best) {
      this.hitCharacter(best, WEAPON_BY_ID.fists.damage, p, 'melee', 'player')
      g.rig.addShake(0.12)
    }
  }

  // ---------------------------------------------------------------- hit detection
  castWorld(o, d, maxT, excludeBody = null, owner = 'player') {
    const R = this.R
    const ray = new R.Ray({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z })
    const pred = (col) => {
      const tag = this.physics.getTag(col.handle)
      if (tag?.kind === 'player') return false
      if (col.isSensor()) return false
      return true
    }
    return this.physics.world.castRayAndGetNormal(ray, maxT, true, undefined, undefined, undefined, excludeBody || undefined, pred)
  }

  castCharacters(o, d, maxT, owner, shooter = null) {
    let best = null, bt = maxT
    const g = this.game
    for (const c of g.crowd.list) {
      if (!c.visible || c.hidden || c.down || c === shooter) continue
      if (c.isPlayer) {
        if (owner === 'player' || g.active || g.player.dead) continue
      } else if (c.drive > 0.5 || c.ride > 0.5) continue
      // quick reject: distance from the ray's line
      const ex = c.x - o.x, ey = c.y + 1 - o.y, ez = c.z - o.z
      const along = ex * d.x + ey * d.y + ez * d.z
      if (along < 0 || along > bt + 2) continue
      const px = ex - d.x * along, py = ey - d.y * along, pz = ez - d.z * along
      if (px * px + py * py + pz * pz > 4) continue
      const sc = c.scale || 1
      const top = c.y + (c.sit > 0.5 || c.cower > 0.5 ? 1.25 : 1.78) * sc
      const t = rayCapsule(o, d, c.x, c.y + 0.05, top, c.z, 0.3 * (c.width || 1) * sc, bt)
      if (t >= 0 && t < bt) {
        bt = t
        best = { c, t, head: o.y + d.y * t > top - 0.28 * sc }
      }
    }
    return best
  }

  hitscan(o, d, range, dmg, owner = 'player', tracer = true, shooter = null) {
    const g = this.game
    const exclude = owner === 'player' ? (g.active ? g.active.phys.body : g.player.body) : shooter?.vehicleBody || null
    const hit = this.castWorld(o, d, range, exclude, owner)
    const tWorld = hit ? hit.timeOfImpact : range
    const ch = this.castCharacters(o, d, tWorld, owner, shooter)
    const end = o.clone().addScaledVector(d, ch ? ch.t : tWorld)
    if (tracer) this.addTracer(o, end, owner === 'player' ? 1 : 0.7)
    if (ch) {
      this.hitCharacter(ch.c, dmg * (ch.head ? 2.5 : 1), o, 'bullet', owner, end)
      return { kind: 'char', c: ch.c, point: end }
    }
    if (!hit) {
      // near-miss whiz when an NPC shoots past the player
      if (owner !== 'player') this.nearMiss(o, d, range)
      return null
    }
    const n = _n.set(hit.normal.x, hit.normal.y, hit.normal.z)
    const tag = this.physics.getTag(hit.collider.handle)
    this.hitCollider(hit.collider, tag, end, d, dmg, owner, n)
    if (owner !== 'player') this.nearMiss(o, d, tWorld)
    return { kind: tag?.kind || 'world', point: end, collider: hit.collider }
  }

  nearMiss(o, d, len) {
    const p = this.game.player.pos
    const ex = p.x - o.x, ey = p.y + 1.4 - o.y, ez = p.z - o.z
    const along = ex * d.x + ey * d.y + ez * d.z
    if (along < 0 || along > len) return
    const dist2 = (ex - d.x * along) ** 2 + (ey - d.y * along) ** 2 + (ez - d.z * along) ** 2
    if (dist2 < 9) this.emit('whiz', o)
  }

  hitCharacter(c, dmg, from, kind, owner, point = null) {
    const g = this.game
    if (c.isPlayer) {
      const inCar = !!g.active
      g.player.damage(dmg * (inCar ? 0.3 : 1), from, kind)
      return
    }
    const downed = g.people.hit(c, dmg, from, kind)
    if (point) g.effects.impactPuff(point, _n.set(from.x - c.x, 0.4, from.z - c.z).normalize(), 'flesh')
    this.emit('hitChar', c, downed, owner, kind)
  }

  hitCollider(col, tag, point, d, dmg, owner, normal) {
    const g = this.game
    const kind = tag?.kind
    const body = col.parent()
    const material = tag?.material || 'stone'
    if (kind === 'traffic') {
      const car = g.traffic.byBody(body)
      if (car) g.traffic.damage(car, dmg * 0.45, null, 'bullet')
      this.emit('hitVehicle', car, owner)
    } else if (kind === 'car') {
      const v = g.vehicles.find((k) => k.phys.body === body) || g.police?.vehicleByBody(body)
      if (v) this.damageVehicle(v, dmg * 0.5, null, owner)
    } else if (kind === 'plane') {
      g.aviation.damage?.(body, dmg)
    } else if (body && body.isDynamic()) {
      body.applyImpulseAtPoint({ x: d.x * dmg * 0.6, y: d.y * dmg * 0.6, z: d.z * dmg * 0.6 }, { x: point.x, y: point.y, z: point.z }, true)
    }
    if (kind !== 'car' && kind !== 'traffic' && body && !body.isDynamic()) this.addHole(point, normal)
    g.effects.impactPuff(point, normal, material)
    this.emit('impact', point, material, owner)
  }

  // ---------------------------------------------------------------- NPC shooters
  // shooter: character (police / gang); target: {x, y, z}; accuracy 0..1
  npcFire(shooter, target, weaponId = 'pistol', accuracy = 0.5) {
    const w = WEAPON_BY_ID[weaponId]
    const o = new THREE.Vector3(shooter.x, shooter.y + 1.4 * (shooter.scale || 1), shooter.z)
    const fx = Math.sin(shooter.heading), fz = Math.cos(shooter.heading)
    o.x += fx * 0.5 + fz * 0.2
    o.z += fz * 0.5 - fx * 0.2
    const d = new THREE.Vector3(target.x - o.x, target.y - o.y, target.z - o.z).normalize()
    const miss = (1 - accuracy) * 0.12 + w.spread
    d.x += (Math.random() - 0.5) * 2 * miss
    d.y += (Math.random() - 0.5) * 2 * miss * 0.5
    d.z += (Math.random() - 0.5) * 2 * miss
    d.normalize()
    for (let k = 0; k < (w.pellets || 1); k++) this.hitscan(o, d, w.range, w.damage * 0.55, 'npc', k === 0, shooter)
    this.game.effects.muzzle(o, d)
    this.emit('shot', w, o, 'npc')
    this.disturb(o, 35)
  }

  // ---------------------------------------------------------------- projectiles
  launchRocket(o, d, owner = 'player', kind = 'rocket', shooterBody = null) {
    const mesh = new THREE.Mesh(this.rocketGeo, kind === 'shell' ? this.shellMat : this.rocketMat)
    mesh.position.copy(o)
    this.scene.add(mesh)
    const speed = kind === 'shell' ? 140 : 55
    this.projectiles.push({ kind, owner, pos: o.clone(), vel: d.clone().multiplyScalar(speed), life: kind === 'shell' ? 4 : 6, mesh, trail: 0, exclude: shooterBody })
    if (kind === 'rocket') this.emit('rocket', o, owner)
  }

  updateProjectiles(dt) {
    const g = this.game
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]
      pr.life -= dt
      if (pr.kind === 'shell') pr.vel.y -= 4 * dt
      const step = pr.vel.length() * dt
      const d = _d.copy(pr.vel).normalize()
      const exclude = pr.owner === 'player' ? (pr.exclude || (g.active ? g.active.phys.body : g.player.body)) : pr.exclude
      const hit = this.castWorld(pr.pos, d, step, exclude, pr.owner)
      const ch = this.castCharacters(pr.pos, d, hit ? hit.timeOfImpact : step, pr.owner)
      const groundY = g.layout.getHeight(pr.pos.x, pr.pos.z)
      if (hit || ch || pr.pos.y < groundY || pr.life <= 0) {
        const t = ch ? ch.t : hit ? hit.timeOfImpact : 0
        const at = pr.pos.clone().addScaledVector(d, t)
        if (pr.pos.y < groundY) at.y = groundY + 0.1
        this.explode(at, { radius: pr.kind === 'shell' ? 8 : 7, damage: pr.kind === 'shell' ? 320 : 260, owner: pr.owner, size: pr.kind === 'shell' ? 1.3 : 1 })
        pr.mesh.removeFromParent()
        this.projectiles.splice(i, 1)
        continue
      }
      pr.pos.addScaledVector(pr.vel, dt)
      pr.mesh.position.copy(pr.pos)
      pr.mesh.quaternion.setFromUnitVectors(Z, d)
      pr.trail -= dt
      if (pr.trail <= 0) {
        pr.trail = 0.02
        g.effects.smokeTrail(pr.pos, pr.kind === 'shell' ? 0.1 : 0.35, pr.kind === 'rocket')
      }
    }
  }

  // ---------------------------------------------------------------- explosions
  explode(p, { radius = 7, damage = 250, owner = 'player', size = 1 } = {}) {
    const g = this.game
    g.effects.explosion(p, size)
    this.flashAt(p.clone().setY(p.y + 1.5), 160 * size, 45)
    this.addScorch(p, radius * 0.55)
    const camD = g.camera.position.distanceTo(p)
    g.rig.addShake(clamp(1.2 - camD / 60, 0, 1) * size)
    // people
    for (const c of g.crowd.list) {
      if (!c.visible || c.down || c.drive > 0.5) continue
      const d = Math.hypot(c.x - p.x, c.y + 1 - p.y, c.z - p.z)
      if (d > radius * 1.4) continue
      const k = Math.max(0, 1 - d / (radius * 1.4))
      if (c.isPlayer) continue
      this.hitCharacter(c, damage * k * 1.5, p, 'explosion', owner)
    }
    // the player on foot: hurt and thrown
    if (!g.active && !g.player.dead) {
      const pp = g.player.pos
      const d = Math.hypot(pp.x - p.x, pp.y + 1 - p.y, pp.z - p.z)
      if (d < radius * 1.3) {
        const k = 1 - d / (radius * 1.3)
        g.player.damage(damage * 0.45 * k, p, 'explosion')
        const dx = (pp.x - p.x) / (d || 1), dz = (pp.z - p.z) / (d || 1)
        if (k > 0.25) g.player.knockOver(dx * 9 * k, 6 * k + 2, dz * 9 * k)
      }
    }
    // traffic: wrecked and thrown
    for (const c of g.traffic.cars) {
      if (c.state === 'hidden') continue
      const d = c.pos.distanceTo(p)
      if (d > radius * 1.5) continue
      const k = 1 - d / (radius * 1.5)
      const dir = _t.copy(c.pos).sub(p).setY(0).normalize()
      g.traffic.damage(c, damage * k * 1.2, { x: dir.x * 9000 * k, y: 14000 * k + 4000, z: dir.z * 9000 * k }, 'explosion')
    }
    // player vehicles (parked or driven)
    for (const v of [...g.vehicles, ...(g.police?.vehicles || [])]) {
      const d = v.pos.distanceTo(p)
      if (d > radius * 1.5) continue
      const k = 1 - d / (radius * 1.5)
      const dir = _t.copy(v.pos).sub(p).normalize()
      const m = v.phys.mass || 1000
      this.damageVehicle(v, damage * k * (v.type === 'tank' ? 0.15 : 1.4), { x: dir.x * m * 7 * k, y: m * 8 * k, z: dir.z * m * 7 * k }, owner)
    }
    // loose props + construction sites
    const ball = new this.R.Ball(radius)
    this.physics.world.intersectionsWithShape({ x: p.x, y: p.y, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, ball, (col) => {
      const b = col.parent()
      if (!b || !b.isDynamic()) return true
      const tag = this.physics.getTag(col.handle)
      if (tag?.kind === 'car') return true
      const t = b.translation()
      const dx = t.x - p.x, dy = t.y - p.y + 1, dz = t.z - p.z
      const d = Math.hypot(dx, dy, dz) || 1
      const k = Math.max(0, 1 - d / radius) * b.mass() * 9
      b.applyImpulse({ x: (dx / d) * k, y: (dy / d) * k + k * 0.5, z: (dz / d) * k }, true)
      return true
    })
    g.construction.blast(p.x, p.y, p.z, radius, size)
    g.aviation.blast?.(p, radius)
    const seen = g.people.scare(p.x, p.z, 70, 'explosion')
    g.traffic.panicNear(p.x, p.z, 70)
    this.emit('explosion', p, size, owner, seen)
  }

  // ---------------------------------------------------------------- vehicle damage + fires
  damageVehicle(v, amount, impulse = null, owner = 'player') {
    const ph = v.phys
    if (v.wrecked) {
      if (impulse) ph.body.applyImpulse(impulse, true)
      return
    }
    ph.health = Math.max(0, ph.health - amount)
    if (impulse) ph.body.applyImpulse(impulse, true)
    if (ph.health < ph.maxHealth * 0.3) this.burning.add(v)
    if (ph.health <= 0 && !v.burnT) v.burnT = 2.5
    this.emit('vehicleDamaged', v, amount, owner)
  }

  updateFires(dt) {
    const g = this.game
    for (const v of this.burning) {
      if (!v.phys || !g.vehicles.includes(v) && !(g.police?.vehicles || []).includes(v)) { this.burning.delete(v); continue }
      const ph = v.phys
      const k = 1 - ph.health / ph.maxHealth
      v.smokeAcc = (v.smokeAcc || 0) + dt * (v.wrecked ? 6 : 4 + k * 10)
      while (v.smokeAcc > 1) {
        v.smokeAcc -= 1
        g.effects.smokeTrail(_p.copy(v.pos).setY(v.pos.y + 0.8), 0.6 + k * 0.6, k > 0.88 || !!v.burnT || (v.wrecked && v.wreckT < 15))
      }
      if (v.burnT) {
        v.burnT -= dt
        if (v.burnT <= 0) {
          v.burnT = 0
          this.wreckVehicle(v)
        }
      }
      if (v.wrecked) {
        v.wreckT += dt
        const pp = g.player.pos
        if (v.wreckT > 30 && v !== g.active && (v.pos.x - pp.x) ** 2 + (v.pos.z - pp.z) ** 2 > 70 * 70) {
          this.burning.delete(v)
          if (g.vehicles.includes(v)) g.recycleVehicle(v)
        }
      }
    }
    // burning traffic cars
    for (const c of g.traffic.cars) {
      if (c.state === 'burning' || (c.state === 'wrecked' && c.timer < 16)) {
        c.smokeAcc = (c.smokeAcc || 0) + dt * 8
        while (c.smokeAcc > 1) {
          c.smokeAcc -= 1
          g.effects.smokeTrail(_p.copy(c.pos).setY(c.pos.y + 1.0), 0.9, true)
        }
      }
    }
  }

  wreckVehicle(v) {
    const g = this.game
    v.wrecked = true
    v.wreckT = 0
    v.burnT = 0
    v.phys.health = 0
    this.explode(v.pos.clone().setY(v.pos.y + 0.6), { radius: 6, damage: 160, owner: 'world', size: v.type === 'bike' ? 0.7 : 1.1 })
    // char the paint
    v.visual.group.traverse((o) => {
      if (!o.isMesh || !o.material || o.userData.burnt) return
      o.userData.burnt = true
      o.userData.origMat = o.material
      const m = o.material.clone()
      if (m.color) m.color.multiplyScalar(0.18)
      if (m.emissive) m.emissive.setScalar(0)
      o.material = m
    })
    if (g.active === v) {
      g.player.damage(999, v.pos, 'explosion')
    }
    this.emit('vehicleWrecked', v)
  }

  repairVehicle(v) {
    v.wrecked = false
    v.burnT = 0
    v.phys.repair()
    this.burning.delete(v)
    v.visual.group.traverse((o) => {
      if (o.isMesh && o.userData.burnt) {
        o.material = o.userData.origMat
        o.userData.burnt = false
      }
    })
  }

  // ---------------------------------------------------------------- per-frame visuals
  updateVisuals(dt) {
    // tracers
    const pos = this.tracers.geometry.attributes.position
    const col = this.tracers.geometry.attributes.color
    for (let i = 0; i < this.tracerMax; i++) {
      const tr = this.tracerList[i]
      if (!tr || tr.life <= 0) {
        pos.setXYZ(i * 2, 0, -999, 0)
        pos.setXYZ(i * 2 + 1, 0, -999, 0)
        continue
      }
      tr.life -= dt
      const k = Math.max(0, tr.life / tr.max) * tr.k
      // a short bright streak travelling along the shot
      const f = 1 - tr.life / tr.max
      _p.copy(tr.a).lerp(tr.b, Math.max(0, f - 0.35))
      _t.copy(tr.a).lerp(tr.b, Math.min(1, f + 0.25))
      pos.setXYZ(i * 2, _p.x, _p.y, _p.z)
      pos.setXYZ(i * 2 + 1, _t.x, _t.y, _t.z)
      col.setXYZ(i * 2, 1.6 * k, 1.2 * k, 0.6 * k)
      col.setXYZ(i * 2 + 1, 3.2 * k, 2.6 * k, 1.4 * k)
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    this.flashK = Math.max(0, this.flashK - dt * 260)
    this.flash.intensity = this.flashK
  }
}
