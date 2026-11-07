// The police response, escalating with your wanted level:
//   1★  patrol cars chase you; officers get out and try to arrest you on foot
//   2★  officers open fire
//   3★  more cars + a police helicopter with a spotlight
//   4★  roadblocks ahead of you, a marksman in the helicopter
//   5★  army jeeps with soldiers from Fort Granite
// Units spawn out of sight on the roads, drive there with the road router, ram you,
// and leave (sirens off) once you've lost them.
import * as THREE from 'three'
import { VehiclePhysics } from '../vehicle/VehiclePhysics.js'
import { SedanVisual, POLICE_CAR, carMaterial } from '../vehicle/CarVisuals.js'
import { HeliVisual } from '../vehicle/Helicopter.js'
import { AIDriver } from '../ai/AIDriver.js'
import { RoadGraph } from '../ai/RoadGraph.js'
import { makeCharacter, OUTFITS } from '../characters/Rig.js'
import { updateReaction, walkTo, calm } from '../characters/People.js'
import { EMOTE } from '../characters/Emotes.js'
import { makeRandom, clamp, damp, angleDelta } from '../core/math.js'
import { FORT } from '../world/Regions.js'

const CARS_BY_LEVEL = [0, 2, 3, 4, 5, 5]
const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()

export class Police {
  constructor(game) {
    this.game = game
    this.scene = game.scene
    this.physics = game.physics
    this.layout = game.layout
    this.graph = new RoadGraph(game.layout)
    this.rnd = makeRandom(911)
    this.units = []
    this.vehicles = []
    this.listeners = {}
    this.spawnTimer = 2
    this.roadblockTimer = 15
    this.heli = null
    this.heliTimer = 0
    // character pools (hidden until needed)
    this.pool = []
    this.armyPool = []
    for (let i = 0; i < 24; i++) this.pool.push(this.makeOfficer(false))
    for (let i = 0; i < 8; i++) this.armyPool.push(this.makeOfficer(true))
  }

  on(n, fn) {
    ;(this.listeners[n] ||= []).push(fn)
  }

  emit(n, ...a) {
    for (const fn of this.listeners[n] || []) fn(...a)
  }

  makeOfficer(army) {
    const rnd = this.rnd
    const c = this.game.crowd.add(makeCharacter(rnd, {
      kind: 'adult', hat: army ? 'helmet' : 'police', belt: true, glasses: !army && rnd.random() < 0.35,
      weapon: army ? 'rifle' : 'pistol', colors: { ...(army ? OUTFITS.army : OUTFITS.police) }, longSleeves: true, skirt: false, shorts: false,
    }))
    c.visible = false
    c.officer = true
    c.army = army
    c.fights = true
    c.maxHp = army ? 160 : 110
    c.free = true
    return c
  }

  takeOfficer(army) {
    const list = army ? this.armyPool : this.pool
    const c = list.find((k) => k.free)
    if (!c) return null
    c.free = false
    calm(c)
    c.reaction = null
    c.down = false
    c.hp = c.maxHp
    c.aim = 0
    c.drive = 0
    c.visible = true
    c.hidden = false
    c.shootT = 0.5 + this.rnd.random()
    c.bustT = 0
    c.saidHalt = false
    return c
  }

  releaseOfficer(c) {
    calm(c)
    c.reaction = null
    c.visible = false
    c.free = true
    c.inCar = null
    c.drive = 0
    c.aim = 0
  }

  get level() {
    return this.game.wanted.level
  }

  vehicleByBody(body) {
    return this.vehicles.find((v) => v.phys.body === body)
  }

  // ---------------------------------------------------------------- spawning
  // A road spot 130-200 m from the player, preferably out of the camera's view
  spawnSpot(minR = 130, maxR = 200) {
    const g = this.game
    const p = g.carPos
    const cam = g.camera
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion)
    let best = null
    for (let k = 0; k < 40; k++) {
      const a = this.rnd.random() * Math.PI * 2
      const r = this.rnd.range(minR, maxR)
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r
      if (Math.abs(x) > 760 || Math.abs(z) > 760) continue
      const q = this.layout.queryRoad(x, z)
      if (q.i < 0 || q.d > 3) continue
      const f = this.layout.roadFrame(q.i)
      const behind = (f.x - p.x) * fwd.x + (f.z - p.z) * fwd.z < 0
      best = f
      if (behind) break
    }
    return best
  }

  addCar(frame, army = false) {
    const phys = new VehiclePhysics(this.physics, { x: frame.x, y: frame.y, z: frame.z, heading: frame.heading }, POLICE_CAR)
    phys.occupied = true
    phys.wheelSurface.fill('road')
    const mat = carMaterial({ siren: !army })
    const visual = new SedanVisual(this.scene, phys, army ? 'army' : 'police', army ? '#5d6b45' : '#1f2a44', mat)
    const v = { type: 'car', name: army ? 'Army jeep' : 'Police car', phys, visual, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), seat: visual.seat, exitSide: 1, width: 2.0, length: 4.2, police: true, army }
    const tmp = new THREE.Quaternion()
    v.dyn = this.physics.addDynamic(phys.body, (prev, curr, a) => {
      v.pos.set(prev.p.x + (curr.p.x - prev.p.x) * a, prev.p.y + (curr.p.y - prev.p.y) * a, prev.p.z + (curr.p.z - prev.p.z) * a)
      v.quat.set(prev.q.x, prev.q.y, prev.q.z, prev.q.w).slerp(tmp.set(curr.q.x, curr.q.y, curr.q.z, curr.q.w), a)
    })
    const t = phys.body.translation(), r = phys.body.rotation()
    v.pos.set(t.x, t.y, t.z)
    v.quat.set(r.x, r.y, r.z, r.w)
    this.vehicles.push(v)
    return v
  }

  spawnUnit({ army = false, roadblock = null } = {}) {
    let frame = roadblock
    if (!frame) {
      if (army) {
        // army jeeps roll out of the fort gate if it's not miles away, else anywhere
        const g = this.game.carPos
        frame = Math.hypot(g.x - FORT.gate.x, g.z - FORT.gate.z) < 500 ? this.layout.roadFrame(this.layout.queryRoad(FORT.gate.x + 30, FORT.gate.z).i) : this.spawnSpot()
      } else frame = this.spawnSpot()
    }
    if (!frame) return null
    const crew = [this.takeOfficer(army), this.takeOfficer(army)].filter(Boolean)
    if (!crew.length) return null
    const v = this.addCar(frame, army)
    const ai = new AIDriver(v, this.graph, this.layout)
    ai.maxSpeed = army ? 30 : 38
    const unit = { v, ai, crew, state: roadblock ? 'out' : 'chase', t: 0, army, roadblock: !!roadblock, losT: 0 }
    for (const c of crew) c.inCar = roadblock ? null : v
    if (roadblock) {
      ai.park()
      crew.forEach((c, i) => {
        const side = i ? 1 : -1
        const fx = Math.sin(frame.heading), fz = Math.cos(frame.heading)
        c.x = frame.x - fx * 3 + fz * side * 1.5
        c.z = frame.z - fz * 3 - fx * side * 1.5
        c.y = this.layout.getDriveHeight(c.x, c.z)
      })
    } else ai.chase(this.target)
    this.units.push(unit)
    this.emit('spawn', unit)
    return unit
  }

  removeUnit(u) {
    for (const c of u.crew) this.releaseOfficer(c)
    const v = u.v
    const i = this.vehicles.indexOf(v)
    if (i >= 0) this.vehicles.splice(i, 1)
    if (!v.stolen) {
      const d = this.physics.dynamics.indexOf(v.dyn)
      if (d >= 0) this.physics.dynamics.splice(d, 1)
      this.physics.world.removeVehicleController(v.phys.controller)
      this.physics.world.removeRigidBody(v.phys.body)
      v.visual.group.removeFromParent()
      this.game.combat.burning.delete(v)
    }
    this.units.splice(this.units.indexOf(u), 1)
  }

  // The player takes a police car whose crew is out: it becomes theirs
  takeCar(v) {
    const u = this.units.find((k) => k.v === v)
    if (!u) return
    for (const c of u.crew) c.inCar = null
    u.v = null
    const i = this.vehicles.indexOf(v)
    if (i >= 0) this.vehicles.splice(i, 1)
    v.stolen = true
    v.police = false
    v.stolenAt = performance.now()
    v.home = { x: v.pos.x, y: v.pos.y, z: v.pos.z, heading: 0 }
    this.game.vehicles.push(v)
    u.state = 'out'
  }

  // A parked police car next to the player with nobody inside
  freeCarNear(p, r = 3.2) {
    for (const u of this.units) {
      const v = u.v
      if (!v || v.wrecked || u.state === 'chase') continue
      if (u.crew.some((c) => c.inCar === v)) continue
      if (Math.hypot(v.pos.x - p.x, v.pos.z - p.z) - v.length * 0.35 < r) return v
    }
    return null
  }

  // ---------------------------------------------------------------- simulation
  // physics step: AI inputs for every police car
  fixedUpdate(dt) {
    for (const u of this.units) {
      const v = u.v
      if (!v) continue
      const driving = u.state === 'chase' || u.state === 'leave'
      const occupied = u.crew.some((c) => c.inCar === v && !c.down)
      v.phys.occupied = true
      const input = driving && occupied && !v.wrecked ? u.ai.update(dt) : { throttle: 0, brake: 1, steer: 0, handbrake: true, boost: false }
      v.phys.update(dt, input, { wet: this.game.uniforms.uWet.value, waterLevel: -0.45, overWater: false })
    }
  }

  get target() {
    const g = this.game
    const lv = g.active ? g.active.phys.body.linvel() : g.player.vel
    if (!this._target) this._target = {}
    return Object.assign(this._target, { x: g.carPos.x, z: g.carPos.z, vx: lv.x, vz: lv.z })
  }

  hasLOS(from, to) {
    const g = this.game
    const d = _v.set(to.x - from.x, to.y - from.y, to.z - from.z)
    const len = d.length()
    if (len < 1) return true
    d.divideScalar(len)
    const exclude = g.active ? g.active.phys.body : null
    const hit = g.combat.castWorld(from, d, len - 1.5, exclude)
    if (!hit) return true
    const tag = this.physics.getTag(hit.collider.handle)
    return tag?.kind === 'car' || tag?.kind === 'traffic' // seen through / past cars
  }

  update(dt, ctx) {
    const g = this.game
    const W = g.wanted
    const level = W.level
    const target = this.target
    const pp = g.carPos
    const playerPos = { x: pp.x, y: pp.y + 1.2, z: pp.z }
    // how many cars should be on the case
    const want = CARS_BY_LEVEL[level]
    const active = this.units.filter((u) => !u.roadblock && !u.army && u.state !== 'leave').length
    this.spawnTimer -= dt
    if (level > 0 && active < want && this.spawnTimer <= 0 && !g.player.dead) {
      this.spawnTimer = 5
      this.spawnUnit()
    }
    if (level >= 5 && this.units.filter((u) => u.army && u.state !== 'leave').length < 2 && this.spawnTimer <= 0) {
      this.spawnTimer = 6
      this.spawnUnit({ army: true })
    }
    // roadblocks ahead of a fast-moving player
    this.roadblockTimer -= dt
    if (level >= 4 && this.roadblockTimer <= 0 && g.active && Math.abs(g.active.phys.speed) > 10) {
      this.roadblockTimer = 30
      this.placeRoadblock()
    }
    this.updateHeli(dt, level, playerPos)

    for (const u of [...this.units]) {
      u.t += dt
      const v = u.v
      // sirens + driving target
      if (v) {
        v.visual.siren = level > 0 && u.state !== 'leave' && !v.wrecked
        if (u.state === 'chase') u.ai.chase(target)
      }
      if (level === 0 && u.state !== 'leave') this.leave(u)
      // seen?
      u.losT -= dt
      const dPlayer = v && u.state === 'chase' ? Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z) : Infinity
      if (u.losT <= 0 && v && dPlayer < 90 && level > 0) {
        u.losT = 0.5
        if (this.hasLOS({ x: v.pos.x, y: v.pos.y + 1.3, z: v.pos.z }, playerPos)) W.seen(pp)
      }
      // crew in the car ride along (driver visible)
      for (const c of u.crew) {
        if (c.inCar && c.inCar === v) {
          const idx = u.crew.indexOf(c)
          const seat = _v.copy(v.visual.seat).setX(idx ? -v.visual.seat.x : v.visual.seat.x).applyQuaternion(v.quat).add(v.pos)
          c.x = seat.x
          c.y = seat.y - 0.5
          c.z = seat.z
          c.heading = new THREE.Euler().setFromQuaternion(v.quat, 'YXZ').y
          c.drive = 1
          c.visible = true
          c.aim = 0
        }
      }
      // car wrecked with the crew inside: they're out of action
      if (v && v.wrecked) {
        for (const c of u.crew) if (c.inCar === v) { c.inCar = null; c.drive = 0; g.people.knockDown(c, { x: 0, z: 1 }, 'explosion') }
        if (u.state === 'chase') u.state = 'out'
      }
      // pull over and get out near the player
      if (u.state === 'chase' && v) {
        const playerSlow = !g.active || Math.abs(g.active.phys.speed) < 2
        u.ai.stopDist = playerSlow ? 9 : 0
        if (playerSlow && dPlayer < 24 && Math.abs(v.phys.speed) < 3) this.disembark(u)
      }
      if (u.state === 'out') {
        const allDown = u.crew.every((c) => c.down)
        // you drove off: back in the car
        if (v && !v.wrecked && g.active && Math.abs(g.active.phys.speed) > 6 && v.pos.distanceTo(pp) > 30 && !u.roadblock) u.state = 'board'
        if (allDown && u.t > 5 && v?.pos.distanceTo(pp) > 80) { this.removeUnit(u); continue }
      }
      if (u.state === 'board') {
        let all = true
        for (const c of u.crew) {
          if (c.down || c.inCar === v) continue
          all = false
          const door = _v.copy(v.pos)
          if (walkTo(c, door.x, door.z, 4.8, dt, ctx, 2.2)) { c.inCar = v; c.aim = 0 }
        }
        if (all) { u.state = 'chase'; u.ai.chase(target) }
      }
      // officers on foot
      for (const c of u.crew) {
        if (c.inCar === v && v) continue
        this.updateOfficer(c, u, dt, ctx, level, playerPos)
      }
      // despawn when far away and out of the picture
      const far = v ? v.pos.distanceTo(pp) : Math.hypot(u.crew[0].x - pp.x, u.crew[0].z - pp.z)
      if ((u.state === 'leave' && (far > 140 || u.t > 25)) || far > 320) this.removeUnit(u)
    }
  }

  disembark(u) {
    u.state = 'out'
    u.t = 0
    const v = u.v
    const right = _v.set(-1, 0, 0).applyQuaternion(v.quat)
    u.crew.forEach((c, i) => {
      if (c.down) return
      c.inCar = null
      c.drive = 0
      const s = i ? -1.3 : 1.3
      c.x = v.pos.x - right.x * s
      c.z = v.pos.z - right.z * s
      c.y = this.layout.getDriveHeight(c.x, c.z)
    })
    this.emit('disembark', u)
  }

  leave(u) {
    u.state = 'leave'
    u.t = 0
    for (const c of u.crew) if (u.v && !c.down) c.inCar = u.v
    if (u.v) {
      const f = this.spawnSpot(250, 320)
      if (f) u.ai.goTo(f.x, f.z)
    }
  }

  updateOfficer(c, u, dt, ctx, level, playerPos) {
    const g = this.game
    if (c.down || updateReaction(c, dt, ctx)) {
      c.aim = 0
      return
    }
    if (u.state === 'leave' || level === 0) {
      c.aim = damp(c.aim || 0, 0, 6, dt)
      c.walk = damp(c.walk, 0, 8, dt)
      return
    }
    const dx = playerPos.x - c.x, dz = playerPos.z - c.z
    const d = Math.hypot(dx, dz)
    c.losT = (c.losT || 0) - dt
    if (c.losT <= 0) {
      c.losT = 0.45
      c.los = d < 95 && this.hasLOS({ x: c.x, y: c.y + 1.6, z: c.z }, playerPos)
      if (c.los) g.wanted.seen(g.carPos)
    }
    const shoot = level >= 2 || u.army
    if (!shoot) {
      // 1 star: run up and arrest
      if (d > 1.3) walkTo(c, playerPos.x, playerPos.z, 4.6, dt, ctx, 1.2)
      else c.walk = damp(c.walk, 0, 10, dt)
      c.heading += angleDelta(c.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 8)
      c.aim = damp(c.aim || 0, d < 12 ? 1 : 0, 6, dt) // draws the gun, doesn't fire
      const pSpeed = g.active ? Math.abs(g.active.phys.speed) : g.player.speed
      if (d < (g.active ? 2.8 : 1.6) && pSpeed < 2.2 && !g.player.dead) {
        c.bustT += dt
        if (!c.saidHalt) { c.saidHalt = true; g.emit('voice', 'halt', c.x, c.z); g.emotes.show(c, EMOTE.alarm, 1.2) }
        if (c.bustT > 1.5) {
          c.bustT = 0
          this.emit('bust')
        }
      } else c.bustT = Math.max(0, c.bustT - dt)
      return
    }
    // 2+ stars: keep 8-18 m away with a clear line of sight and shoot
    c.heading += angleDelta(c.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 7)
    if (d > 20 || !c.los) {
      walkTo(c, playerPos.x, playerPos.z, 4.6, dt, ctx, 6)
      c.aim = damp(c.aim || 0, 0.3, 6, dt)
    } else if (d < 6) {
      walkTo(c, c.x - (dx / d) * 3, c.z - (dz / d) * 3, 3, dt, ctx, 0.2)
      c.heading = Math.atan2(dx, dz)
    } else {
      c.walk = damp(c.walk, 0, 10, dt)
      c.run = damp(c.run, 0, 10, dt)
      c.aim = damp(c.aim || 0, 1, 8, dt)
    }
    c.aimPitch = clamp(Math.atan2(playerPos.y - (c.y + 1.4), d), -0.5, 0.5)
    c.shootT -= dt
    if (c.shootT <= 0 && c.los && d < 60 && c.aim > 0.6 && !g.player.dead) {
      const army = c.army
      c.shootT = army ? 0.35 + this.rnd.random() * 0.5 : 0.8 + this.rnd.random() * 0.9
      const acc = clamp(0.8 - d / 55, 0.12, 0.7) * (army ? 1.15 : 1)
      g.combat.npcFire(c, playerPos, army ? 'rifle' : level >= 4 ? 'smg' : 'pistol', acc)
    }
  }

  placeRoadblock() {
    const g = this.game
    const lv = g.active.phys.body.linvel()
    const sp = Math.hypot(lv.x, lv.z) || 1
    const x = g.carPos.x + (lv.x / sp) * 130, z = g.carPos.z + (lv.z / sp) * 130
    const q = this.layout.queryRoad(x, z)
    if (q.i < 0 || q.d > 6) return
    const f = this.layout.roadFrame(q.i)
    const across = f.heading + Math.PI / 2
    for (const side of [-1, 1]) {
      const fr = { x: f.x - f.tz * side * 2.4, z: f.z + f.tx * side * 2.4, y: f.y, heading: across + (side > 0 ? Math.PI : 0) }
      this.spawnUnit({ roadblock: fr })
    }
    this.emit('roadblock', f)
  }

  // ---------------------------------------------------------------- helicopter
  updateHeli(dt, level, playerPos) {
    const g = this.game
    if (level >= 3 && !this.heli) {
      this.heliTimer -= dt
      if (this.heliTimer <= 0) this.spawnHeli(playerPos)
    }
    const h = this.heli
    if (!h) return
    h.t += dt
    if (h.crashing) {
      h.vy -= 9.8 * dt
      h.pos.y += h.vy * dt
      h.pos.x += h.vx * dt
      h.pos.z += h.vz * dt
      h.yaw += dt * 4
      h.smokeAcc = (h.smokeAcc || 0) + dt * 20
      while (h.smokeAcc > 1) { h.smokeAcc -= 1; g.effects.smokeTrail(h.pos, 1.4, true) }
      if (h.pos.y < this.layout.getHeight(h.pos.x, h.pos.z) + 0.8) {
        g.combat.explode(h.pos.clone(), { radius: 9, damage: 260, owner: 'world', size: 1.6 })
        this.removeHeli()
        this.heliTimer = 40
        return
      }
    } else {
      const leaving = level < 3
      // circle the player at altitude, nose toward them
      h.orbit += dt * 0.32
      const r = leaving ? 400 : 28
      const tx = playerPos.x + Math.cos(h.orbit) * r, tz = playerPos.z + Math.sin(h.orbit) * r
      const ty = this.layout.getHeight(tx, tz) + (leaving ? 80 : 32)
      h.pos.x = damp(h.pos.x, tx, 0.6, dt)
      h.pos.z = damp(h.pos.z, tz, 0.6, dt)
      h.pos.y = damp(h.pos.y, ty, 0.8, dt)
      h.yaw += angleDelta(h.yaw, Math.atan2(playerPos.x - h.pos.x, playerPos.z - h.pos.z)) * Math.min(1, dt * 1.5)
      if (!leaving) {
        if (h.pos.distanceTo(_v.set(playerPos.x, playerPos.y, playerPos.z)) < 130) g.wanted.seen(g.carPos)
        // marksman at 4+ stars
        h.shootT -= dt
        if (level >= 4 && h.shootT <= 0 && !g.player.dead) {
          h.shootT = 2.2 + this.rnd.random() * 1.5
          g.combat.npcFire({ x: h.pos.x, y: h.pos.y - 2.2, z: h.pos.z, heading: h.yaw, scale: 1 }, playerPos, 'rifle', 0.35)
        }
      } else if (h.t > 25 || h.pos.distanceTo(_v.set(playerPos.x, playerPos.y, playerPos.z)) > 350) {
        this.removeHeli()
        return
      }
    }
    _q.setFromEuler(new THREE.Euler(h.crashing ? 0.3 : 0.12, h.yaw, h.crashing ? 0.4 : Math.sin(h.t * 0.5) * 0.08, 'YXZ'))
    h.visual.update(dt, h.pos, _q, h.t)
    h.body.setNextKinematicTranslation({ x: h.pos.x, y: h.pos.y + 1.2, z: h.pos.z })
    h.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
    // spotlight on the player (always at night, a faint beam by day)
    const night = this.game.uniforms.uNight.value
    h.spot.position.copy(h.pos).add(_v.set(0, 0.4, 0))
    h.spot.target.position.set(playerPos.x, playerPos.y - 1, playerPos.z)
    h.spot.intensity = h.crashing ? 0 : 60 + night * 900
    const beamLen = h.pos.distanceTo(h.spot.target.position)
    h.beam.position.copy(h.spot.position).lerp(h.spot.target.position, 0.5)
    h.beam.lookAt(h.spot.target.position)
    h.beam.scale.set(1, 1, beamLen)
    h.beam.material.opacity = h.crashing ? 0 : 0.05 + night * 0.18
  }

  spawnHeli(playerPos) {
    const R = this.physics.RAPIER
    const hp = { rotor: 1, state: 'running' }
    const visual = new HeliVisual(this.scene, hp)
    visual.group.traverse((o) => {
      if (o.isMesh && o.material?.color?.getHex() === 0xf2b33d) {
        o.material = o.material.clone()
        o.material.color.set(0x1f2a44)
      }
    })
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased())
    this.physics.tag(this.physics.world.createCollider(R.ColliderDesc.cuboid(1.0, 0.9, 2.6), body), { kind: 'policeHeli', material: 'metal' })
    const spot = new THREE.SpotLight(0xf6f2ff, 0, 140, 0.13, 0.4, 1.0)
    this.scene.add(spot, spot.target)
    const beam = new THREE.Mesh(new THREE.ConeGeometry(4, 1, 20, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf6f2ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    this.scene.add(beam)
    const a = this.rnd.random() * Math.PI * 2
    const pos = new THREE.Vector3(playerPos.x + Math.cos(a) * 250, playerPos.y + 70, playerPos.z + Math.sin(a) * 250)
    this.heli = { hp, visual, body, spot, beam, pos, yaw: 0, orbit: a, t: 0, health: 450, shootT: 3, crashing: false }
    this.emit('heli')
  }

  damageHeli(amount) {
    const h = this.heli
    if (!h || h.crashing) return
    h.health -= amount
    if (h.health <= 0) {
      h.crashing = true
      h.vy = 0
      h.vx = (Math.random() - 0.5) * 8
      h.vz = (Math.random() - 0.5) * 8
      h.hp.rotor = 0.6
      this.emit('heliDown')
    }
  }

  removeHeli() {
    const h = this.heli
    if (!h) return
    h.visual.group.removeFromParent()
    h.spot.removeFromParent()
    h.spot.target.removeFromParent()
    h.beam.removeFromParent()
    this.physics.world.removeRigidBody(h.body)
    this.heli = null
  }

  // Wanted cleared (lost them, busted, knocked out): everyone goes home
  standDown() {
    for (const u of [...this.units]) this.leave(u)
  }

  // sirens for the audio engine: nearest few police cars with sirens on
  sirens() {
    return this.vehicles.filter((v) => v.visual.siren).map((v) => v.pos)
  }
}
