// The airport: runway / taxiway / apron surfaces with painted markings, edge lights,
// terminal, control tower with a rotating beacon, hangars with parked aircraft,
// helipad and a windsock that follows the wind.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { AIRPORT } from './Layout.js'
import { U, noiseGLSL } from './Uniforms.js'
import { Batch, prism } from './Town.js'
import { wettable } from './Props.js'
import { makeAirliner, makePropPlane, animateLights } from '../aviation/PlaneModel.js'

const A = AIRPORT

function tarmacMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uWet: U.uWet, uAsphalt: U.uAsphalt })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind;\nvarying float vKind;\nvarying vec3 vW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvKind = aKind;\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vKind;
varying vec3 vW;
uniform float uWet;
uniform vec3 uAsphalt;
${noiseGLSL}
float tWet;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 p = vW.xz;
  vec3 col = uAsphalt * 0.92 * (0.9 + fbm2(p * 0.6) * 0.15 + (hash12(floor(p * 7.0)) - 0.5) * 0.05);
  col *= 0.95 + 0.08 * step(0.6, fbm2(p * 0.05));
  vec3 white = vec3(0.93, 0.92, 0.88);
  vec3 yellow = vec3(0.95, 0.75, 0.2);
  float m = 0.0; vec3 mc = white;
  if (vKind < 0.5) {
    // runway: along x, across z
    float u = p.x, v = p.y - ${A.runwayZ.toFixed(1)};
    float av = abs(v), au = abs(u);
    m = max(m, step(av, 0.45) * step(fract(u / 30.0), 0.6) * step(au, 170.0));
    m = max(m, step(abs(av - 14.0), 0.45));
    m = max(m, step(183.0, au) * step(au, 196.0) * step(fract((v + 15.0) / 2.4), 0.55) * step(av, 12.0));
    m = max(m, step(abs(au - 150.0), 10.0) * step(abs(av - 6.0), 1.0));
    m = max(m, step(abs(au - 125.0), 12.0) * step(abs(av - 8.5), 2.0));
    m = max(m, step(abs(au - 175.0), 0.6) * step(av, 14.0));
  } else if (vKind < 1.5) {
    float v = p.y - ${A.taxiZ.toFixed(1)};
    m = max(step(abs(v), 0.18), step(abs(abs(v) - 6.3), 0.12));
    mc = yellow;
  } else if (vKind < 2.5) {
    // apron: lead-in lines + stand boxes
    for (int i = 0; i < 3; i++) {
      float sx = ${A.stands[0].toFixed(1)} + float(i) * ${(A.stands[1] - A.stands[0]).toFixed(1)};
      m = max(m, step(abs(p.x - sx), 0.15) * step(p.y, ${(A.standZ + 8).toFixed(1)}));
      m = max(m, step(abs(p.y - ${(A.standZ + 8).toFixed(1)}), 0.15) * step(abs(p.x - sx), 2.5));
    }
    m = max(m, step(abs(p.y - ${(A.apron.z0 + 1.2).toFixed(1)}), 0.15));
    // helipad
    vec2 hp = p - vec2(${A.helipad.x.toFixed(1)}, ${A.helipad.z.toFixed(1)});
    float hr = length(hp);
    float H = (step(abs(hp.x - 1.6), 0.35) + step(abs(hp.x + 1.6), 0.35)) * step(abs(hp.y), 2.4) + step(abs(hp.y), 0.35) * step(abs(hp.x), 1.6);
    m = max(m, max(step(abs(hr - 6.0), 0.3), min(H, 1.0)));
    mc = (hr < 7.0) ? white : yellow;
  } else {
    float v = p.x - floor((p.x + 100.0) / 185.0) * 185.0;
    m = step(abs(p.x - ${A.connectors[0].toFixed(1)}), 0.18) + step(abs(p.x - ${A.connectors[1].toFixed(1)}), 0.18) + step(abs(p.x - ${A.connectors[2].toFixed(1)}), 0.18);
    m = min(m, 1.0);
    mc = yellow;
  }
  col = mix(col, mc, m * (0.8 + 0.2 * vnoise(p * 2.0)));
  tWet = uWet;
  col *= 1.0 - uWet * 0.3;
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.25, tWet);')
  }
  return mat
}

export class Airport {
  constructor(scene, physics, layout, town) {
    this.scene = scene
    this.physics = physics
    this.layout = layout
    this.R = physics.RAPIER
    this.buildSurfaces()
    this.buildBuildings()
    this.buildLights()
    this.buildStaticPlanes()
    town.places.push({ name: 'Airport', kind: 'landmark', x: (A.terminal.x0 + A.terminal.x1) / 2, z: A.terminal.z1, door: { x: (A.terminal.x0 + A.terminal.x1) / 2, z: -203 }, rot: 0, street: 'Airport Road' })
    this.lampSpots = []
  }

  rectGeo(x0, z0, x1, z1, kind, y) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.ceil((x1 - x0) / 20), Math.ceil((z1 - z0) / 20)).rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (x0 + x1) / 2, z = pos.getZ(i) + (z0 + z1) / 2
      pos.setXYZ(i, x, this.layout.getHeight(x, z) + y, z)
    }
    g.computeVertexNormals()
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Array(pos.count).fill(kind), 1))
    this.layout.clearGrassRect(x0 - 1, z0 - 1, x1 + 1, z1 + 1)
    return g
  }

  buildSurfaces() {
    const rz = A.runwayZ, rw = A.runwayHalfWidth, rl = A.runwayHalfLen
    const geos = [
      this.rectGeo(-rl, rz - rw, rl, rz + rw, 0, 0.05),
      this.rectGeo(A.connectors[0] - 7, A.taxiZ - 7, A.connectors[2] + 7, A.taxiZ + 7, 1, 0.055),
      this.rectGeo(A.apron.x0, A.apron.z0, A.apron.x1, A.apron.z1, 2, 0.06),
    ]
    for (const cx of A.connectors) geos.push(this.rectGeo(cx - 7, rz + rw, cx + 7, A.taxiZ - 7, 3, 0.052))
    // hangar aprons
    for (const hx of A.hangars) geos.push(this.rectGeo(hx - 22, A.taxiZ + 7, hx + 22, A.hangarZ + 14, 2, 0.058))
    const mesh = new THREE.Mesh(mergeGeometries(geos), tarmacMaterial())
    mesh.receiveShadow = true
    this.scene.add(mesh)
    // runway numbers
    const cv = document.createElement('canvas')
    cv.width = 256
    cv.height = 128
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#ecebe5'
    ctx.font = 'bold 110px Nunito, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('09', 64, 68)
    ctx.fillText('27', 192, 68)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const numMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false })
    for (const [x, rot, u0] of [[-165, -Math.PI / 2, 0], [165, Math.PI / 2, 0.5]]) {
      const g = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2)
      const uv = g.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * 0.5)
      const m = new THREE.Mesh(g, numMat)
      m.rotation.y = rot
      m.position.set(x, this.layout.getHeight(x, rz) + 0.08, rz)
      this.scene.add(m)
    }
  }

  box(batch, x, y, z, sx, sy, sz, color, lit = 0, ry = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz))
    batch.add(new THREE.BoxGeometry(1, 1, 1), m, color, lit)
  }

  fixed(x, y, z, hx, hy, hz, material = 'stone') {
    const b = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x, y, z))
    this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz), b), { kind: 'building', material })
  }

  buildBuildings() {
    const L = this.layout
    const solid = new Batch()
    const glass = new Batch()
    const t = A.terminal
    const tx = (t.x0 + t.x1) / 2, tz = (t.z0 + t.z1) / 2, tw = t.x1 - t.x0, td = t.z1 - t.z0
    const ty = L.getHeight(tx, tz)
    // Terminal: long glass hall with a wavy roof
    this.box(solid, tx, ty + 3, tz, tw, 7.5, td, '#e9e4da')
    for (const side of [1, -1]) this.box(glass, tx, ty + 3.6, tz + side * (td / 2 + 0.05), tw - 2, 5.2, 0.1, '#47606e', 1)
    for (let i = 0; i < 9; i++) this.box(solid, t.x0 + 1 + i * ((tw - 2) / 8), ty + 3.6, t.z1 + 0.15, 0.35, 5.4, 0.3, '#f8f5ee')
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(t.x0 + 6 + i * 12, ty + 7.4, tz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.12)), new THREE.Vector3(1, 1, 1))
      solid.add(new THREE.CylinderGeometry(7, 7, 12.6, 20, 1, false, -0.5, 1.0).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.28, 1), m, '#c9d3d8')
    }
    this.box(solid, tx, ty + 8.4, t.z1 + 0.5, 14, 1.6, 0.4, '#2f3a44')
    this.signText = { x: tx, y: ty + 8.4, z: t.z1 + 0.72 }
    this.fixed(tx, ty + 4, tz, tw / 2, 4.5, td / 2)
    L.occupy(tx, tz, tw / 2)
    // jet bridges to the stands
    for (const sx of A.stands) {
      this.box(solid, sx, ty + 4.2, t.z0 - 3.5, 2.6, 2.6, 7, '#d8d4cc')
      this.box(solid, sx, ty + 1.5, t.z0 - 6.5, 0.6, 3, 0.6, '#9aa0a6')
    }
    // Control tower
    const tw2 = A.tower
    const tgy = L.getHeight(tw2.x, tw2.z)
    solid.add(new THREE.CylinderGeometry(2.2, 2.8, 26, 16), new THREE.Matrix4().makeTranslation(tw2.x, tgy + 13, tw2.z), '#e9e4da')
    solid.add(new THREE.CylinderGeometry(4.2, 3.2, 1.2, 16), new THREE.Matrix4().makeTranslation(tw2.x, tgy + 26.4, tw2.z), '#e9e4da')
    glass.add(new THREE.CylinderGeometry(4.0, 4.2, 3.4, 16), new THREE.Matrix4().makeTranslation(tw2.x, tgy + 28.7, tw2.z), '#3c5a68', 1)
    solid.add(new THREE.CylinderGeometry(4.6, 4.2, 0.6, 16), new THREE.Matrix4().makeTranslation(tw2.x, tgy + 30.7, tw2.z), '#d84b3a')
    solid.add(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), new THREE.Matrix4().makeTranslation(tw2.x, tgy + 32.5, tw2.z), '#3b3532')
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1, 0.3) }))
    this.beacon.position.set(tw2.x, tgy + 34.1, tw2.z)
    this.scene.add(this.beacon)
    const tb = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(tw2.x, tgy + 14, tw2.z))
    this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cylinder(15, 2.8), tb), { kind: 'building', material: 'stone' })
    L.occupy(tw2.x, tw2.z, 5)
    // Hangars: arched roofs, open to the taxiway
    this.hangarSpots = []
    for (const hx of A.hangars) {
      const hz = A.hangarZ, hy = L.getHeight(hx, hz)
      const w = 42, d = 30, h = 11
      const arch = new THREE.CylinderGeometry(w / 2, w / 2, d, 24, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)
      arch.scale(1, h / (w / 2), 1)
      const am = new THREE.Matrix4().compose(new THREE.Vector3(hx, hy + 1.5, hz), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1))
      solid.add(arch, am, '#9fb1bc')
      this.box(solid, hx, hy + 0.75, hz, w, 1.5, d, '#8a8580')
      // back wall
      this.box(solid, hx, hy + 6, hz + d / 2 - 0.2, w, 12, 0.4, '#b8c4cc')
      for (const side of [-1, 1]) {
        this.box(solid, hx + side * (w / 2 - 0.3), hy + 3, hz, 0.6, 6, d, '#8a8580')
        this.fixed(hx + side * (w / 2 - 0.3), hy + 4, hz, 0.4, 5, d / 2, 'metal')
      }
      this.fixed(hx, hy + 6, hz + d / 2, w / 2, 6, 0.4, 'metal')
      this.box(solid, hx, hy + h + 2.2, hz - d / 2 + 0.1, 16, 2, 0.3, '#2f3a44')
      L.occupy(hx, hz, 20)
      this.hangarSpots.push({ x: hx, z: hz - 2, y: hy })
    }
    // Windsock
    const wsx = A.connectors[1] + 30, wsz = A.taxiZ - 14
    const wsy = L.getHeight(wsx, wsz)
    solid.add(new THREE.CylinderGeometry(0.1, 0.12, 7, 8), new THREE.Matrix4().makeTranslation(wsx, wsy + 3.5, wsz), '#d8d4cc')
    const sock = new THREE.Group()
    sock.position.set(wsx, wsy + 6.8, wsz)
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - i * 0.07, 0.36 - i * 0.07, 0.75, 12, 1, true).rotateZ(Math.PI / 2).translate(0.4 + i * 0.75, 0, 0), new THREE.MeshStandardMaterial({ color: i % 2 ? '#f8f5ee' : '#ff7a2f', side: THREE.DoubleSide }))
      sock.add(seg)
    }
    this.scene.add(sock)
    this.sock = sock

    const mat = wettable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }))
    const sm = new THREE.Mesh(solid.build(), mat)
    sm.castShadow = sm.receiveShadow = true
    this.scene.add(sm)
    const gmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.3, emissive: 0xffffff })
    gmat.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = U.uNight
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(1.0, 0.82, 0.55) * (0.02 + uNight * 1.6);')
    }
    this.scene.add(new THREE.Mesh(glass.build(), gmat))
    // terminal sign
    const cv = document.createElement('canvas')
    cv.width = 512
    cv.height = 64
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#2f3a44'
    ctx.fillRect(0, 0, 512, 64)
    ctx.fillStyle = '#ffe7b8'
    ctx.font = 'bold 44px Nunito, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('SEASONS VALLEY AIRPORT', 256, 34)
    const st = new THREE.CanvasTexture(cv)
    st.colorSpace = THREE.SRGBColorSpace
    this.signMat = new THREE.MeshStandardMaterial({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 0.2 })
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(13.6, 1.4), this.signMat)
    sign.position.set(this.signText.x, this.signText.y, this.signText.z)
    this.scene.add(sign)
  }

  buildLights() {
    const pts = []
    const cols = []
    const rz = A.runwayZ, rw = A.runwayHalfWidth + 1, rl = A.runwayHalfLen
    for (let x = -rl; x <= rl; x += 25) for (const s of [-1, 1]) { pts.push([x, rz + s * rw]); cols.push([1, 0.95, 0.85]) }
    for (let k = -12; k <= 12; k += 3) { pts.push([-rl - 1, rz + k]); cols.push([0.3, 1, 0.4]); pts.push([rl + 1, rz + k]); cols.push([1, 0.3, 0.25]) }
    for (let x = A.connectors[0]; x <= A.connectors[2]; x += 20) for (const s of [-1, 1]) { pts.push([x, A.taxiZ + s * 7.6]); cols.push([0.3, 0.5, 1.4]) }
    for (let k = 1; k <= 6; k++) { pts.push([-rl - k * 12, rz]); cols.push([1, 1, 0.9]) }
    const geo = new THREE.BoxGeometry(0.3, 0.35, 0.3)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length)
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    pts.forEach(([x, z], i) => {
      m.makeTranslation(x, this.layout.getHeight(x, z) + 0.2, z)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.setRGB(...cols[i]))
    })
    this.edgeLights = mesh
    this.edgeBase = cols
    this.scene.add(mesh)
  }

  buildStaticPlanes() {
    this.statics = []
    const a = makeAirliner(3)
    a.group.position.set(A.hangars[1], this.hangarSpots[1].y + a.gearHeight, A.hangarZ + 1)
    a.group.rotation.y = Math.PI
    this.scene.add(a.group)
    const p = makePropPlane(2)
    p.group.position.set(A.hangars[0] - 6, this.hangarSpots[0].y + p.gearHeight, A.hangarZ)
    p.group.rotation.y = Math.PI + 0.4
    this.scene.add(p.group)
    const p2 = makePropPlane(0)
    p2.group.position.set(A.hangars[0] + 9, this.hangarSpots[0].y + p2.gearHeight, A.hangarZ + 3)
    p2.group.rotation.y = Math.PI - 0.3
    this.scene.add(p2.group)
    this.statics.push(a, p, p2)
    for (const s of this.statics) {
      const pos = s.group.position
      const b = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y - s.gearHeight * 0.4, pos.z))
      this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cuboid(s.kind === 'jet' ? 2.2 : 0.9, s.gearHeight * 0.6, s.length * 0.45), b), { kind: 'prop', material: 'metal' })
      for (const l of Object.values(s.lights)) l.visible = false
    }
  }

  update(t, night, windDir) {
    this.beacon.visible = (t % 1.6) < 0.8
    const pulse = 0.4 + night * 2.2
    this.edgeLights.material.color.setScalar(pulse)
    this.signMat.emissiveIntensity = 0.2 + night * 1.2
    if (this.sock) {
      this.sock.rotation.y = Math.atan2(-windDir.y, windDir.x)
      this.sock.rotation.z = -0.25 + Math.sin(t * 2.3) * 0.05
    }
    void animateLights
  }
}
