// Mission runner. Each mission (MissionList.js) is a list of steps:
//   timer     start a countdown (goto steps can add time)
//   goto      reach a point (optionally stop there / keep the car in one piece)
//   hold      wait at the last point for a few seconds
//   wanted    raise the wanted level      evade    lose the police
//   race      checkpoints (+ laps) against AI racers or the clock
//   tail      follow a car without being spotted, take photos up close
//   takeCar   find and get into a marked car
//   wreckCars wreck AI gang cars          destroy  blow up target hulks
//   rampage   destroy N vehicles in time  eliminate take down armed gang members
//   range     hit pop-up targets
import * as THREE from 'three'
import { MISSIONS, MISSION_BY_ID, VEHICLE_COLORS, VEHICLE_LETTER, VEHICLE_LABEL } from './MissionList.js'
import { VehiclePhysics, BIKE } from '../vehicle/VehiclePhysics.js'
import { BikeVisual } from '../vehicle/BikeVisual.js'
import { SedanVisual, SEDAN, carGeometry, burntMaterial } from '../vehicle/CarVisuals.js'
import { AIDriver } from '../ai/AIDriver.js'
import { makeCharacter, OUTFITS } from '../characters/Rig.js'
import { updateReaction, calm } from '../characters/People.js'
import { U } from '../world/Uniforms.js'
import { makeRandom, clamp, damp, angleDelta } from '../core/math.js'

const _v = new THREE.Vector3()

function letterTexture(letter, color) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const g = cv.getContext('2d')
  g.fillStyle = color
  g.beginPath()
  g.arc(64, 64, 58, 0, Math.PI * 2)
  g.fill()
  g.lineWidth = 8
  g.strokeStyle = '#fff8ee'
  g.stroke()
  g.fillStyle = '#fff8ee'
  g.font = 'bold 76px Nunito, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(letter, 64, 70)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class Missions {
  constructor(game) {
    this.game = game
    this.scene = game.scene
    this.layout = game.layout
    this.town = game.town
    this.rnd = makeRandom(1337)
    this.listeners = {}
    this.current = null
    this.vehicles = [] // AI vehicles owned by the running mission
    let saved = {}
    try { saved = JSON.parse(localStorage.getItem('sv-missions') || '{}') } catch {}
    this.done = saved.done || {}
    this.best = saved.best || {}
    // start markers
    this.starts = MISSIONS.map((m) => {
      const s = m.start(this.town)
      const p = s.door || s
      const q = this.layout.queryRoad(p.x, p.z)
      let x = p.x, z = p.z
      if (m.vehicle !== 'foot' && q.i >= 0) { x = this.layout.roadX[q.i]; z = this.layout.roadZ[q.i] }
      const y = this.layout.getDriveHeight(x, z)
      const mesh = this.marker(x, y, z, m)
      return { id: m.id, x, y, z, mesh, def: m }
    })
    // guidance: beam on the target + an arrow over the player
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.1, 0.35), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.9, 50, 20, 1, true).translate(0, 25, 0), beamMat)
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.12, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 0.8) }))
    const am = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.6, 0.3) })
    this.arrow = new THREE.Group()
    this.arrow.add(new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.0, 12).rotateX(Math.PI / 2).translate(0, 0, 0.6), am))
    this.arrow.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 8).rotateX(Math.PI / 2).translate(0, 0, -0.2), am))
    for (const o of [this.beam, this.ring, this.arrow]) { o.visible = false; this.scene.add(o) }
    this.target = null
    this.waypoint = null
    // character pools: racers / drivers and gang members
    this.riders = []
    for (let i = 0; i < 6; i++) {
      const c = game.crowd.add(makeCharacter(this.rnd, { kind: 'adult', hat: 'none', colors: { shirt: ['#d84b3a', '#2f8f95', '#e8a33a', '#8a5bd0', '#2a2626', '#5aa05a'][i] } }))
      c.visible = false
      c.noReact = true
      c.free = true
      this.riders.push(c)
    }
    this.gang = []
    for (let i = 0; i < 9; i++) {
      const c = game.crowd.add(makeCharacter(this.rnd, { kind: 'adult', hat: this.rnd.random() < 0.5 ? 'beanie' : 'cap', glasses: this.rnd.random() < 0.5, belt: true, weapon: i % 3 === 0 ? 'smg' : 'pistol', colors: { ...OUTFITS.gang, shirt: this.rnd.pick(['#7a1f2a', '#2a2626', '#3d2a4a']) } }))
      c.visible = false
      c.fights = true
      c.gangster = true
      c.free = true
      this.gang.push(c)
    }
    this.extras = [] // meshes / bodies spawned by steps
  }

  on(n, fn) {
    ;(this.listeners[n] ||= []).push(fn)
  }

  emit(n, ...a) {
    for (const fn of this.listeners[n] || []) fn(...a)
  }

  save() {
    try { localStorage.setItem('sv-missions', JSON.stringify({ done: this.done, best: this.best })) } catch {}
  }

  marker(x, y, z, m) {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    const color = new THREE.Color(VEHICLE_COLORS[m.vehicle])
    const disc = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), transparent: true, opacity: 0.85, depthWrite: false }))
    disc.position.y = 0.09
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 3.5, 32, 1, true).translate(0, 1.75, 0), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.4), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture(VEHICLE_LETTER[m.vehicle], VEHICLE_COLORS[m.vehicle]), depthWrite: false }))
    icon.scale.set(1.8, 1.8, 1)
    icon.position.y = 4.6
    g.add(disc, beam, icon)
    g.userData.icon = icon
    this.scene.add(g)
    return g
  }

  info(id) {
    const m = MISSION_BY_ID[id]
    return { ...m, color: VEHICLE_COLORS[m.vehicle], label: VEHICLE_LABEL[m.vehicle], letter: VEHICLE_LETTER[m.vehicle], done: !!this.done[id] }
  }

  nearStart(pos) {
    if (this.current) return null
    for (const s of this.starts) if ((s.x - pos.x) ** 2 + (s.z - pos.z) ** 2 < 5 * 5) return s
    return null
  }

  route(id) {
    const s = this.starts.find((k) => k.id === id)
    if (s && !this.current) this.waypoint = { x: s.x, z: s.z }
  }

  vehicleType() {
    const a = this.game.active
    return a ? a.type : 'foot'
  }

  // ---------------------------------------------------------------- lifecycle
  start(id) {
    if (this.current) return
    const def = MISSION_BY_ID[id]
    const vt = this.vehicleType()
    if (def.vehicle !== 'foot' && vt !== def.vehicle) return this.emit('notice', `${def.name} needs a ${VEHICLE_LABEL[def.vehicle].toLowerCase()}. Grab one first`)
    if (def.vehicle === 'foot' && vt !== 'foot') return this.emit('notice', `${def.name} is an on-foot mission. Get out first (F)`)
    this.waypoint = null
    const m = { id, def, steps: def.steps(this.town, this.rnd.random), i: -1, t: 0, timer: null, limit: null, label: '', away: 0, coins: 0 }
    this.current = m
    for (const s of this.starts) s.mesh.visible = false
    this.emit('start', m)
    this.next()
  }

  next() {
    const m = this.current
    if (!m) return
    this.cleanupStep()
    m.i++
    if (m.i >= m.steps.length) return this.pass()
    const st = (m.step = { ...m.steps[m.i], t: 0 })
    m.label = st.label || m.label
    m.progress = null
    const fn = this['setup_' + st.type]
    if (fn) fn.call(this, st, m)
    this.emit('step', m)
  }

  pass() {
    const m = this.current
    const reward = m.def.reward + (m.bonus || 0)
    this.game.activities.award(reward, null)
    const first = !this.done[m.id]
    this.done[m.id] = true
    if (!this.best[m.id] || m.t < this.best[m.id]) this.best[m.id] = Math.round(m.t)
    this.save()
    this.emit('passed', m, reward, first)
    this.end()
  }

  fail(reason) {
    const m = this.current
    if (!m) return
    this.emit('failed', m, reason)
    this.end()
  }

  quit() {
    if (this.current) this.fail('Mission abandoned')
  }

  end() {
    this.cleanupStep()
    this.cleanupAll()
    this.current = null
    this.target = null
    this.beam.visible = this.ring.visible = this.arrow.visible = false
    for (const s of this.starts) s.mesh.visible = true
    this.game.input.enabled = !this.game.player.dead
  }

  setTarget(x, z, r = 5) {
    const y = this.layout.getDriveHeight(x, z)
    this.target = { x, y, z, r }
    this.beam.position.set(x, y, z)
    this.ring.position.set(x, y + 0.2, z)
    this.ring.scale.setScalar(r / 3)
    this.beam.visible = this.ring.visible = true
  }

  clearTarget() {
    this.target = null
    this.beam.visible = this.ring.visible = false
  }

  // ---------------------------------------------------------------- spawning helpers
  takeChar(list) {
    const c = list.find((k) => k.free)
    if (!c) return null
    c.free = false
    calm(c)
    c.reaction = null
    c.down = false
    c.hp = c.maxHp = c.gangster ? 70 : 100
    c.visible = true
    c.hidden = false
    c.drive = c.ride = 0
    c.aim = 0
    return c
  }

  releaseChar(c) {
    calm(c)
    c.reaction = null
    c.visible = false
    c.free = true
    c.drive = c.ride = 0
    c.aim = 0
  }

  spawnAIVehicle(kind, frame, color) {
    const g = this.game
    const bike = kind === 'bike'
    const phys = new VehiclePhysics(g.physics, frame, bike ? { ...BIKE, nitroTime: 0 } : { ...SEDAN, torque: kind === 'racer' ? 200 : 175, vmax: kind === 'racer' ? 52 : 46 })
    phys.occupied = true
    phys.wheelSurface.fill('road')
    const visual = bike ? new BikeVisual(this.scene, phys, new THREE.Color(color).getHex()) : new SedanVisual(this.scene, phys, 'sedan', color)
    const v = { type: bike ? 'bike' : 'car', name: bike ? 'Motorbike' : 'Car', phys, visual, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), seat: visual.seat || new THREE.Vector3(0, 0.78, -0.22), width: 2, length: 4, mission: true }
    const tmp = new THREE.Quaternion()
    v.dyn = g.physics.addDynamic(phys.body, (prev, curr, a) => {
      v.pos.set(prev.p.x + (curr.p.x - prev.p.x) * a, prev.p.y + (curr.p.y - prev.p.y) * a, prev.p.z + (curr.p.z - prev.p.z) * a)
      v.quat.set(prev.q.x, prev.q.y, prev.q.z, prev.q.w).slerp(tmp.set(curr.q.x, curr.q.y, curr.q.z, curr.q.w), a)
    })
    const t = phys.body.translation(), r = phys.body.rotation()
    v.pos.set(t.x, t.y, t.z)
    v.quat.set(r.x, r.y, r.z, r.w)
    v.ai = new AIDriver(v, g.police.graph, this.layout)
    v.rider = this.takeChar(this.riders)
    this.vehicles.push(v)
    return v
  }

  removeAIVehicle(v) {
    const g = this.game
    const i = this.vehicles.indexOf(v)
    if (i < 0) return
    this.vehicles.splice(i, 1)
    const d = g.physics.dynamics.indexOf(v.dyn)
    if (d >= 0) g.physics.dynamics.splice(d, 1)
    g.physics.world.removeVehicleController(v.phys.controller)
    g.physics.world.removeRigidBody(v.phys.body)
    v.visual.group.removeFromParent()
    g.combat.burning.delete(v)
    if (v.rider) this.releaseChar(v.rider)
  }

  vehicleByBody(body) {
    return this.vehicles.find((v) => v.phys.body === body)
  }

  frameAt(x, z, heading) {
    const f = this.game.frameNear(x, z, heading ?? 0)
    return heading === undefined ? f : { ...f, heading }
  }

  cleanupStep() {
    const st = this.current?.step
    if (!st) return
    if (st.cleanup) st.cleanup()
    st.cleanup = null
  }

  cleanupAll() {
    for (const v of [...this.vehicles]) this.removeAIVehicle(v)
    for (const c of this.gang) if (!c.free) this.releaseChar(c)
    for (const e of this.extras) e()
    this.extras = []
  }

  // AI vehicles get their inputs every physics step
  fixedUpdate(dt) {
    for (const v of this.vehicles) {
      const input = v.wrecked ? { throttle: 0, brake: 1, steer: 0, handbrake: true, boost: false } : v.ai.update(dt)
      if (v.frozen) { input.throttle = 0; input.brake = 1; input.handbrake = true }
      v.phys.update(dt, input, { wet: U.uWet.value, waterLevel: -0.45, overWater: false })
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, time) {
    const g = this.game
    for (const s of this.starts) {
      if (!s.mesh.visible) continue
      s.mesh.userData.icon.position.y = 4.6 + Math.sin(time * 2 + s.x) * 0.25
    }
    // riders sit on / in their vehicles
    for (const v of this.vehicles) {
      const c = v.rider
      if (!c) continue
      const holder = v.visual.lean || v.visual.group
      v.visual.update(dt, v.pos, v.quat)
      v.visual.group.updateMatrixWorld(true)
      const seat = holder.localToWorld(v.seat.clone())
      c.x = seat.x
      c.y = seat.y - (v.type === 'bike' ? 0.62 : 0.5)
      c.z = seat.z
      c.heading = new THREE.Euler().setFromQuaternion(v.quat, 'YXZ').y
      c.ride = v.type === 'bike' ? 1 : 0
      c.drive = v.type === 'bike' ? 0 : 1
      c.lean = v.type === 'bike' ? v.visual.leanAngle || 0 : 0
      c.visible = !v.wrecked
    }
    const pos = g.carPos
    // guidance arrow (mission target or a "show the way" waypoint)
    const tgt = this.target || this.waypoint
    if (tgt) {
      this.arrow.visible = true
      this.arrow.position.set(pos.x, pos.y + (g.active ? 3.2 : 2.6), pos.z)
      this.arrow.rotation.y = Math.atan2(tgt.x - pos.x, tgt.z - pos.z)
      this.ring.rotation.y = time
      if (this.waypoint && Math.hypot(tgt.x - pos.x, tgt.z - pos.z) < 8) { this.waypoint = null; this.arrow.visible = false }
    } else this.arrow.visible = false
    const m = this.current
    if (!m) return
    m.t += dt
    if (m.timer !== null) {
      m.timer -= dt
      if (m.timer <= 0) return this.fail('Out of time')
    }
    // stay with the right vehicle
    const need = m.def.vehicle
    const vt = this.vehicleType()
    if (need !== 'foot' && vt !== need && m.step?.type !== 'takeCar' && !(need === 'car' && m.step?.type === 'goto' && vt === 'car')) {
      m.away += dt
      if (m.away > 20) return this.fail(`You left your ${VEHICLE_LABEL[need].toLowerCase()} behind`)
    } else m.away = 0
    if (g.player.dead) return this.fail(g.wanted.level === 0 && g.koTimer ? 'You were taken out' : 'Mission failed')
    const st = m.step
    st.t += dt
    const fn = this['update_' + st.type]
    const r = fn ? fn.call(this, st, m, dt, pos) : 'next'
    if (r === 'next') this.next()
    else if (typeof r === 'string' && r.startsWith('fail:')) this.fail(r.slice(5))
  }

  speed() {
    const g = this.game
    return g.active ? Math.abs(g.active.phys.speed) : g.player.speed
  }

  // ---------------------------------------------------------------- steps
  setup_timer(st, m) {
    m.timer = st.seconds
    m.limit = st.seconds
  }

  update_timer() {
    return 'next'
  }

  setup_goto(st) {
    this.setTarget(st.at.x, st.at.z, st.r || 5)
    if (st.item) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.14), new THREE.MeshStandardMaterial({ color: 0x3b2a20, emissive: 0x4a3010, emissiveIntensity: 0.6 }))
      box.position.set(st.at.x, this.layout.getDriveHeight(st.at.x, st.at.z) + 0.25, st.at.z)
      this.scene.add(box)
      st.cleanup = () => box.removeFromParent()
    }
  }

  update_goto(st, m, dt, pos) {
    const d = Math.hypot(st.at.x - pos.x, st.at.z - pos.z)
    if (d < (st.r || 5) && (!st.stop || this.speed() < 4)) {
      if (st.minHealth) {
        const a = this.game.active
        if (!a || a.phys.health / a.phys.maxHealth < st.minHealth) return 'fail:The car is too badly damaged'
      }
      if (st.bonusTime && m.timer !== null) { m.timer += st.bonusTime; m.limit = Math.max(m.limit, m.timer) }
      this.emit('checkpoint', m)
      return 'next'
    }
    m.progress = m.timer !== null ? m.timer / m.limit : null
  }

  setup_hold(st) {
    st.held = 0
    const p = this.target || this.game.carPos
    st.at = { x: p.x, z: p.z }
  }

  update_hold(st, m, dt, pos) {
    if (Math.hypot(st.at.x - pos.x, st.at.z - pos.z) < st.r && this.speed() < 2) st.held += dt
    else st.held = Math.max(0, st.held - dt * 0.5)
    m.progress = st.held / st.seconds
    if (st.held >= st.seconds) return 'next'
  }

  setup_wanted(st) {
    const W = this.game.wanted
    W.heat = Math.max(W.heat, st.level)
    const before = W.level
    W.level = Math.max(W.level, st.level)
    W.lastSeen = { x: this.game.carPos.x, z: this.game.carPos.z }
    W.unseen = 0
    if (W.level > before) W.emit('level', W.level, before)
    this.clearTarget()
  }

  update_wanted() {
    return 'next'
  }

  setup_evade() {
    this.clearTarget()
  }

  update_evade(st, m) {
    m.progress = null
    if (this.game.wanted.level === 0) return 'next'
  }

  // ---- races (with or without AI opponents)
  setup_race(st, m) {
    const g = this.game
    const laps = st.laps || 1
    st.route = []
    for (let l = 0; l < laps; l++) st.route.push(...st.checkpoints)
    st.next = 0
    st.racers = []
    st.finished = []
    st.jumps = 0
    st.wasAir = false
    st.countdown = st.opponents ? 3.99 : 0
    if (st.limit) { m.timer = st.limit; m.limit = st.limit }
    // line everyone up on the grid
    if (st.grid) {
      const gr = st.grid
      const fwd = { x: Math.sin(gr.heading), z: Math.cos(gr.heading) }
      const side = { x: -fwd.z, z: fwd.x }
      const slot = (k) => ({ x: gr.x - fwd.x * Math.floor(k / 2) * 7 + side.x * ((k % 2) - 0.5) * 4.5, z: gr.z - fwd.z * Math.floor(k / 2) * 7 + side.z * ((k % 2) - 0.5) * 4.5 })
      const me = g.active
      if (me) {
        const s0 = slot(0)
        me.phys.reset({ x: s0.x, y: this.layout.getDriveHeight(s0.x, s0.z), z: s0.z, heading: gr.heading })
        g.physics.sync(1)
        g.rig.snap()
      }
      const colors = ['#d84b3a', '#2f8f95', '#8a5bd0', '#e8a33a']
      for (let k = 0; k < (st.opponents || 0); k++) {
        const s = slot(k + 1)
        const v = this.spawnAIVehicle(st.kind === 'bike' ? 'bike' : 'racer', { x: s.x, y: this.layout.getDriveHeight(s.x, s.z), z: s.z, heading: gr.heading }, colors[k % colors.length])
        v.ai.maxSpeed = st.kind === 'bike' ? 38 : 44
        v.next = 0
        v.frozen = true
        v.ai.goTo(st.route[0].x, st.route[0].z)
        st.racers.push(v)
      }
    }
    if (st.countdown > 0) g.input.enabled = false
    const c = st.route[0]
    this.setTarget(c.x, c.z, 9)
  }

  update_race(st, m, dt, pos) {
    const g = this.game
    if (st.countdown > 0) {
      const before = Math.ceil(st.countdown)
      st.countdown -= dt
      const after = Math.ceil(st.countdown)
      if (after !== before) this.emit('countdown', Math.max(0, after))
      if (st.countdown <= 0) {
        g.input.enabled = true
        for (const v of st.racers) v.frozen = false
      }
      return
    }
    // AI racers advance through the checkpoints (with a touch of rubber-banding)
    for (const v of st.racers) {
      if (v.finished) continue
      const c = st.route[v.next]
      if (Math.hypot(c.x - v.pos.x, c.z - v.pos.z) < 14) {
        v.next++
        if (v.next >= st.route.length) {
          v.finished = true
          st.finished.push(v)
          v.ai.park()
          continue
        }
        const n = st.route[v.next]
        v.ai.goTo(n.x, n.z)
      } else if (v.ai.mode === 'idle') v.ai.goTo(c.x, c.z)
      const ahead = v.next - st.next
      v.ai.maxSpeed = (st.kind === 'bike' ? 38 : 44) * (ahead > 1 ? 0.88 : ahead < 0 ? 1.12 : 1)
    }
    // jumps (motocross bonus)
    if (st.countJumps && g.active) {
      const air = g.active.phys.airTime > 0.5
      if (air && !st.wasAir) { st.jumps++; this.emit('jump', st.jumps) }
      st.wasAir = air
    }
    const c = st.route[st.next]
    if (Math.hypot(c.x - pos.x, c.z - pos.z) < 11) {
      st.next++
      this.emit('checkpoint', m)
      if (st.next >= st.route.length) {
        const place = st.finished.length + 1
        if (st.countJumps) m.bonus = st.jumps * 25
        if (place > 1) return `fail:You finished ${place}${['st', 'nd', 'rd'][place - 1] || 'th'}`
        return 'next'
      }
      const n = st.route[st.next]
      this.setTarget(n.x, n.z, 9)
    }
    // position in the race
    const prog = (k, p) => k * 10000 - Math.hypot(st.route[Math.min(k, st.route.length - 1)].x - p.x, st.route[Math.min(k, st.route.length - 1)].z - p.z)
    const mine = prog(st.next, pos)
    const place = 1 + st.racers.filter((v) => v.finished || prog(v.next, v.pos) > mine).length
    m.label = st.racers.length ? `Position ${place}/${st.racers.length + 1} · checkpoint ${st.next + 1}/${st.route.length}` : `Checkpoint ${st.next + 1}/${st.route.length}${st.countJumps ? ` · jumps ${st.jumps}` : ''}`
    m.progress = st.next / st.route.length
  }

  // ---- tail a car and take photos
  setup_tail(st) {
    const f = this.frameAt(st.spawn.x, st.spawn.z)
    const v = this.spawnAIVehicle('sedan', f, '#f8f6f0')
    v.ai.maxSpeed = 13
    st.loop = [{ x: 430, z: -25 }, { x: 580, z: -25 }, { x: 580, z: 125 }, { x: 430, z: 125 }]
    st.li = 0
    v.ai.goTo(st.loop[0].x, st.loop[0].z)
    st.car = v
    st.need = m_photos(st)
    st.photos = 0
    st.close = 0
    st.tooClose = 0
    st.cool = 0
  }

  update_tail(st, m, dt, pos) {
    const v = st.car
    if (v.ai.mode === 'idle') {
      st.li = (st.li + 1) % st.loop.length
      v.ai.goTo(st.loop[st.li].x, st.loop[st.li].z)
    }
    this.setTarget(v.pos.x, v.pos.z, 2)
    const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z)
    if (d > 140) return 'fail:You lost the celebrity'
    if (v.wrecked) return 'fail:You wrecked the celebrity\'s car'
    st.cool = Math.max(0, st.cool - dt)
    if (d < 7) {
      st.tooClose += dt
      if (st.tooClose > 2.5) return 'fail:You were spotted'
    } else st.tooClose = Math.max(0, st.tooClose - dt)
    if (d < 24 && st.cool <= 0) {
      st.close += dt
      if (st.close > 2.2) {
        st.close = 0
        st.cool = 4
        st.photos++
        this.emit('photo', st.photos)
        this.game.combat.flashAt(v.pos.clone().setY(v.pos.y + 1.5), 60, 12)
        if (st.photos >= st.need) return 'next'
      }
    } else st.close = Math.max(0, st.close - dt * 0.5)
    m.label = `Photos ${st.photos}/${st.need} · stay within 24 m, not closer than 7 m`
    m.progress = st.photos / st.need
  }

  // ---- find and take a marked car
  setup_takeCar(st) {
    const g = this.game
    const f = this.frameAt(st.spawn.x, st.spawn.z)
    const kx = f.x - f.tz * 2.6, kz = f.z + f.tx * 2.6
    const phys = new VehiclePhysics(g.physics, { x: kx, y: this.layout.getDriveHeight(kx, kz), z: kz, heading: f.heading }, SEDAN)
    const visual = new SedanVisual(this.scene, phys, 'sedan', '#e8a33a')
    const v = g.addVehicle('car', 'Repo car', phys, visual, { seat: visual.seat, exitSide: 1, width: 2, length: 4.2, stolen: true })
    v.stolenAt = performance.now() + 1e9 // keep it until the mission ends
    st.car = v
    this.extras.push(() => { if (g.active !== v) g.removeVehicle(v); else v.stolenAt = performance.now() })
  }

  update_takeCar(st) {
    this.setTarget(st.car.pos.x, st.car.pos.z, 3)
    if (this.game.active === st.car) return 'next'
  }

  // ---- wreck the gang cars
  setup_wreckCars(st, m) {
    m.timer = st.limit
    m.limit = st.limit
    st.cars = []
    const pts = () => ({ x: (this.rnd.random() - 0.5) * 300, z: (this.rnd.random() - 0.5) * 300 })
    for (let k = 0; k < st.count; k++) {
      const p = pts()
      const v = this.spawnAIVehicle('sedan', this.frameAt(p.x, p.z), '#7a1f2a')
      v.ai.maxSpeed = 20
      const d = pts()
      v.ai.goTo(d.x, d.z)
      st.cars.push(v)
    }
  }

  update_wreckCars(st, m) {
    let left = 0
    let near = null, nd = Infinity
    const pos = this.game.carPos
    for (const v of st.cars) {
      if (v.wrecked) continue
      left++
      if (v.ai.mode === 'idle') v.ai.goTo((this.rnd.random() - 0.5) * 300, (this.rnd.random() - 0.5) * 300)
      const d = v.pos.distanceTo(pos)
      if (d < nd) { nd = d; near = v }
    }
    if (near) this.setTarget(near.pos.x, near.pos.z, 3)
    m.label = `Wreck the gang cars: ${st.count - left}/${st.count}`
    m.progress = (st.count - left) / st.count
    if (left === 0) return 'next'
  }

  // ---- target hulks for the tank
  setup_destroy(st, m) {
    const g = this.game
    m.timer = st.limit
    m.limit = st.limit
    st.targets = st.targets.map((p, i) => {
      const y = this.layout.getDriveHeight(p.x, p.z)
      const mesh = new THREE.Mesh(carGeometry('army', '#4f5b3a'), burntMaterial())
      mesh.position.set(p.x, y, p.z)
      mesh.rotation.y = i * 1.3
      mesh.castShadow = true
      this.scene.add(mesh)
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.6, 0.3), transparent: true, opacity: 0.7, depthWrite: false }))
      ring.position.set(p.x, y + 0.1, p.z)
      this.scene.add(ring)
      const R = g.physics.RAPIER
      const body = g.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(p.x, y + 1, p.z))
      g.physics.tag(g.physics.world.createCollider(R.ColliderDesc.cuboid(1.1, 1, 2.2), body), { kind: 'target', material: 'metal', id: `hulk${i}` })
      return { ...p, y, mesh, ring, body, hp: 60, alive: true, id: `hulk${i}` }
    })
    const onExplode = (p) => {
      for (const t of st.targets) if (t.alive && Math.hypot(t.x - p.x, t.z - p.z) < 8) this.killTarget(st, t)
    }
    const onHit = (id) => {
      const t = st.targets.find((k) => k.id === id)
      if (t && t.alive) { t.hp -= 8; if (t.hp <= 0) this.killTarget(st, t) }
    }
    g.combat.on('explosion', onExplode)
    g.combat.on('targetHit', onHit)
    st.cleanup = () => {
      g.combat.listeners.explosion = g.combat.listeners.explosion.filter((f) => f !== onExplode)
      g.combat.listeners.targetHit = g.combat.listeners.targetHit.filter((f) => f !== onHit)
      for (const t of st.targets) {
        t.mesh.removeFromParent()
        t.ring.removeFromParent()
        if (t.alive) g.physics.world.removeRigidBody(t.body)
      }
    }
  }

  killTarget(st, t) {
    const g = this.game
    t.alive = false
    t.ring.visible = false
    g.physics.world.removeRigidBody(t.body)
    t.mesh.position.y -= 0.4
    t.mesh.rotation.z = 0.4
    g.effects.explosion(new THREE.Vector3(t.x, t.y + 1, t.z), 0.8)
    this.emit('target', st.targets.filter((k) => !k.alive).length, st.targets.length)
  }

  update_destroy(st, m) {
    const alive = st.targets.filter((t) => t.alive)
    const pos = this.game.carPos
    let near = null, nd = Infinity
    for (const t of alive) {
      const d = Math.hypot(t.x - pos.x, t.z - pos.z)
      if (d < nd) { nd = d; near = t }
    }
    if (near) this.setTarget(near.x, near.z, 3.5)
    m.label = `Targets destroyed ${st.targets.length - alive.length}/${st.targets.length}`
    m.progress = (st.targets.length - alive.length) / st.targets.length
    if (!alive.length) return 'next'
  }

  // ---- rampage: destroy N vehicles of any kind
  setup_rampage(st, m) {
    const g = this.game
    m.timer = st.limit
    m.limit = st.limit
    st.kills = 0
    const count = () => { st.kills++ }
    g.on('trafficWrecked', count)
    g.combat.on('vehicleWrecked', count)
    this.clearTarget()
    st.cleanup = () => {
      g.listeners.trafficWrecked = g.listeners.trafficWrecked.filter((f) => f !== count)
      g.combat.listeners.vehicleWrecked = g.combat.listeners.vehicleWrecked.filter((f) => f !== count)
    }
  }

  update_rampage(st, m) {
    m.label = `Vehicles destroyed ${st.kills}/${st.count}`
    m.progress = st.kills / st.count
    if (st.kills >= st.count) return 'next'
  }

  // ---- armed gang members
  setup_eliminate(st) {
    st.members = []
    for (let k = 0; k < st.count; k++) {
      const c = this.takeChar(this.gang)
      if (!c) break
      let x = st.at.x, z = st.at.z
      for (let tries = 0; tries < 12; tries++) {
        const a = this.rnd.random() * Math.PI * 2, r = 6 + this.rnd.random() * st.spread
        x = st.at.x + Math.cos(a) * r
        z = st.at.z + Math.sin(a) * r
        if (this.layout.isFree(x, z, 0.6, { roadMargin: -6 })) break
      }
      c.x = x
      c.z = z
      c.y = this.layout.getDriveHeight(x, z)
      c.heading = this.rnd.random() * 6.28
      c.shootT = 1 + this.rnd.random() * 2
      c.alerted = false
      st.members.push(c)
    }
    this.setTarget(st.at.x, st.at.z, 4)
  }

  update_eliminate(st, m, dt, pos) {
    const g = this.game
    const pp = { x: pos.x, y: pos.y + 1.2, z: pos.z }
    let left = 0
    for (const c of st.members) {
      if (c.down) continue
      left++
      if (updateReaction(c, dt, g.crowdCtx)) { c.alerted = true; continue }
      const dx = pp.x - c.x, dz = pp.z - c.z
      const d = Math.hypot(dx, dz)
      if (d < 45) c.alerted = true
      if (!c.alerted) { c.aim = 0; continue }
      c.heading += angleDelta(c.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 6)
      c.aim = damp(c.aim || 0, 1, 8, dt)
      c.aimPitch = clamp(Math.atan2(pp.y - (c.y + 1.4), d), -0.5, 0.5)
      c.shootT -= dt
      if (c.shootT <= 0 && d < 55 && !g.player.dead) {
        c.shootT = 0.9 + this.rnd.random() * 1.3
        c.los = g.police.hasLOS({ x: c.x, y: c.y + 1.6, z: c.z }, pp)
        if (c.los) g.combat.npcFire(c, pp, c.weapon || 'pistol', clamp(0.7 - d / 70, 0.15, 0.55))
      }
    }
    m.label = `Gang members down ${st.count - left}/${st.count}`
    m.progress = (st.count - left) / st.count
    if (left === 0) return 'next'
  }

  // ---- shooting range
  setup_range(st, m) {
    const g = this.game
    m.timer = st.limit
    m.limit = st.limit
    const R = g.physics.RAPIER
    st.boards = g.town.fort.range.targets.map((t, i) => {
      const body = g.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(t.x, t.y, t.z))
      g.physics.tag(g.physics.world.createCollider(R.ColliderDesc.cuboid(0.95, 0.95, 0.12), body), { kind: 'target', material: 'wood', id: `range${i}` })
      return { ...t, body, id: `range${i}` }
    })
    st.need = st.hits
    st.got = 0
    st.glow = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 1.2, 0.3), side: THREE.DoubleSide, depthWrite: false }))
    this.scene.add(st.glow)
    st.pick = () => {
      let k
      do k = Math.floor(this.rnd.random() * st.boards.length)
      while (st.boards.length > 1 && k === st.active)
      st.active = k
      const b = st.boards[k]
      st.glow.position.set(b.x, b.y, b.z - 0.15)
      this.setTarget(b.x, b.z, 1.2)
    }
    st.pick()
    const onHit = (id) => {
      if (st.boards[st.active]?.id !== id) return
      st.got++
      this.emit('rangeHit', st.got)
      st.pick()
    }
    g.combat.on('targetHit', onHit)
    st.cleanup = () => {
      g.combat.listeners.targetHit = g.combat.listeners.targetHit.filter((f) => f !== onHit)
      for (const b of st.boards) g.physics.world.removeRigidBody(b.body)
      st.glow.removeFromParent()
    }
  }

  update_range(st, m) {
    m.label = `Targets hit ${st.got}/${st.need}`
    m.progress = st.got / st.need
    if (st.got >= st.need) return 'next'
  }
}

function m_photos(st) {
  return st.photos || 3
}

export { MISSIONS }
