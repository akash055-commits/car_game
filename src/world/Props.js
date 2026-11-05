// Static and dynamic props: lanterns, start arch, bridge, cabin, pier, rocks, fences,
// ramps, and knockable crates / barrels / cones (physics-synced).
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
  constructor(scene, physics, layout) {
    this.scene = scene
    this.physics = physics
    this.layout = layout
    this.R = physics.RAPIER
    this.rnd = makeRandom(42)
    this.lanterns = [] // world positions of lantern lights
    this.windows = []

    this.mat = {
      wood: std(0xa86b3d, 0.85),
      woodDark: std(0x6e4228, 0.9),
      plank: std(0xb98552, 0.8),
      stone: std(0x9b8f86, 0.9),
      roof: std(0xb4473a, 0.7),
      iron: std(0x3b3532, 0.6, { metalness: 0.4 }),
      cream: std(0xf1e4cc, 0.7),
    }
    this.lanternGlass = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb25a, emissiveIntensity: 1.5, roughness: 0.4 })
    this.windowMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, emissive: 0xffb866, emissiveIntensity: 0.1, roughness: 0.2 })

    this.buildBridge()
    this.buildStartArch()
    this.buildCabin(-24, 16, 0.6)
    this.buildPier()
    this.buildRamps()
    this.buildLanterns()
    this.buildFences()
    this.buildRocks()
    this.buildBenches()
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
  buildBridge() {
    const L = this.layout
    const b = L.bridge
    const hw = WORLD.roadHalfWidth + 0.3
    const N = L.roadCount
    const plankGeo = new THREE.BoxGeometry(hw * 2, 0.12, 0.44)
    const count = b.halfSamples * 2 + 1
    const planks = shadowed(new THREE.InstancedMesh(plankGeo, this.mat.plank, count))
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3(1, 1, 1)
    const p = new THREE.Vector3()
    const rnd = this.rnd
    const color = new THREE.Color()
    let k = 0
    const railPosts = []
    for (let d = -b.halfSamples; d <= b.halfSamples; d++) {
      const i = (b.index + d + N) % N
      const i2 = (i + 1) % N
      const heading = Math.atan2(L.roadTX[i], L.roadTZ[i])
      const pitch = -Math.atan2(L.roadH[i2] - L.roadH[i], L.roadStep)
      q.setFromEuler(new THREE.Euler(pitch, heading, (rnd.random() - 0.5) * 0.02, 'YXZ'))
      m.compose(p.set(L.roadX[i], L.roadH[i] - 0.02, L.roadZ[i]), q, s.set(1, 1, 1))
      planks.setMatrixAt(k, m)
      planks.setColorAt(k, color.setHSL(0.07, 0.45, 0.42 + rnd.random() * 0.12))
      k++
      if (d % 4 === 0) railPosts.push(i)
    }
    this.scene.add(planks)

    // Stringers, posts, rails and railing colliders
    const postGeo = new THREE.BoxGeometry(0.16, 1.1, 0.16)
    const legGeo = new THREE.CylinderGeometry(0.16, 0.18, 1, 8)
    const railGeo = new THREE.BoxGeometry(0.1, 0.1, 1)
    const posts = shadowed(new THREE.InstancedMesh(postGeo, this.mat.woodDark, railPosts.length * 2))
    const legs = shadowed(new THREE.InstancedMesh(legGeo, this.mat.woodDark, railPosts.length * 2))
    const rails = shadowed(new THREE.InstancedMesh(railGeo, this.mat.wood, (railPosts.length - 1) * 4))
    let pi = 0, li = 0, ri = 0
    const prevTop = [null, null]
    for (let n = 0; n < railPosts.length; n++) {
      const i = railPosts[n]
      const nx = -L.roadTZ[i], nz = L.roadTX[i]
      for (let sIdx = 0; sIdx < 2; sIdx++) {
        const side = sIdx === 0 ? 1 : -1
        const x = L.roadX[i] + nx * side * (hw - 0.05), z = L.roadZ[i] + nz * side * (hw - 0.05)
        const y = L.roadH[i]
        m.compose(p.set(x, y + 0.5, z), q.identity(), s.set(1, 1, 1))
        posts.setMatrixAt(pi++, m)
        const ground = L.getHeight(x, z)
        const legH = Math.max(0.2, y - ground)
        m.compose(p.set(x, ground + legH / 2 - 0.1, z), q.identity(), s.set(1, legH + 0.2, 1))
        legs.setMatrixAt(li++, m)
        const top = new THREE.Vector3(x, y + 0.95, z)
        if (prevTop[sIdx]) {
          for (const dy of [0, -0.45]) {
            const a = prevTop[sIdx].clone().setY(prevTop[sIdx].y + dy), c = top.clone().setY(top.y + dy)
            const mid = a.clone().add(c).multiplyScalar(0.5)
            const len = a.distanceTo(c)
            q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), c.clone().sub(a).normalize())
            m.compose(mid, q, s.set(1, 1, len))
            rails.setMatrixAt(ri++, m)
          }
          // Railing collider along this span
          const mid = prevTop[sIdx].clone().add(top).multiplyScalar(0.5)
          const len = prevTop[sIdx].distanceTo(top)
          q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), top.clone().sub(prevTop[sIdx]).normalize())
          this.fixedBox(mid.x, mid.y - 0.35, mid.z, 0.12, 0.65, len / 2 + 0.05, q, { kind: 'prop', material: 'wood' })
        }
        prevTop[sIdx] = top
      }
    }
    rails.count = ri
    this.scene.add(posts, legs, rails)
    for (const d of [-b.halfSamples - 2, b.halfSamples + 2]) {
      const f = L.roadFrame(b.index + d)
      for (const side of [-1, 1]) this.addLanternAt(f.x - f.tz * side * (hw + 0.9), f.z + f.tx * side * (hw + 0.9), 1.6)
    }
  }

  // ------------------------------------------------------------- Start arch
  buildStartArch() {
    const f = this.layout.roadFrame(0)
    const nx = -f.tz, nz = f.tx
    const hw = WORLD.roadHalfWidth + 1.0
    const g = new THREE.Group()
    const postGeo = new THREE.CylinderGeometry(0.22, 0.28, 5.2, 8)
    for (const side of [-1, 1]) {
      const x = f.x + nx * side * hw, z = f.z + nz * side * hw
      const y = this.layout.getHeight(x, z)
      const post = shadowed(new THREE.Mesh(postGeo, this.mat.woodDark))
      post.position.set(x, y + 2.6, z)
      g.add(post)
      const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x, y + 2.6, z))
      this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cylinder(2.6, 0.28), body), { kind: 'prop', material: 'wood' })
      this.addLanternAt(x + f.tx * 0.6, z + f.tz * 0.6, 1.2, y + 3.2)
      this.layout.occupy(x, z, 1)
    }
    // banner with checker pattern
    const cv = document.createElement('canvas')
    cv.width = 512
    cv.height = 96
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#f4e7cf'
    ctx.fillRect(0, 0, 512, 96)
    for (let i = 0; i < 32; i++) for (let j = 0; j < 2; j++) {
      if ((i + j) % 2 === 0) { ctx.fillStyle = '#2a2626'; ctx.fillRect(i * 16, j * 16, 16, 16) }
    }
    ctx.fillStyle = '#2a2626'
    ctx.font = 'bold 44px Nunito, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('SEASONS VALLEY', 256, 80)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const banner = shadowed(new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.6, 1.0, 0.12), [this.mat.woodDark, this.mat.woodDark, this.mat.woodDark, this.mat.woodDark, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })]))
    const y = f.y + 4.7
    banner.position.set(f.x, y, f.z)
    banner.rotation.y = f.heading
    g.add(banner)
    this.scene.add(g)
  }

  // ------------------------------------------------------------- Cabin
  buildCabin(x, z, rot) {
    const y = this.layout.getHeight(x, z)
    const g = new THREE.Group()
    g.position.set(x, y, z)
    g.rotation.y = rot
    const walls = shadowed(new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.8, 4.2), this.mat.wood))
    walls.position.y = 1.4
    g.add(walls)
    // log lines
    for (let i = 0; i < 6; i++) {
      const log = shadowed(new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.08, 4.3), this.mat.woodDark), false)
      log.position.y = 0.3 + i * 0.45
      g.add(log)
    }
    const roofGeo = new THREE.BoxGeometry(6.0, 0.22, 3.0)
    for (const side of [-1, 1]) {
      const r = shadowed(new THREE.Mesh(roofGeo, this.mat.roof))
      r.position.set(0, 3.45, side * 1.15)
      r.rotation.x = side * 0.62
      g.add(r)
    }
    const gable = new THREE.Shape([new THREE.Vector2(-2.1, 0), new THREE.Vector2(2.1, 0), new THREE.Vector2(0, 1.55)])
    for (const side of [-1, 1]) {
      const gm = shadowed(new THREE.Mesh(new THREE.ShapeGeometry(gable), this.mat.wood))
      gm.position.set(side * 2.6, 2.8, 0)
      gm.rotation.y = Math.PI / 2
      g.add(gm)
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.08), this.mat.woodDark)
    door.position.set(0.8, 0.95, 2.12)
    g.add(door)
    for (const wx of [-1.4]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.06), this.windowMat)
      w.position.set(wx, 1.6, 2.12)
      g.add(w)
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.04), this.mat.cream)
      frame.position.set(wx, 1.6, 2.1)
      g.add(frame)
    }
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 1.0), this.windowMat)
    side.position.set(2.62, 1.6, 0)
    g.add(side)
    const chimney = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), this.mat.stone))
    chimney.position.set(-1.6, 3.9, -0.8)
    g.add(chimney)
    this.chimneyTop = new THREE.Vector3(-1.6, 4.8, -0.8).applyEuler(new THREE.Euler(0, rot, 0)).add(new THREE.Vector3(x, y, z))
    this.scene.add(g)
    const q = new THREE.Quaternion().setFromAxisAngle(UP, rot)
    this.fixedBox(x, y + 1.6, z, 2.7, 1.6, 2.2, q, { kind: 'prop', material: 'wood' })
    this.layout.occupy(x, z, 5)
    this.layout.clearGrass(x, z, 4.5)
    const porch = new THREE.Vector3(1.8, 0, 2.4).applyEuler(new THREE.Euler(0, rot, 0))
    this.addLanternAt(x + porch.x, z + porch.z, 1.1)
  }

  // ------------------------------------------------------------- Pier
  buildPier() {
    const L = this.layout
    const x0 = 2, z0 = 15, len = 11
    const ang = Math.PI // pointing south into the lake
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
    g.rotation.y = ang - Math.PI
    this.scene.add(g)
    const mid = new THREE.Vector3(0, deckY - 0.1, -len / 2).applyEuler(g.rotation).add(g.position)
    this.fixedBox(mid.x, mid.y, mid.z, 1.2, 0.08, len / 2, new THREE.Quaternion().setFromEuler(g.rotation), { kind: 'prop', material: 'wood' })
    this.addLanternAt(x0 + 1.4, z0 + 0.6, 1.1, L.getHeight(x0 + 1.4, z0 + 0.6))
  }

  // ------------------------------------------------------------- Ramps
  buildRamps() {
    const defs = [
      { x: 22, z: 20, heading: Math.PI / 2, len: 7, h: 1.7 },
      { x: -84, z: -60, heading: Math.PI * 0.25, len: 8, h: 2.1 },
      { x: -20, z: -14, heading: -Math.PI * 0.75, len: 6, h: 1.4 },
    ]
    this.ramps = []
    for (const d of defs) {
      const w = 4.2
      const y = this.layout.getHeight(d.x, d.z)
      // wedge: rises along +z
      const verts = [
        [-w / 2, 0, -d.len / 2], [w / 2, 0, -d.len / 2], [-w / 2, 0, d.len / 2], [w / 2, 0, d.len / 2],
        [-w / 2, d.h, d.len / 2], [w / 2, d.h, d.len / 2],
      ]
      const geo = new THREE.BufferGeometry()
      const tri = [
        [0, 2, 4], [1, 5, 3], // sides
        [0, 4, 5], [0, 5, 1], // slope
        [2, 3, 5], [2, 5, 4], // back
        [0, 1, 3], [0, 3, 2], // bottom
      ]
      const pos = []
      for (const t of tri) for (const i of t) pos.push(...verts[i])
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geo.computeVertexNormals()
      const ramp = shadowed(new THREE.Mesh(geo, this.mat.plank))
      ramp.position.set(d.x, y - 0.05, d.z)
      ramp.rotation.y = d.heading
      this.scene.add(ramp)
      // stripes on the slope
      const slope = Math.atan2(d.h, d.len)
      const slopeLen = Math.hypot(d.h, d.len)
      for (let i = 0; i < 5; i++) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.03, 0.16), i % 2 ? this.mat.cream : this.mat.woodDark)
        const t = (i + 0.5) / 5
        strip.position.set(0, d.h * t + 0.02, -d.len / 2 + d.len * t)
        strip.rotation.x = -slope
        ramp.add(strip)
      }
      void slopeLen
      const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(d.x, y - 0.05, d.z).setRotation(new THREE.Quaternion().setFromAxisAngle(UP, d.heading)))
      const hull = this.R.ColliderDesc.convexHull(new Float32Array(verts.flat()))
      this.physics.tag(this.physics.world.createCollider(hull.setFriction(0.9), body), { kind: 'prop', material: 'wood' })
      this.layout.occupy(d.x, d.z, d.len * 0.6)
      this.layout.clearGrass(d.x, d.z, d.len * 0.55, 0.8)
      // keep a landing zone clear of trees
      const lx = d.x + Math.sin(d.heading) * (d.len + 10), lz = d.z + Math.cos(d.heading) * (d.len + 10)
      this.layout.occupy(lx, lz, 9)
      this.ramps.push({ ...d, y, top: new THREE.Vector3(d.x + Math.sin(d.heading) * d.len * 0.5, y + d.h, d.z + Math.cos(d.heading) * d.len * 0.5) })
    }
  }

  // ------------------------------------------------------------- Lanterns
  addLanternAt(x, z, scale = 1, yOverride) {
    const y = yOverride ?? this.layout.getHeight(x, z)
    this.pendingLanterns = this.pendingLanterns || []
    this.pendingLanterns.push({ x, y, z, scale })
    this.layout.occupy(x, z, 0.6)
  }

  buildLanterns() {
    const L = this.layout
    const spacing = Math.round(26 / L.roadStep)
    const hw = WORLD.roadHalfWidth
    let side = 1
    for (let i = 20; i < L.roadCount - 10; i += spacing) {
      if (L.isOnBridge(i) || Math.abs(L.ringDelta(i, L.bridge.index)) < L.bridge.halfSamples + 10) continue
      const f = L.roadFrame(i)
      const x = f.x - f.tz * side * (hw + 1.4), z = f.z + f.tx * side * (hw + 1.4)
      this.addLanternAt(x, z, 1)
      side = -side
    }
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
  buildFences() {
    const L = this.layout
    const hw = WORLD.roadHalfWidth
    // Fence the outside of a few sweeping corners
    const runs = [[60, 150], [330, 420], [560, 640]]
    const segs = []
    for (const [a, b] of runs) {
      for (let i = a; i < b; i += 5) {
        const fa = L.roadFrame(i), fb = L.roadFrame(i + 5)
        // outside of corner: pick side with larger curvature
        const turn = fa.tx * fb.tz - fa.tz * fb.tx
        const side = turn > 0 ? -1 : 1
        const off = hw + 2.6
        const pa = new THREE.Vector3(fa.x - fa.tz * side * off, 0, fa.z + fa.tx * side * off)
        const pb = new THREE.Vector3(fb.x - fb.tz * side * off, 0, fb.z + fb.tx * side * off)
        if (L.isWater(pa.x, pa.z) || !L.isFree(pa.x, pa.z, 0.2, { roadMargin: 0.5 })) continue
        pa.y = L.getHeight(pa.x, pa.z)
        pb.y = L.getHeight(pb.x, pb.z)
        segs.push([pa, pb])
      }
    }
    const postGeo = new THREE.BoxGeometry(0.14, 1.0, 0.14)
    const railGeo = new THREE.BoxGeometry(0.06, 0.09, 1)
    const posts = shadowed(new THREE.InstancedMesh(postGeo, this.mat.woodDark, segs.length))
    const rails = shadowed(new THREE.InstancedMesh(railGeo, this.mat.wood, segs.length * 2))
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    segs.forEach(([a, b], i) => {
      m.compose(a.clone().setY(a.y + 0.45), q.identity(), s.set(1, 1, 1))
      posts.setMatrixAt(i, m)
      const dir = b.clone().sub(a)
      const len = dir.length()
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize())
      for (let r = 0; r < 2; r++) {
        const mid = a.clone().add(b).multiplyScalar(0.5)
        mid.y += 0.4 + r * 0.35
        m.compose(mid, q, s.set(1, 1, len))
        rails.setMatrixAt(i * 2 + r, m)
      }
      this.layout.occupy(a.x, a.z, 0.5)
      const mid = a.clone().add(b).multiplyScalar(0.5)
      this.fixedBox(mid.x, mid.y + 0.5, mid.z, 0.08, 0.5, len / 2, q, { kind: 'prop', material: 'wood' })
    })
    this.scene.add(posts, rails)
  }

  // ------------------------------------------------------------- Rocks
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
    while (rocks.length < 70 && tries < 4000) {
      tries++
      const x = rnd.range(-108, 108), z = rnd.range(-108, 108)
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
  buildBenches() {
    const spots = [[-6, 18, 0.2], [18, 16, -0.3], [-30, 8, 1.2]]
    for (const [x, z, r] of spots) {
      if (!this.layout.isFree(x, z, 1.2)) continue
      const y = this.layout.getHeight(x, z)
      const g = new THREE.Group()
      const seat = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.45), this.mat.wood))
      seat.position.y = 0.45
      const back = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.06), this.mat.wood))
      back.position.set(0, 0.75, -0.2)
      g.add(seat, back)
      for (const sx of [-0.75, 0.75]) {
        const leg = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.4), this.mat.iron))
        leg.position.set(sx, 0.22, 0)
        g.add(leg)
      }
      g.position.set(x, y, z)
      g.rotation.y = r
      this.scene.add(g)
      this.layout.occupy(x, z, 1.2)
      this.fixedBox(x, y + 0.45, z, 0.9, 0.45, 0.25, new THREE.Quaternion().setFromAxisAngle(UP, r))
    }
  }

  // ------------------------------------------------------------- Dynamic props
  buildDynamics() {
    const R = this.R
    const world = this.physics.world
    const crateSpots = []
    // Crate pyramid in the yard
    const cx = -34, cz = -30
    const yard = this.layout.getHeight(cx, cz)
    const size = 0.9
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 3 - row; i++) {
        for (let d = 0; d < 2; d++) {
          crateSpots.push([cx + (i - (2 - row) / 2) * (size + 0.02), yard + size / 2 + row * size + 0.01, cz + d * (size + 0.02)])
        }
      }
    }
    // Loose crates by the cabin and start
    crateSpots.push([-19, this.layout.getHeight(-19, 19) + 0.5, 19], [-18.5, this.layout.getHeight(-18.5, 20.2) + 0.5, 20.2], [-18.7, this.layout.getHeight(-18.7, 19.6) + 1.4, 19.6])
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

    // Barrels around the yard
    const barrelSpots = [[-28, -32], [-27.2, -33.2], [-39, -27], [-38.5, -25.8], [-40, -26.6], [-31, -21]]
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

    // Cone slalom on the north meadow
    const cones = []
    for (let i = 0; i < 9; i++) cones.push([-8 + i * 3.6, 27 + (i % 2) * 1.2])
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
    const spots = [[-20, 20.5], [-21, 21.2], [-19.4, 21.6], [-5, 36], [6, 35.5], [-26, 11], [12, 24]]
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
    while (flowers.length < 900 && tries < 20000) {
      tries++
      const cxp = rnd.range(-95, 95), czp = rnd.range(-95, 95)
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
