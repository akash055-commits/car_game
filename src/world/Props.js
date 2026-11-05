// Static and dynamic props: street lamps, stone bridges, pier, ramps, benches, rocks,
// seasonal decor and knockable crates / barrels / cones (physics-synced).
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { WORLD } from './Layout.js'
import { U } from './Uniforms.js'
import { makeRandom } from '../core/math.js'

const UP = new THREE.Vector3(0, 1, 0)

// Darken + gloss materials in the rain
export function wettable(mat) {
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, r) => {
    prev && prev(shader, r)
    shader.uniforms.uWet = U.uWet
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uWet * 0.3;')
    if (shader.fragmentShader.includes('#include <roughnessmap_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, uWet);')
    }
  }
  return mat
}

const std = (color, roughness = 0.8, extra = {}) => wettable(new THREE.MeshStandardMaterial({ color, roughness, ...extra }))

function shadowed(mesh, cast = true) {
  mesh.castShadow = cast
  mesh.receiveShadow = true
  return mesh
}

function interpApply(mesh, index, scale = null) {
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const qb = new THREE.Quaternion()
  const s = scale || new THREE.Vector3(1, 1, 1)
  return (prev, curr, a) => {
    p.set(prev.p.x + (curr.p.x - prev.p.x) * a, prev.p.y + (curr.p.y - prev.p.y) * a, prev.p.z + (curr.p.z - prev.p.z) * a)
    q.set(prev.q.x, prev.q.y, prev.q.z, prev.q.w)
    qb.set(curr.q.x, curr.q.y, curr.q.z, curr.q.w)
    q.slerp(qb, a)
    m.compose(p, q, s)
    mesh.setMatrixAt(index, m)
    mesh.instanceMatrix.needsUpdate = true
  }
}

export class Props {
  constructor(scene, physics, layout, town) {
    this.scene = scene
    this.physics = physics
    this.layout = layout
    this.town = town
    this.R = physics.RAPIER
    this.rnd = makeRandom(42)
    this.lanterns = [] // world positions of lantern lights

    this.mat = {
      wood: std(0xa86b3d, 0.85),
      woodDark: std(0x6e4228, 0.9),
      plank: std(0xb98552, 0.8),
      stone: std(0x9b8f86, 0.9),
      iron: std(0x3b3532, 0.6, { metalness: 0.4 }),
      cream: std(0xf1e4cc, 0.7),
      asphalt: std(0x55504c, 0.85),
      walk: std(0xc9bfb2, 0.9),
      line: std(0xf2efe6, 0.7),
    }
    this.lanternGlass = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb25a, emissiveIntensity: 1.5, roughness: 0.4 })
    this.windowMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, emissive: 0xffb866, emissiveIntensity: 0.1, roughness: 0.2 })

    this.buildBridges()
    this.buildPier()
    this.buildRamps()
    for (const l of town.lampSpots) this.addLanternAt(l.x, l.z, 1)
    const loop = town.joggingLoop
    if (loop) {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + 0.15
        const x = loop.x + Math.cos(a) * (loop.r + 2.2), z = loop.z + Math.sin(a) * (loop.r + 2.2)
        if (layout.channelDistance(x, z) > 2 && !layout.isWater(x, z)) this.addLanternAt(x, z, 0.9)
      }
    }
    this.buildLanterns()
    this.buildBenches()
    this.buildRocks()
    this.buildDynamics()
    this.buildSeasonal()
    this.buildGlowDecals()
  }

  fixedBox(x, y, z, hx, hy, hz, quat, tag) {
    const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(quat || { x: 0, y: 0, z: 0, w: 1 }))
    const c = this.physics.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.8), body)
    this.physics.tag(c, tag || { kind: 'prop', material: 'wood' })
    return c
  }

  // ------------------------------------------------------------- Bridge
  // ------------------------------------------------------------- Stone bridges
  buildBridges() {
    const L = this.layout
    const deckHalf = WORLD.roadHalfWidth + WORLD.sidewalk
    const slabs = [], walks = [], parapets = [], dashes = []
    for (const b of L.bridges) {
      const hs = Math.round(b.half / 0.5)
      for (let d = -hs; d < hs; d += 4) {
        const i = b.center + d, i2 = Math.min(b.center + d + 4, b.center + hs)
        if (i < b.start || i2 > b.end) continue
        const ax = L.roadX[i], az = L.roadZ[i], ay = L.roadH[i]
        const bx = L.roadX[i2], bz = L.roadZ[i2], by = L.roadH[i2]
        const mid = new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
        const len = Math.hypot(bx - ax, bz - az)
        const heading = Math.atan2(bx - ax, bz - az)
        const pitch = -Math.atan2(by - ay, len)
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, heading, 0, 'YXZ'))
        const nx = Math.cos(heading), nz = -Math.sin(heading)
        slabs.push(new THREE.Matrix4().compose(mid.clone().setY(mid.y - 0.26), q, new THREE.Vector3(WORLD.roadHalfWidth * 2, 0.5, len + 0.05)))
        for (const side of [-1, 1]) {
          const off = WORLD.roadHalfWidth + WORLD.sidewalk / 2
          walks.push(new THREE.Matrix4().compose(new THREE.Vector3(mid.x + nx * side * off, mid.y - 0.14, mid.z + nz * side * off), q, new THREE.Vector3(WORLD.sidewalk, 0.5, len + 0.05)))
          const po = deckHalf + 0.2
          const pp = new THREE.Vector3(mid.x + nx * side * po, mid.y + 0.45, mid.z + nz * side * po)
          parapets.push(new THREE.Matrix4().compose(pp, q, new THREE.Vector3(0.45, 1.1, len + 0.05)))
          this.fixedBox(pp.x, pp.y, pp.z, 0.25, 0.6, len / 2 + 0.05, q, { kind: 'prop', material: 'stone' })
        }
        if (Math.abs(d) % 8 === 0) dashes.push(new THREE.Matrix4().compose(mid.clone().setY(mid.y + 0.005), q, new THREE.Vector3(0.15, 0.02, 2)))
      }
      // stone piers under the deck
      for (const side of [-1, 1]) {
        const off = side * (b.half - 2)
        const x = b.x + b.tx * off, z = b.z + b.tz * off
        const g = L.getHeight(x, z)
        const h = Math.max(0.5, L.roadH[b.center] - g)
        const pier = shadowed(new THREE.Mesh(new THREE.BoxGeometry(deckHalf * 2, h, 1.6), this.mat.stone))
        pier.position.set(x, g + h / 2 - 0.4, z)
        pier.rotation.y = Math.atan2(b.tx, b.tz)
        this.scene.add(pier)
      }
    }
    const inst = (geo, mat, list) => {
      const m = shadowed(new THREE.InstancedMesh(geo, mat, list.length))
      list.forEach((mm, i) => m.setMatrixAt(i, mm))
      this.scene.add(m)
      return m
    }
    const box = new THREE.BoxGeometry(1, 1, 1)
    inst(box, this.mat.asphalt, slabs)
    inst(box, this.mat.walk, walks)
    inst(box, this.mat.stone, parapets)
    inst(box, this.mat.line, dashes)
  }

  // ------------------------------------------------------------- Pier on the park lake
  buildPier() {
    const L = this.layout
    const lake = L.lake
    const x0 = lake.x - 6, z0 = lake.z + lake.r + 2.5, len = 11
    const g = new THREE.Group()
    const deckY = WORLD.waterLevel + 0.75
    const planks = shadowed(new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.1, 0.42), this.mat.plank, Math.round(len / 0.46)))
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    for (let i = 0; i < planks.count; i++) {
      m.makeTranslation(0, deckY, -i * 0.46)
      planks.setMatrixAt(i, m)
      planks.setColorAt(i, c.setHSL(0.07, 0.42, 0.42 + this.rnd.random() * 0.12))
    }
    g.add(planks)
    for (let i = 0; i <= len; i += 2.5) {
      for (const sx of [-1.1, 1.1]) {
        const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3, 8), this.mat.woodDark))
        post.position.set(sx, deckY - 1.2, -i)
        g.add(post)
      }
    }
    g.position.set(x0, 0, z0)
    this.scene.add(g)
    const mid = new THREE.Vector3(x0, deckY - 0.1, z0 - len / 2)
    this.fixedBox(mid.x, mid.y, mid.z, 1.2, 0.08, len / 2, new THREE.Quaternion(), { kind: 'prop', material: 'wood' })
    this.pier = { x: x0, z: z0 - len + 1, y: deckY }
  }

  // ------------------------------------------------------------- Ramps (stunt park)
  buildRamps() {
    const sp = this.town.stuntPark
    const defs = sp ? [
      { x: sp.x0 + 6, z: sp.cz - 8, heading: Math.PI / 2, len: 7, h: 1.7 },
      { x: sp.x1 - 7, z: sp.cz + 9, heading: -Math.PI / 2, len: 8, h: 2.1 },
      { x: sp.cx + 2, z: sp.z0 + 6, heading: 0, len: 6, h: 1.4 },
    ] : []
    this.ramps = []
    for (const d of defs) {
      const w = 4.2
      const y = this.layout.getHeight(d.x, d.z)
      const verts = [
        [-w / 2, 0, -d.len / 2], [w / 2, 0, -d.len / 2], [-w / 2, 0, d.len / 2], [w / 2, 0, d.len / 2],
        [-w / 2, d.h, d.len / 2], [w / 2, d.h, d.len / 2],
      ]
      const geo = new THREE.BufferGeometry()
      const tri = [[0, 2, 4], [1, 5, 3], [0, 4, 5], [0, 5, 1], [2, 3, 5], [2, 5, 4], [0, 1, 3], [0, 3, 2]]
      const pos = []
      for (const t of tri) for (const i of t) pos.push(...verts[i])
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geo.computeVertexNormals()
      const ramp = shadowed(new THREE.Mesh(geo, this.mat.plank))
      ramp.position.set(d.x, y - 0.05, d.z)
      ramp.rotation.y = d.heading
      this.scene.add(ramp)
      const slope = Math.atan2(d.h, d.len)
      for (let i = 0; i < 5; i++) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.03, 0.16), i % 2 ? this.mat.cream : this.mat.woodDark)
        const t = (i + 0.5) / 5
        strip.position.set(0, d.h * t + 0.02, -d.len / 2 + d.len * t)
        strip.rotation.x = -slope
        ramp.add(strip)
      }
      const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(d.x, y - 0.05, d.z).setRotation(new THREE.Quaternion().setFromAxisAngle(UP, d.heading)))
      const hull = this.R.ColliderDesc.convexHull(new Float32Array(verts.flat()))
      this.physics.tag(this.physics.world.createCollider(hull.setFriction(0.9), body), { kind: 'prop', material: 'wood' })
      this.layout.occupy(d.x, d.z, d.len * 0.6)
      this.ramps.push({ ...d, y, top: new THREE.Vector3(d.x + Math.sin(d.heading) * d.len * 0.5, y + d.h, d.z + Math.cos(d.heading) * d.len * 0.5) })
    }
  }

  addLanternAt(x, z, scale = 1, yOverride) {
    const y = yOverride ?? this.layout.getHeight(x, z)
    this.pendingLanterns = this.pendingLanterns || []
    this.pendingLanterns.push({ x, y, z, scale })
    this.layout.occupy(x, z, 0.6)
  }

  buildLanterns() {
    const list = this.pendingLanterns
    const n = list.length
    const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.0, 6).translate(0, 0.5, 0)
    const capGeo = new THREE.ConeGeometry(0.3, 0.25, 4).rotateY(Math.PI / 4).translate(0, 0.12, 0)
    const glassGeo = new RoundedBoxGeometry(0.34, 0.42, 0.34, 1, 0.05)
    const frameGeo = new THREE.BoxGeometry(0.4, 0.06, 0.4)
    const posts = shadowed(new THREE.InstancedMesh(postGeo, this.mat.iron, n))
    const caps = shadowed(new THREE.InstancedMesh(capGeo, this.mat.iron, n))
    const glass = new THREE.InstancedMesh(glassGeo, this.lanternGlass, n)
    const frames = shadowed(new THREE.InstancedMesh(frameGeo, this.mat.iron, n))
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    list.forEach((l, i) => {
      const k = l.scale
      const postH = 1.6 * k
      m.compose(p.set(l.x, l.y, l.z), q.identity(), s.set(k, postH, k))
      posts.setMatrixAt(i, m)
      m.compose(p.set(l.x, l.y + postH + 0.24 * k, l.z), q, s.set(k, k, k))
      glass.setMatrixAt(i, m)
      m.compose(p.set(l.x, l.y + postH, l.z), q, s.set(k, k, k))
      frames.setMatrixAt(i, m)
      m.compose(p.set(l.x, l.y + postH + 0.46 * k, l.z), q, s.set(k, k, k))
      caps.setMatrixAt(i, m)
      this.lanterns.push(new THREE.Vector3(l.x, l.y + postH + 0.24 * k, l.z))
      const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(l.x, l.y + postH / 2, l.z))
      this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cylinder(postH / 2, 0.12), body), { kind: 'prop', material: 'metal' })
    })
    this.scene.add(posts, caps, glass, frames)
  }

  // Additive light pools on the ground under every lantern
  buildGlowDecals() {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    this.glowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uNight: U.uNight, uColor: { value: new THREE.Color(1.0, 0.62, 0.3) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uNight; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(1.0 - d, 0.0), 2.2); gl_FragColor = vec4(uColor * a * (0.05 + uNight * 0.75), 1.0); }`,
    })
    const n = this.lanterns.length
    const decals = new THREE.InstancedMesh(geo, this.glowMat, n)
    const m = new THREE.Matrix4()
    this.lanterns.forEach((l, i) => {
      const y = this.layout.getDriveHeight(l.x, l.z)
      m.makeScale(7, 1, 7).setPosition(l.x, y + 0.1, l.z)
      decals.setMatrixAt(i, m)
    })
    decals.renderOrder = 3
    this.scene.add(decals)
  }

  // ------------------------------------------------------------- Fences
  // ------------------------------------------------------------- Benches (from the town plan)
  buildBenches() {
    const list = this.town.benches.filter((b) => !this.layout.isWater(b.x, b.z))
    const seat = shadowed(new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.08, 0.45), this.mat.wood, list.length))
    const back = shadowed(new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.4, 0.06), this.mat.wood, list.length))
    const legs = shadowed(new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.45, 0.4), this.mat.iron, list.length))
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    list.forEach((b, i) => {
      const y = this.layout.getDriveHeight(b.x, b.z)
      q.setFromAxisAngle(UP, b.rot)
      const at = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(b.x, y, b.z))
      seat.setMatrixAt(i, m.compose(at(0, 0.45, 0), q, new THREE.Vector3(1, 1, 1)))
      back.setMatrixAt(i, m.compose(at(0, 0.75, -0.2), q, new THREE.Vector3(1, 1, 1)))
      legs.setMatrixAt(i, m.compose(at(0, 0.22, 0), q, new THREE.Vector3(1, 1, 0.9)))
      b.y = y
      this.layout.occupy(b.x, b.z, 1.1)
    })
    this.benches = list
    this.scene.add(seat, back, legs)
  }

  buildRocks() {
    const rnd = this.rnd
    const geo = new THREE.DodecahedronGeometry(1, 1)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i)
      v.multiplyScalar(0.8 + this.layout.n2(v.x * 1.7 + 3, v.z * 1.7 + v.y) * 0.18)
      v.y *= 0.72
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    const flat = geo.index ? geo.toNonIndexed() : geo
    flat.computeVertexNormals()
    const mat = wettable(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true }))
    const prev = mat.onBeforeCompile
    mat.onBeforeCompile = (shader, r) => {
      prev(shader, r)
      shader.uniforms.uRock = U.uRock
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRock;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = uRock * (0.85 + 0.3 * vColor.r);')
    }
    mat.vertexColors = true
    const c = new Float32Array(flat.attributes.position.count * 3)
    for (let i = 0; i < c.length; i += 9) {
      const v = 0.6 + rnd.random() * 0.4
      c.fill(v, i, i + 9)
    }
    flat.setAttribute('color', new THREE.BufferAttribute(c, 3))
    const rocks = []
    let tries = 0
    while (rocks.length < 130 && tries < 8000) {
      tries++
      const x = rnd.range(-335, 335), z = rnd.range(-335, 335)
      if (Math.max(Math.abs(x), Math.abs(z)) < 182 && rnd.random() < 0.85) continue
      const sc = rnd.random() < 0.15 ? rnd.range(1.4, 2.6) : rnd.range(0.35, 1.1)
      if (!this.layout.isFree(x, z, sc, { roadMargin: 1.2, allowWater: true })) continue
      const y = this.layout.getHeight(x, z)
      rocks.push({ x, y, z, sc })
      this.layout.occupy(x, z, sc)
    }
    const mesh = shadowed(new THREE.InstancedMesh(flat, mat, rocks.length))
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    rocks.forEach((r, i) => {
      q.setFromEuler(new THREE.Euler(rnd.random() * 0.4, rnd.random() * 6.28, rnd.random() * 0.4))
      m.compose(new THREE.Vector3(r.x, r.y + r.sc * 0.2, r.z), q, new THREE.Vector3(r.sc, r.sc, r.sc))
      mesh.setMatrixAt(i, m)
      if (r.sc > 0.7) {
        const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(r.x, r.y + r.sc * 0.2, r.z))
        this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.ball(r.sc * 0.78), body), { kind: 'rock', material: 'stone' })
      }
      this.layout.clearGrass(r.x, r.z, r.sc * 0.9, 0.7)
    })
    this.scene.add(mesh)
  }

  // ------------------------------------------------------------- Benches
  buildDynamics() {
    const R = this.R
    const world = this.physics.world
    const crateSpots = []
    const sp = this.town.stuntPark
    // Crate pyramid in the stunt park
    const cx = sp.cx + 6, cz = sp.cz + 1
    const yard = this.layout.getHeight(cx, cz)
    const size = 0.9
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 3 - row; i++) {
        for (let d = 0; d < 2; d++) {
          crateSpots.push([cx + (i - (2 - row) / 2) * (size + 0.02), yard + size / 2 + row * size + 0.01, cz + d * (size + 0.02)])
        }
      }
    }
    // Loose crates by the market stalls and the garage
    for (const s of (this.town.stalls || []).slice(0, 2)) crateSpots.push([s.x + 2.6, this.layout.getHeight(s.x + 2.6, s.z) + 0.5, s.z])
    this.layout.occupy(cx, cz, 4)

    const crateGeo = new RoundedBoxGeometry(size, size, size, 1, 0.04)
    const crateMat = wettable(new THREE.MeshStandardMaterial({ map: this.crateTexture(), roughness: 0.85 }))
    const crates = shadowed(new THREE.InstancedMesh(crateGeo, crateMat, crateSpots.length))
    crates.frustumCulled = false
    crateSpots.forEach(([x, y, z], i) => {
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.15).setAngularDamping(0.3))
      const col = world.createCollider(R.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setDensity(40).setFriction(0.7).setRestitution(0.1)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(400), body)
      this.physics.tag(col, { kind: 'crate', material: 'wood' })
      const entry = this.physics.addDynamic(body, interpApply(crates, i))
      entry.apply(entry.prev, entry.curr, 1)
    })
    this.scene.add(crates)

    // Barrels around the brickyard
    const yd = this.town.yard
    const barrelSpots = [[yd.x1 - 14, yd.z0 + 4], [yd.x1 - 13.2, yd.z0 + 5.2], [yd.x1 - 22, yd.z0 + 4.5], [yd.x1 - 21.5, yd.z0 + 5.7], [sp.x0 + 4, sp.z1 - 4], [sp.x0 + 5, sp.z1 - 4.6]]
    const barrelGeo = new THREE.CylinderGeometry(0.38, 0.38, 1.0, 14)
    const barrelMat = wettable(new THREE.MeshStandardMaterial({ color: 0xc0573a, roughness: 0.5, metalness: 0.35 }))
    const barrels = shadowed(new THREE.InstancedMesh(barrelGeo, barrelMat, barrelSpots.length))
    barrels.frustumCulled = false
    const bands = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.395, 0.395, 0.06, 14), this.mat.iron, barrelSpots.length * 2)
    bands.frustumCulled = false
    barrelSpots.forEach(([x, z], i) => {
      const y = this.layout.getHeight(x, z) + 0.52
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.2).setAngularDamping(0.3))
      const col = world.createCollider(R.ColliderDesc.cylinder(0.5, 0.38).setDensity(60).setFriction(0.6).setRestitution(0.2)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(400), body)
      this.physics.tag(col, { kind: 'barrel', material: 'metal' })
      const applyBarrel = interpApply(barrels, i)
      const mb = new THREE.Matrix4()
      const off = new THREE.Matrix4()
      const entry = this.physics.addDynamic(body, (prev, curr, a) => {
        applyBarrel(prev, curr, a)
        barrels.getMatrixAt(i, mb)
        for (let k = 0; k < 2; k++) {
          off.makeTranslation(0, k ? 0.32 : -0.32, 0)
          bands.setMatrixAt(i * 2 + k, mb.clone().multiply(off))
        }
        bands.instanceMatrix.needsUpdate = true
      })
      entry.apply(entry.prev, entry.curr, 1)
      this.layout.occupy(x, z, 0.6)
    })
    this.scene.add(barrels, bands)

    // Cone slalom in the stunt park
    const cones = []
    for (let i = 0; i < 9; i++) cones.push([sp.x0 + 6 + i * 2.8, sp.z1 - 5 + (i % 2) * 1.2])
    const coneGeo = new THREE.ConeGeometry(0.24, 0.62, 12).translate(0, 0.31 - 0.05, 0)
    const baseGeo = new THREE.BoxGeometry(0.46, 0.05, 0.46)
    const coneMat = wettable(new THREE.MeshStandardMaterial({ color: 0xff7a2f, roughness: 0.5 }))
    const coneMesh = shadowed(new THREE.InstancedMesh(coneGeo, coneMat, cones.length))
    const baseMesh = shadowed(new THREE.InstancedMesh(baseGeo, this.mat.iron, cones.length))
    coneMesh.frustumCulled = baseMesh.frustumCulled = false
    cones.forEach(([x, z], i) => {
      const y = this.layout.getHeight(x, z) + 0.05
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.3).setAngularDamping(0.5))
      const col = world.createCollider(R.ColliderDesc.cone(0.3, 0.24).setTranslation(0, 0.26, 0).setDensity(25).setFriction(0.6), body)
      world.createCollider(R.ColliderDesc.cuboid(0.23, 0.025, 0.23).setDensity(80), body)
      col.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      col.setContactForceEventThreshold(150)
      this.physics.tag(col, { kind: 'cone', material: 'plastic' })
      const a1 = interpApply(coneMesh, i)
      const a2 = interpApply(baseMesh, i)
      const entry = this.physics.addDynamic(body, (p, c, a) => { a1(p, c, a); a2(p, c, a) })
      entry.apply(entry.prev, entry.curr, 1)
      this.layout.occupy(x, z, 0.5)
    })
    this.scene.add(coneMesh, baseMesh)
  }

  crateTexture() {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#b07a46'
    ctx.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#a06c3c' : '#ba8650'
      ctx.fillRect(0, i * 25.6, 128, 25.6)
      ctx.fillStyle = 'rgba(60,35,20,0.5)'
      ctx.fillRect(0, i * 25.6, 128, 2)
    }
    ctx.strokeStyle = '#6e4228'
    ctx.lineWidth = 12
    ctx.strokeRect(6, 6, 116, 116)
    ctx.beginPath()
    ctx.moveTo(10, 10)
    ctx.lineTo(118, 118)
    ctx.stroke()
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }

  // ------------------------------------------------------------- Seasonal decor
  // Instances scale in/out with a season uniform (pumpkins in autumn, flowers in spring)
  seasonalMaterial(color, uniformName, extra = {}) {
    const mat = wettable(new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra }))
    const prev = mat.onBeforeCompile
    mat.onBeforeCompile = (shader, r) => {
      shader.uniforms.uSeason = U[uniformName]
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uSeason;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed *= smoothstep(0.0, 1.0, uSeason);')
      prev(shader, r)
    }
    return mat
  }

  buildSeasonal() {
    const rnd = this.rnd
    // Pumpkins (autumn) near the cabin and start
    const pumpkinGeo = new THREE.SphereGeometry(0.42, 14, 10)
    const pp = pumpkinGeo.attributes.position
    for (let i = 0; i < pp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pp, i)
      const a = Math.atan2(v.z, v.x)
      const ridge = 1 + Math.cos(a * 8) * 0.06
      pp.setXYZ(i, v.x * ridge, v.y * 0.75, v.z * ridge)
    }
    pumpkinGeo.computeVertexNormals()
    const spots = []
    for (const h of this.town.houses) if (this.rnd.random() < 0.35) spots.push([h.door.x + (this.rnd.random() - 0.5) * 1.6, h.door.z + (this.rnd.random() - 0.5) * 0.6])
    const pumpkins = shadowed(new THREE.InstancedMesh(pumpkinGeo, this.seasonalMaterial(0xf07a1e, 'uAutumn'), spots.length))
    const stemGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.18, 6)
    const stems = new THREE.InstancedMesh(stemGeo, this.seasonalMaterial(0x4f6b2a, 'uAutumn'), spots.length)
    const m = new THREE.Matrix4()
    spots.forEach(([x, z], i) => {
      const y = this.layout.getHeight(x, z)
      const s = rnd.range(0.7, 1.25)
      m.makeScale(s, s, s).setPosition(x, y + 0.28 * s, z)
      pumpkins.setMatrixAt(i, m)
      m.makeScale(s, s, s).setPosition(x, y + 0.6 * s, z)
      stems.setMatrixAt(i, m)
    })
    this.scene.add(pumpkins, stems)

    // Flowers (spring) in meadow clusters
    const flowers = []
    let tries = 0
    while (flowers.length < 1100 && tries < 20000) {
      tries++
      const cxp = rnd.range(-300, 300), czp = rnd.range(-185, 300)
      if (this.layout.n2(cxp * 0.05, czp * 0.05) < 0.25) continue
      for (let k = 0; k < 6; k++) {
        const x = cxp + rnd.range(-2.5, 2.5), z = czp + rnd.range(-2.5, 2.5)
        if (!this.layout.isFree(x, z, 0.2, { roadMargin: 0.8 })) continue
        flowers.push([x, this.layout.getHeight(x, z), z, rnd.random()])
      }
    }
    const headGeo = new THREE.IcosahedronGeometry(0.11, 0).translate(0, 0.42, 0)
    const stem = new THREE.CylinderGeometry(0.012, 0.012, 0.42, 4).translate(0, 0.21, 0)
    const fHeads = new THREE.InstancedMesh(headGeo, this.seasonalMaterial(0xffffff, 'uSpring', { emissive: 0x221111 }), flowers.length)
    const fStems = new THREE.InstancedMesh(stem, this.seasonalMaterial(0x5f9a3a, 'uSpring'), flowers.length)
    const col = new THREE.Color()
    const palette = [0xff8fb8, 0xfff0a0, 0xffffff, 0xc59bff, 0xff6f6f]
    flowers.forEach(([x, y, z, r], i) => {
      const s = 0.7 + r * 0.6
      m.makeScale(s, s, s).setPosition(x, y, z)
      fHeads.setMatrixAt(i, m)
      fStems.setMatrixAt(i, m)
      fHeads.setColorAt(i, col.set(palette[Math.floor(r * palette.length)]))
    })
    fHeads.castShadow = false
    this.scene.add(fHeads, fStems)
  }
}
