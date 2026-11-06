// Drives a VehiclePhysics like a person would: follows a road route (pure pursuit on a
// look-ahead point), or chases / rams a target directly when it's close, slows for
// tight corners, reverses out when stuck and rights itself when flipped.
import * as THREE from 'three'
import { clamp } from '../core/math.js'

const _v = new THREE.Vector3()

export class AIDriver {
  constructor(vehicle, graph, layout) {
    this.v = vehicle // { phys, pos, quat }
    this.graph = graph
    this.layout = layout
    this.route = null
    this.ri = 0
    this.mode = 'idle' // idle | route | chase | park
    this.target = null // { x, z, vx?, vz? }
    this.reroute = 0
    this.stuck = 0
    this.reverse = 0
    this.maxSpeed = 30
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false }
  }

  goTo(x, z) {
    this.mode = 'route'
    this.route = this.graph.route(this.v.pos.x, this.v.pos.z, x, z)
    this.ri = 0
    this.dest = { x, z }
  }

  chase(target) {
    this.mode = 'chase'
    this.target = target
  }

  park() {
    this.mode = 'park'
  }

  // Steering toward a world point: + = left (matches the player's controls)
  steerTo(x, z) {
    const { fwd, right } = this.v.phys.basis()
    const dx = x - this.v.pos.x, dz = z - this.v.pos.z
    const l = Math.hypot(dx, dz) || 1
    const side = (dx * right.x + dz * right.z) / l
    const ahead = (dx * fwd.x + dz * fwd.z) / l
    let ang = Math.atan2(side, ahead)
    return { steer: clamp(-ang * 2.2, -1, 1), ahead, dist: l, ang }
  }

  update(dt) {
    const vp = this.v.phys
    const speed = vp.speed
    const inp = this.input
    inp.boost = false
    inp.handbrake = false
    if (this.mode === 'idle' || this.mode === 'park') {
      inp.throttle = 0
      inp.brake = Math.abs(speed) > 0.5 ? 1 : 0
      inp.steer = 0
      inp.handbrake = true
      return inp
    }
    // where to go this step
    let tx, tz, wantSpeed = this.maxSpeed
    if (this.mode === 'chase' && this.target) {
      const t = this.target
      const dist = Math.hypot(t.x - this.v.pos.x, t.z - this.v.pos.z)
      // far away: drive the roads; close: go straight for them (with a little lead)
      if (dist > 70) {
        this.reroute -= dt
        if (!this.route || this.reroute <= 0) {
          this.route = this.graph.route(this.v.pos.x, this.v.pos.z, t.x, t.z)
          this.ri = 0
          this.reroute = 2.5
        }
      } else this.route = null
      if (!this.route) {
        const lead = Math.min(1.2, dist / 25)
        tx = t.x + (t.vx || 0) * lead
        tz = t.z + (t.vz || 0) * lead
        if (dist < (this.stopDist || 0)) wantSpeed = 0
        else if (dist < 25) wantSpeed = Math.max(6, Math.hypot(t.vx || 0, t.vz || 0) + 6)
      }
    }
    if (this.route) {
      // advance along the route
      let p = this.route[this.ri]
      while (p && Math.hypot(p.x - this.v.pos.x, p.z - this.v.pos.z) < 8 + Math.abs(speed) * 0.35 && this.ri < this.route.length - 1) p = this.route[++this.ri]
      if (!p) { this.mode = 'idle'; return this.update(dt) }
      tx = p.x
      tz = p.z
      // slow down for the corner after this point
      const q = this.route[this.ri + 1]
      if (q) {
        const a1 = Math.atan2(p.x - this.v.pos.x, p.z - this.v.pos.z)
        const a2 = Math.atan2(q.x - p.x, q.z - p.z)
        const turn = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)))
        const dp = Math.hypot(p.x - this.v.pos.x, p.z - this.v.pos.z)
        if (turn > 0.6 && dp < 40) wantSpeed = Math.min(wantSpeed, 9 + dp * 0.45)
      }
      if (this.mode === 'route' && this.ri >= this.route.length - 1) {
        const d = Math.hypot(tx - this.v.pos.x, tz - this.v.pos.z)
        if (d < 6) { this.mode = 'idle'; this.arrived = true }
        wantSpeed = Math.min(wantSpeed, d * 0.8)
      }
    }
    const s = this.steerTo(tx, tz)
    // sharp turn: ease off
    if (Math.abs(s.ang) > 0.9) wantSpeed = Math.min(wantSpeed, 8)
    // stuck? reverse out with opposite lock
    if (this.reverse > 0) {
      this.reverse -= dt
      inp.throttle = 0
      inp.brake = 1
      inp.steer = -s.steer
      return inp
    }
    if (Math.abs(speed) < 1.2 && wantSpeed > 3) {
      this.stuck += dt
      if (this.stuck > 1.8) { this.stuck = 0; this.reverse = 1.4 }
    } else this.stuck = 0
    // right yourself if flipped
    if (vp.flippedTime > 2) {
      const q = this.layout.queryRoad(this.v.pos.x, this.v.pos.z)
      const f = this.layout.roadFrame(q.i)
      vp.reset({ ...f, heading: Math.atan2(tx - f.x, tz - f.z) })
    }
    inp.steer = s.steer
    if (s.ahead < -0.3 && s.dist < 15) {
      // target behind and close: three-point turn
      inp.throttle = 0
      inp.brake = 1
      inp.steer = s.steer > 0 ? -1 : 1
    } else if (speed < wantSpeed - 1) {
      inp.throttle = 1
      inp.brake = 0
      inp.boost = this.mode === 'chase' && wantSpeed > 20 && Math.abs(s.ang) < 0.2
    } else if (speed > wantSpeed + 3) {
      inp.throttle = 0
      inp.brake = clamp((speed - wantSpeed) / 6, 0.2, 1)
    } else {
      inp.throttle = 0.3
      inp.brake = 0
    }
    void _v
    return inp
  }
}
