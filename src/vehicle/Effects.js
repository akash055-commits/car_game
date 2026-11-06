// Vehicle effects: dust / spray puffs from the wheels, exhaust, landing bursts,
// pickup sparkles (one pooled billboard system) and fading skid-mark ribbons.
import * as THREE from 'three'
import { U } from '../world/Uniforms.js'
import { WORLD } from '../world/Layout.js'

export const KIND = { dust: 0, spray: 1, exhaust: 2, sparkle: 3, smoke: 4, fire: 5, flash: 6, spark: 7, debris: 8, nitro: 9 }
// gravity (m/s^2, + is up), drag rate and peak alpha per kind
const GRAV = [0.4, -4, 0.4, -6, 1.2, 2.5, 0, -9, -11, 0.2]
const DRAG = [2.2, 2.2, 2.2, 1.5, 1.2, 2.5, 6, 0.6, 0.4, 5]
const ALPHA = [0.55, 0.55, 0.55, 1, 0.7, 0.95, 1, 1, 0.95, 0.9]

export class Effects {
  constructor(scene, layout, quality) {
    this.layout = layout
    this.max = Math.round(900 * Math.max(0.6, quality.particles))
    this.parts = []
    for (let i = 0; i < this.max; i++) this.parts.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 1, kind: 0, rot: 0, grow: 1 })
    this.cursor = 0

    const base = new THREE.PlaneGeometry(1, 1)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = base.index
    geo.setAttribute('position', base.attributes.position)
    geo.setAttribute('uv', base.attributes.uv)
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4).setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aPos', this.aPos)
    geo.setAttribute('aData', this.aData)
    geo.instanceCount = 0
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uDirt: U.uDirt, uSand: U.uSand, uNight: U.uNight, uSunColor: U.uSunColor },
      vertexShader: /* glsl */ `
        attribute vec3 aPos;
        attribute vec4 aData; // size, alpha, kind, rotation
        varying vec2 vUv;
        varying float vAlpha;
        varying float vKind;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = viewMatrix * vec4(aPos, 1.0);
          float c = cos(aData.w), s = sin(aData.w);
          vec2 q = mat2(c, -s, s, c) * position.xy;
          mvPosition.xy += q * aData.x;
          gl_Position = projectionMatrix * mvPosition;
          vUv = uv;
          vAlpha = aData.y;
          vKind = aData.z;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uDirt, uSand, uSunColor;
        uniform float uNight;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vKind;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = vUv - 0.5;
          float d = length(c) * 2.0;
          float puff = smoothstep(1.0, 0.2, d) * (0.75 + 0.25 * sin(atan(c.y, c.x) * 5.0 + vKind));
          vec3 col;
          float light = mix(1.0, 0.3, uNight);
          if (vKind < 0.5) col = mix(uDirt, uSand, 0.5) * 1.1 * light;
          else if (vKind < 1.5) col = vec3(0.86, 0.92, 0.96) * light;
          else if (vKind < 2.5) col = vec3(0.62, 0.6, 0.58) * light;
          else if (vKind < 3.5) { col = vec3(1.0, 0.85, 0.45) * 4.0; puff = smoothstep(1.0, 0.0, d); }
          else if (vKind < 4.5) col = vec3(0.2, 0.19, 0.18) * light;
          else if (vKind < 5.5) { col = mix(vec3(4.0, 1.6, 0.35), vec3(3.2, 0.5, 0.1), d); puff = smoothstep(1.0, 0.1, d); }
          else if (vKind < 6.5) { col = vec3(5.0, 4.2, 2.6); puff = smoothstep(1.0, 0.0, d); }
          else if (vKind < 7.5) { col = vec3(4.0, 2.8, 1.2); puff = smoothstep(1.0, 0.3, d); }
          else if (vKind < 8.5) { col = vec3(0.24, 0.2, 0.17) * light; puff = step(d, 0.8); }
          else { col = mix(vec3(1.2, 2.2, 5.0), vec3(3.5, 1.4, 4.0), d); puff = smoothstep(1.0, 0.0, d); }
          col *= mix(vec3(1.0), uSunColor, 0.2);
          gl_FragColor = vec4(col, puff * vAlpha);
          #include <fog_fragment>
        }`,
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 6
    scene.add(this.mesh)

    this.buildSkids(scene)
    this.emitAcc = new Array(8).fill(0)
    this.exhaustAcc = 0
    this.lastSkid = new Array(8).fill(null)
    this._v = new THREE.Vector3()
    this.buildFlame(scene)
  }

  // Nitro exhaust flame: two additive cones placed at the active vehicle's exhaust
  buildFlame(scene) {
    const g = new THREE.Group()
    const add = (r, len, color, opacity) => {
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(r, len, 12, 1, true).translate(0, len / 2, 0).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      )
      m.rotation.y = Math.PI
      g.add(m)
      return m
    }
    this.flameOuter = add(0.12, 1.0, new THREE.Color(0.9, 1.4, 4.0), 0.75)
    this.flameInner = add(0.06, 0.6, new THREE.Color(3.5, 3.5, 4.0), 0.9)
    g.visible = false
    g.renderOrder = 7
    scene.add(g)
    this.flame = g
    this.flameK = 0
  }

  updateFlame(dt, vp, visual) {
    const on = !!(vp && vp.boosting && visual?.exhaustLocal)
    this.flameK += ((on ? 1 : 0) - this.flameK) * Math.min(1, dt * (on ? 18 : 10))
    this.flame.visible = this.flameK > 0.02
    if (!this.flame.visible) return
    const holder = visual.lean || visual.group
    holder.updateMatrixWorld()
    this.flame.position.copy(visual.exhaustLocal).applyMatrix4(holder.matrixWorld)
    holder.getWorldQuaternion(this.flame.quaternion)
    const flick = 0.75 + Math.random() * 0.5
    this.flame.scale.set(this.flameK * (0.9 + Math.random() * 0.2), this.flameK * (0.9 + Math.random() * 0.2), this.flameK * flick * (vp.kind === 'bike' ? 1.1 : 1.3))
  }

  // Explosion / impact helpers used by combat
  explosion(p, size = 1) {
    const n = Math.round(26 * size)
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar((3 + Math.random() * 7) * size)
      this.spawn(KIND.fire, p, v, (0.9 + Math.random() * 0.8) * size, 0.5 + Math.random() * 0.5, 2.2)
    }
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5).normalize().multiplyScalar((1.5 + Math.random() * 4) * size)
      this.spawn(KIND.smoke, p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * size, Math.random() * size, (Math.random() - 0.5) * 2 * size)), v, (1.2 + Math.random()) * size, 2.2 + Math.random() * 2.2, 2.6)
    }
    for (let i = 0; i < n * 0.6; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 1.2 + 0.4, Math.random() - 0.5).normalize().multiplyScalar((6 + Math.random() * 10) * size)
      this.spawn(i % 2 ? KIND.spark : KIND.debris, p, v, i % 2 ? 0.12 : 0.18 + Math.random() * 0.2, 0.8 + Math.random() * 1.2, 0)
    }
    this.spawn(KIND.flash, p, new THREE.Vector3(), 4.5 * size, 0.16, 1)
  }

  impactPuff(p, normal, material = 'stone') {
    const n = normal || new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < 5; i++) {
      const v = n.clone().multiplyScalar(1.5 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2))
      this.spawn(material === 'ground' || material === 'dirt' ? KIND.dust : KIND.exhaust, p, v, 0.18 + Math.random() * 0.12, 0.5 + Math.random() * 0.4, 2)
    }
    for (let i = 0; i < (material === 'metal' ? 6 : 2); i++) {
      const v = n.clone().multiplyScalar(3 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4))
      this.spawn(KIND.spark, p, v, 0.06, 0.25 + Math.random() * 0.3, 0)
    }
  }

  muzzle(p, dir) {
    this.spawn(KIND.flash, p, new THREE.Vector3(), 0.45 + Math.random() * 0.25, 0.05, 0.5)
    this.spawn(KIND.exhaust, p, dir.clone().multiplyScalar(1.5).add(new THREE.Vector3(0, 0.4, 0)), 0.15, 0.6, 2.5)
  }

  smokeTrail(p, k = 1, fire = false) {
    this.spawn(KIND.smoke, p, new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6), 0.5 + k * 0.5, 1.8 + Math.random(), 2.4)
    if (fire) this.spawn(KIND.fire, p, new THREE.Vector3((Math.random() - 0.5) * 0.5, 1.5 + Math.random(), (Math.random() - 0.5) * 0.5), 0.4 + Math.random() * 0.4, 0.5 + Math.random() * 0.3, 1.2)
  }

  buildSkids(scene) {
    this.skidMax = 900
    const pos = new Float32Array(this.skidMax * 4 * 3)
    const birth = new Float32Array(this.skidMax * 4).fill(-1000)
    const idx = []
    for (let i = 0; i < this.skidMax; i++) {
      const o = i * 4
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1).setUsage(THREE.DynamicDrawUsage))
    geo.setIndex(idx)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      uniforms: { uTime: U.uTime, uWet: U.uWet },
      vertexShader: `attribute float aBirth; varying float vA; uniform float uTime;
        void main(){ vA = clamp(1.0 - (uTime - aBirth) / 25.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vA; uniform float uWet;
        void main(){ if (vA <= 0.0) discard; gl_FragColor = vec4(vec3(0.12, 0.09, 0.07), vA * mix(0.42, 0.25, uWet)); }`,
    })
    this.skidGeo = geo
    this.skidCursor = 0
    this.skids = new THREE.Mesh(geo, mat)
    this.skids.frustumCulled = false
    this.skids.renderOrder = 1
    scene.add(this.skids)
  }

  spawn(kind, p, v, size, life, grow = 1) {
    const part = this.parts[this.cursor]
    this.cursor = (this.cursor + 1) % this.max
    part.alive = true
    part.kind = kind
    part.p.copy(p)
    part.v.copy(v)
    part.size = size
    part.life = 0
    part.max = life
    part.rot = Math.random() * 6.28
    part.grow = grow
  }

  burst(p, kind = 'sparkle', n = 24) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.3, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 4)
      this.spawn(KIND[kind], p, v, kind === 'sparkle' ? 0.25 : 0.8, 0.6 + Math.random() * 0.6, kind === 'sparkle' ? 0.2 : 2.5)
    }
  }

  addSkid(i, point, right) {
    const last = this.lastSkid[i]
    const w = 0.17
    if (last && last.distanceToSquared(point) < 0.0625) return
    if (last && last.distanceToSquared(point) < 4) {
      const pos = this.skidGeo.attributes.position
      const birth = this.skidGeo.attributes.aBirth
      const o = this.skidCursor * 4
      const t = U.uTime.value
      const pts = [
        [last.x - right.x * w, last.y, last.z - right.z * w],
        [last.x + right.x * w, last.y, last.z + right.z * w],
        [point.x - right.x * w, point.y, point.z - right.z * w],
        [point.x + right.x * w, point.y, point.z + right.z * w],
      ]
      for (let k = 0; k < 4; k++) {
        pos.setXYZ(o + k, pts[k][0], pts[k][1] + 0.03, pts[k][2])
        birth.setX(o + k, t)
      }
      pos.needsUpdate = true
      birth.needsUpdate = true
      this.skidCursor = (this.skidCursor + 1) % this.skidMax
    }
    this.lastSkid[i] = point.clone()
  }

  update(dt, vp, visual, heli = null) {
    this.updateFlame(dt, vp, visual)
    // Helicopter rotor wash kicks up dust / spray below
    if (heli && heli.rotor > 0.4 && heli.altitude < 12) {
      const p = heli.position
      const k = (1 - heli.altitude / 12) * heli.rotor
      this.washAcc = (this.washAcc || 0) + dt * 40 * k
      const gy = this.layout.getDriveHeight(p.x, p.z)
      while (this.washAcc > 1) {
        this.washAcc -= 1
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 3
        const kind = U.uWet.value > 0.5 || this.layout.isWater(p.x, p.z) ? KIND.spray : KIND.dust
        this.spawn(kind, new THREE.Vector3(p.x + Math.cos(a) * r, gy + 0.2, p.z + Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * 7, 0.6, Math.sin(a) * 7), 0.9, 1.2, 2.8)
      }
    }
    if (!vp) return this.integrate(dt)
    const lv = vp.body.linvel()
    const speed = Math.hypot(lv.x, lv.z)
    const wet = U.uWet.value
    const { right } = vp.basis()
    const rightFlat = this._v.set(right.x, 0, right.z).normalize().clone()

    for (let i = 0; i < vp.nWheels; i++) {
      const s = vp.wheelState(i)
      if (!s.contact || !s.point) {
        this.lastSkid[i] = null
        continue
      }
      const pt = new THREE.Vector3(s.point.x, s.point.y, s.point.z)
      const slip = vp.slip[i]
      const surface = vp.wheelSurface[i]
      const front = vp.wheelPositions[i].front
      // Skid marks from sliding tyres
      if (slip > 0.5 && speed > 3 && !(front && slip < 0.8)) this.addSkid(i, pt, rightFlat)
      else this.lastSkid[i] = null

      // Dust (dirt) / spray (wet)
      let rate = 0
      if (surface === 'dirt' && wet < 0.5) rate = Math.max(0, speed - 3) * 1.4 + slip * 40
      else if (wet > 0.5 && speed > 4) rate = speed * 1.6 + slip * 30
      else if (slip > 0.6) rate = slip * 18
      if (front) rate *= 0.4
      this.emitAcc[i] += rate * dt
      while (this.emitAcc[i] > 1) {
        this.emitAcc[i] -= 1
        const kind = wet > 0.5 ? KIND.spray : KIND.dust
        const v = new THREE.Vector3(-lv.x * 0.15 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 1.2, -lv.z * 0.15 + (Math.random() - 0.5) * 1.5)
        this.spawn(kind, pt.clone().setY(pt.y + 0.2), v, 0.5 + Math.random() * 0.4, 0.8 + Math.random() * 0.9, kind === KIND.spray ? 1.6 : 2.8)
      }
    }

    // Nitro: blue-violet sparks streaming from the exhaust
    if (vp.boosting && visual.exhaustLocal) {
      const holder = visual.lean || visual.group
      const ex = visual.exhaustLocal.clone().applyMatrix4(holder.matrixWorld)
      const back = new THREE.Vector3(0, 0, -1).applyQuaternion(visual.group.quaternion)
      for (let k = 0; k < 2; k++) this.spawn(KIND.nitro, ex, back.clone().multiplyScalar(4 + Math.random() * 3).add(new THREE.Vector3(lv.x * 0.7, 0.3, lv.z * 0.7)), 0.16 + Math.random() * 0.1, 0.18 + Math.random() * 0.12, 1.5)
    }
    // Exhaust puffs
    this.exhaustAcc += dt * (3 + vp.throttle * 14)
    if (this.exhaustAcc > 1) {
      this.exhaustAcc = 0
      const ex = visual.exhaustLocal.clone().applyMatrix4(visual.group.matrixWorld)
      const back = new THREE.Vector3(0, 0, -1).applyQuaternion(visual.group.quaternion)
      this.spawn(KIND.exhaust, ex, back.multiplyScalar(0.8).add(new THREE.Vector3(lv.x * 0.6, 0.5, lv.z * 0.6)), 0.18 + vp.throttle * 0.15, 0.7, 2.2)
    }

    // Landing burst
    if (vp.landing > 0) {
      const p = vp.position
      for (let k = 0; k < 18 * vp.landing + 6; k++) {
        const a = Math.random() * Math.PI * 2
        this.spawn(wet > 0.5 ? KIND.spray : KIND.dust, new THREE.Vector3(p.x + Math.cos(a) * 1.2, p.y - 0.5, p.z + Math.sin(a) * 1.6), new THREE.Vector3(Math.cos(a) * 3, 1 + Math.random(), Math.sin(a) * 3), 0.8, 1.1, 2.5)
      }
    }

    // Water splash when driving into the lake
    if (vp.inWater > 0 && speed > 1.5) {
      const p = vp.position
      for (let k = 0; k < 3; k++) this.spawn(KIND.spray, new THREE.Vector3(p.x + (Math.random() - 0.5) * 2, WORLD.waterLevel + 0.1, p.z + (Math.random() - 0.5) * 3), new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3), 0.6, 0.9, 1.8)
    }

    this.integrate(dt)
  }

  integrate(dt) {
    // Integrate + upload
    let n = 0
    const P = this.aPos.array, D = this.aData.array
    for (const part of this.parts) {
      if (!part.alive) continue
      part.life += dt
      if (part.life >= part.max) {
        part.alive = false
        continue
      }
      const k = part.life / part.max
      part.v.y += GRAV[part.kind] * dt
      part.v.multiplyScalar(1 - Math.min(1, dt * DRAG[part.kind]))
      part.p.addScaledVector(part.v, dt)
      if ((part.kind === KIND.debris || part.kind === KIND.spark) && part.v.y < 0) {
        const g = this.layout.getDriveHeight(part.p.x, part.p.z)
        if (part.p.y < g + 0.05) { part.p.y = g + 0.05; part.v.set(part.v.x * 0.3, -part.v.y * 0.25, part.v.z * 0.3) }
      }
      P[n * 3] = part.p.x
      P[n * 3 + 1] = part.p.y
      P[n * 3 + 2] = part.p.z
      D[n * 4] = part.size * (1 + k * part.grow)
      const fast = part.kind === KIND.flash || part.kind === KIND.spark || part.kind === KIND.debris
      D[n * 4 + 1] = ALPHA[part.kind] * (fast ? 1 : Math.min(1, k * 8)) * (part.kind === KIND.debris ? 1 - k * k : (1 - k) * (1 - k))
      D[n * 4 + 2] = part.kind
      D[n * 4 + 3] = part.rot + part.life * 0.5
      n++
    }
    this.mesh.geometry.instanceCount = n
    this.aPos.needsUpdate = true
    this.aData.needsUpdate = true
  }
}
