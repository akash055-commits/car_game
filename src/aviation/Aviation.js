// Airport traffic and the sky above it.
//  • AI planes run a full cycle: park → push back → taxi → hold short (waits for a clear
//    runway) → line up → take-off roll → rotate → climb → circuit over the town →
//    approach → touchdown → roll-out → taxi in → park. Speeds, pitch and bank follow the
//    path; gear retracts in the air. Each plane has a kinematic collider.
//  • High-altitude airliners cross the sky now and then, leaving fading contrails.
import * as THREE from 'three'
import { AIRPORT } from '../world/Layout.js'
import { makeAirliner, makePropPlane, animateLights } from './PlaneModel.js'
import { clamp, damp, angleDelta, makeRandom } from '../core/math.js'

const A = AIRPORT
const RZ = A.runwayZ, TZ = A.taxiZ

function line(out, a, b, step = 2) {
  const n = Math.max(1, Math.ceil(a.distanceTo(b) / step))
  for (let i = out.length ? 1 : 0; i <= n; i++) out.push(a.clone().lerp(b, i / n))
  return out
}

function arc(out, a, c, b, n = 12) {
  for (let i = 1; i <= n; i++) {
    const t = i / n
    out.push(new THREE.Vector3(
      (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
      (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
      (1 - t) * (1 - t) * a.z + 2 * (1 - t) * t * c.z + t * t * b.z,
    ))
  }
  return out
}

const V = (x, y, z) => new THREE.Vector3(x, y, z)

class Path {
  constructor(points) {
    this.p = points
    this.len = [0]
    for (let i = 1; i < points.length; i++) this.len.push(this.len[i - 1] + points[i].distanceTo(points[i - 1]))
    this.total = this.len[this.len.length - 1]
  }

  at(s, out = new THREE.Vector3(), tan = new THREE.Vector3()) {
    s = clamp(s, 0, this.total)
    let lo = 0, hi = this.len.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (this.len[mid] < s) lo = mid
      else hi = mid
    }
    const seg = this.len[hi] - this.len[lo] || 1
    const t = (s - this.len[lo]) / seg
    out.copy(this.p[lo]).lerp(this.p[hi], t)
    tan.copy(this.p[hi]).sub(this.p[lo]).normalize()
    return out
  }
}

export class Aviation {
  constructor(scene, physics, layout) {
    this.scene = scene
    this.physics = physics
    this.layout = layout
    this.rnd = makeRandom(808)
    this.planes = []
    this.runwayBusy = null
    this.landingSoon = false
    const R = physics.RAPIER
    A.stands.forEach((sx, i) => {
      const model = i === 1 ? makePropPlane(i) : makeAirliner(i)
      scene.add(model.group)
      const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased())
      const big = model.kind === 'jet'
      physics.tag(physics.world.createCollider(R.ColliderDesc.cuboid(big ? 2.0 : 0.8, big ? 2.0 : 0.8, model.length * 0.42).setTranslation(0, 0, 0), body), { kind: 'plane', material: 'metal' })
      physics.tag(physics.world.createCollider(R.ColliderDesc.cuboid(big ? 15 : 5.5, 0.3, big ? 2.5 : 0.9).setTranslation(0, big ? -0.9 : 0.85, big ? -0.5 : 1.2), body), { kind: 'plane', material: 'metal' })
      const p = {
        i, sx, model, body, phase: 'park', timer: 8 + i * 22 + this.rnd.range(0, 8),
        pos: V(sx, 0, A.standZ), heading: 0, pitch: 0, bank: 0, speed: 0, gear: 1, path: null, s: 0, prevHeading: 0,
        maxSpeed: big ? 72 : 48, rotate: big ? 58 : 38,
      }
      p.pos.y = this.ground(p.pos.x, p.pos.z) + model.gearHeight
      this.planes.push(p)
    })
    this.jets = []
    this.nextJet = 6
    this.trails = this.buildTrails()
    this._tan = new THREE.Vector3()
    this._q = new THREE.Quaternion()
    this._e = new THREE.Euler()
    this.apply(0)
  }

  ground(x, z) {
    return this.layout.getHeight(x, z) + 0.06
  }

  // ---------------------------------------------------------------- routes
  taxiOut(p) {
    const g = p.model.gearHeight
    const y = (x, z) => this.ground(x, z) + g
    const pts = []
    line(pts, V(p.sx, y(p.sx, A.standZ), A.standZ), V(p.sx, y(p.sx, -258), -258))
    return pts
  }

  taxiToHold(p) {
    const g = p.model.gearHeight
    const y = (x, z) => this.ground(x, z) + g
    const c = A.connectors[0]
    const pts = [V(p.sx, y(p.sx, -258), -258)]
    arc(pts, pts[0], V(p.sx, y(p.sx, TZ), TZ), V(p.sx - 14, y(p.sx - 14, TZ), TZ))
    line(pts, pts[pts.length - 1], V(c + 14, y(c + 14, TZ), TZ), 3)
    arc(pts, pts[pts.length - 1], V(c, y(c, TZ), TZ), V(c, y(c, TZ - 12), TZ - 12))
    line(pts, pts[pts.length - 1], V(c, y(c, RZ + 20), RZ + 20))
    return pts
  }

  lineUp(p) {
    const g = p.model.gearHeight
    const y = (x, z) => this.ground(x, z) + g
    const c = A.connectors[0]
    const pts = [V(c, y(c, RZ + 20), RZ + 20)]
    arc(pts, pts[0], V(c, y(c, RZ), RZ), V(c + 16, y(c + 16, RZ), RZ))
    return pts
  }

  takeoffAndCircuit(p) {
    const g = p.model.gearHeight
    const pts = []
    const x0 = A.connectors[0] + 16
    line(pts, V(x0, this.ground(x0, RZ) + g, RZ), V(40, this.ground(40, RZ) + g, RZ), 4)
    const air = [
      V(40, 2 + g, RZ), V(140, 22, RZ), V(250, 70, RZ + 10), V(320, 120, -200), V(330, 170, 0), V(310, 200, 200),
      V(160, 220, 310), V(-120, 220, 310), V(-300, 200, 210), V(-330, 160, 0), V(-320, 110, -160),
      V(-335, 70, -260), V(-320, 42, RZ), V(-250, 22, RZ), V(-200, 10, RZ), V(-160, this.ground(-160, RZ) + g, RZ),
    ]
    const curve = new THREE.CatmullRomCurve3(air, false, 'centripetal')
    const n = Math.ceil(curve.getLength() / 6)
    const sp = curve.getSpacedPoints(n)
    for (let i = 1; i < sp.length; i++) pts.push(sp[i])
    return pts
  }

  rollout(p) {
    const g = p.model.gearHeight
    const y = (x, z) => this.ground(x, z) + g
    const pts = []
    line(pts, V(-160, y(-160, RZ), RZ), V(A.connectors[2] - 16, y(A.connectors[2] - 16, RZ), RZ), 4)
    return pts
  }

  taxiIn(p) {
    const g = p.model.gearHeight
    const y = (x, z) => this.ground(x, z) + g
    const c = A.connectors[2]
    const pts = [V(c - 16, y(c - 16, RZ), RZ)]
    arc(pts, pts[0], V(c, y(c, RZ), RZ), V(c, y(c, RZ + 14), RZ + 14))
    line(pts, pts[pts.length - 1], V(c, y(c, TZ - 12), TZ - 12))
    arc(pts, pts[pts.length - 1], V(c, y(c, TZ), TZ), V(c - 14, y(c - 14, TZ), TZ))
    line(pts, pts[pts.length - 1], V(p.sx + 14, y(p.sx + 14, TZ), TZ), 3)
    arc(pts, pts[pts.length - 1], V(p.sx, y(p.sx, TZ), TZ), V(p.sx, y(p.sx, -258), -258))
    line(pts, pts[pts.length - 1], V(p.sx, y(p.sx, A.standZ), A.standZ))
    return pts
  }

  begin(p, phase, points, opts = {}) {
    p.phase = phase
    p.path = new Path(points)
    p.s = 0
    p.reverse = !!opts.reverse
    p.target = opts.target ?? 8
  }

  // ---------------------------------------------------------------- update
  update(dt, t) {
    for (const p of this.planes) this.updatePlane(p, dt)
    this.updateJets(dt, t)
    this.apply(t)
  }

  updatePlane(p, dt) {
    p.timer -= dt
    if (p.runwayTimer > 0) {
      p.runwayTimer -= dt
      if (p.runwayTimer <= 0 && this.runwayBusy === p) this.runwayBusy = null
    }
    switch (p.phase) {
      case 'park':
        p.speed = 0
        if (p.timer <= 0) this.begin(p, 'pushback', this.taxiOut(p), { reverse: true, target: 2.2 })
        return
      case 'hold':
        p.speed = damp(p.speed, 0, 3, dt)
        if (!this.runwayBusy && !this.landingSoon && p.timer <= 0) {
          this.runwayBusy = p
          this.begin(p, 'lineup', this.lineUp(p), { target: 5 })
        }
        return
    }
    if (!p.path) return
    // speed control along the path
    let target = p.target
    const remaining = p.path.total - p.s
    if (p.phase === 'takeoff') {
      target = p.maxSpeed
      const airborne = p.s > 230
      p.gear = damp(p.gear, airborne && p.s > 600 ? 0 : 1, 1.5, dt)
      // approach: lower gear and slow down on the last part of the circuit
      if (remaining < 520) {
        target = p.maxSpeed * 0.78
        p.gear = damp(p.gear, 1, 2, dt)
        this.landingSoon = true
      }
      if (remaining < 60) target = p.maxSpeed * 0.7
    } else if (p.phase === 'rollout') {
      target = remaining > 120 ? 28 : 9
    } else if (remaining < 12 && p.phase !== 'takeoff') target = Math.min(target, 3)
    const acc = p.phase === 'takeoff' ? (p.s < 260 ? 5.5 : 4) : p.phase === 'rollout' ? 6 : 2.5
    p.speed += clamp(target - p.speed, -acc * dt, acc * dt)
    p.s += p.speed * dt
    if (p.s >= p.path.total) {
      p.s = p.path.total
      this.next(p)
    }
  }

  next(p) {
    switch (p.phase) {
      case 'pushback':
        this.begin(p, 'taxiOut', this.taxiToHold(p), { target: 9 })
        break
      case 'taxiOut':
        p.phase = 'hold'
        p.path = null
        p.timer = 2
        break
      case 'lineup':
        this.begin(p, 'takeoff', this.takeoffAndCircuit(p), { target: p.maxSpeed })
        // the runway is free again once airborne; re-taken for landing below
        p.runwayTimer = 9
        break
      case 'takeoff':
        this.landingSoon = false
        this.runwayBusy = p
        this.begin(p, 'rollout', this.rollout(p), { target: 30 })
        break
      case 'rollout':
        if (this.runwayBusy === p) this.runwayBusy = null
        this.begin(p, 'taxiIn', this.taxiIn(p), { target: 9 })
        break
      case 'taxiIn':
        p.phase = 'park'
        p.path = null
        p.timer = 25 + this.rnd.range(0, 30)
        break
    }
  }

  apply(t) {
    const tan = this._tan
    for (const p of this.planes) {
      if (p.path) {
        p.path.at(p.s, p.pos, tan)
        let heading = Math.atan2(tan.x, tan.z)
        if (p.reverse) heading += Math.PI
        const turn = angleDelta(p.prevHeading ?? heading, heading)
        p.prevHeading = heading
        p.heading = heading
        const climb = Math.asin(clamp(tan.y, -1, 1))
        const onGround = p.pos.y < this.ground(p.pos.x, p.pos.z) + p.model.gearHeight + 0.5
        // rotate on the take-off roll, flare on landing
        const rot = p.phase === 'takeoff' && p.s < 300 ? clamp((p.speed - p.rotate) / 10, 0, 1) * 0.14 : 0
        p.pitch = damp(p.pitch, onGround ? rot : climb + 0.04, 3, 1 / 60)
        const bankTarget = onGround ? 0 : clamp((turn * 60 * p.speed) / 9.81 * 0.06, -0.6, 0.6)
        p.bank = damp(p.bank, bankTarget, 2, 1 / 60)
      }
      const g = p.model.group
      g.position.copy(p.pos)
      this._q.setFromEuler(this._e.set(-p.pitch, p.heading, -p.bank, 'YXZ'))
      g.quaternion.copy(this._q)
      p.model.gear.visible = p.gear > 0.5
      for (const pr of p.model.props) pr.rotation.z += 0.9 + p.speed * 0.05
      animateLights(p.model, t, p.i * 0.37)
      p.body.setNextKinematicTranslation({ x: p.pos.x, y: p.pos.y, z: p.pos.z })
      p.body.setNextKinematicRotation({ x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w })
    }
  }

  // ---------------------------------------------------------------- high-altitude jets
  buildTrails() {
    const max = 1600
    const geo = new THREE.BufferGeometry()
    this.trailPos = new Float32Array(max * 3)
    this.trailAge = new Float32Array(max)
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('aAge', new THREE.BufferAttribute(this.trailAge, 1).setUsage(THREE.DynamicDrawUsage))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uSize: { value: 260 } },
      vertexShader: `attribute float aAge; varying float vA; uniform float uSize;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          vA = clamp(1.0 - aAge / 45.0, 0.0, 1.0) * step(0.001, aAge);
          gl_PointSize = uSize * (0.6 + aAge * 0.05) / -mv.z; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d) * vA * 0.35; if (a < 0.01) discard; gl_FragColor = vec4(vec3(1.0), a); }`,
    })
    const pts = new THREE.Points(geo, mat)
    pts.frustumCulled = false
    this.scene.add(pts)
    this.trailCursor = 0
    return pts
  }

  updateJets(dt, t) {
    this.nextJet -= dt
    if (this.nextJet <= 0 && this.jets.length < 2) {
      this.nextJet = 45 + this.rnd.random() * 50
      const a = this.rnd.random() * Math.PI * 2
      const off = (this.rnd.random() - 0.5) * 500
      const dir = V(Math.cos(a + Math.PI), 0, Math.sin(a + Math.PI))
      const start = V(Math.cos(a) * 1400 - dir.z * off, 460 + this.rnd.random() * 80, Math.sin(a) * 1400 + dir.x * off)
      const model = makeAirliner(this.rnd.int(0, 3))
      model.gear.visible = false
      for (const m of model.group.children) m.castShadow = false
      this.scene.add(model.group)
      this.jets.push({ model, pos: start, dir, speed: 150, life: 2900 / 150, emit: 0 })
    }
    for (const j of this.jets) {
      j.pos.addScaledVector(j.dir, j.speed * dt)
      j.life -= dt
      j.model.group.position.copy(j.pos)
      j.model.group.rotation.y = Math.atan2(j.dir.x, j.dir.z)
      animateLights(j.model, t)
      j.emit -= dt
      if (j.emit <= 0) {
        j.emit = 0.2
        const side = V(j.dir.z, 0, -j.dir.x)
        for (const s of [-5.6, 5.6]) {
          const k = this.trailCursor
          const p = j.pos.clone().addScaledVector(side, s).addScaledVector(j.dir, -14)
          this.trailPos.set([p.x, p.y - 1.5, p.z], k * 3)
          this.trailAge[k] = 0.001
          this.trailCursor = (k + 1) % this.trailAge.length
        }
      }
    }
    for (const j of this.jets) if (j.life <= 0) this.scene.remove(j.model.group)
    this.jets = this.jets.filter((j) => j.life > 0)
    for (let i = 0; i < this.trailAge.length; i++) if (this.trailAge[i] > 0) this.trailAge[i] += dt
    this.trails.geometry.attributes.position.needsUpdate = true
    this.trails.geometry.attributes.aAge.needsUpdate = true
  }
}
