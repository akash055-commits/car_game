// Instanced, procedurally animated people with a real joint hierarchy (hips → knees →
// feet, chest → shoulders → elbows → hands, neck → head) and readable faces. Every body
// part is one InstancedMesh shared by the whole crowd (~30 draw calls for 150+ people).
// A character is a plain object: transform + appearance + pose parameters.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { wettable } from '../world/Props.js'

export const SKIN = ['#f6dcc4', '#f1cfb0', '#e3b48e', '#c99266', '#a8714a', '#7d5236', '#5e3d29']
export const HAIR = ['#1f1612', '#3b2618', '#5a3a22', '#8c5a2c', '#c99a55', '#e2c98a', '#a63e22', '#4a4440']
export const GREY = ['#bdb7b0', '#d9d4ce', '#9a948e']
export const SHIRTS = ['#d84b3a', '#2f8f95', '#e8a33a', '#4a7bd0', '#5aa05a', '#e0568c', '#8a5bd0', '#f2e3c6', '#3d4f7a', '#c9dcc8', '#f08a4b', '#ffffff', '#2a2626', '#9fb1c4', '#b5553a', '#6b8f71']
export const PANTS = ['#3d4f7a', '#2a2626', '#6e4228', '#5b6b7a', '#8c7d70', '#2f5d62', '#4a3a5a', '#c9b48a', '#7a5a8a']
export const SHOES = ['#2a2020', '#4a3020', '#f2f0ea', '#6e4228', '#3d4f7a', '#d84b3a']
export const ITEMS = { none: 0, brick: 1, log: 2, stone: 3, parcel: 4, bag: 5, broom: 6, crate: 7, picket: 8, phone: 9 }
const ITEM_LOOK = {
  1: { size: [0.4, 0.18, 0.2], color: '#b5553a' },
  2: { size: [0.2, 0.2, 1.6], color: '#9a6a3e' },
  3: { size: [0.32, 0.24, 0.28], color: '#9b8f86' },
  4: { size: [0.4, 0.3, 0.34], color: '#c99a5e' },
  5: { size: [0.26, 0.32, 0.14], color: '#e8d6b0' },
  6: { size: [0.05, 1.25, 0.05], color: '#8c5a2c' },
  7: { size: [0.48, 0.38, 0.48], color: '#b07a46' },
  8: { size: [0.1, 0.95, 0.04], color: '#f8f1e4' },
  9: { size: [0.07, 0.13, 0.02], color: '#2a2626' },
}
const HAIR_STYLES = ['short', 'short', 'long', 'bun', 'bald', 'curly', 'pony']

const _root = new THREE.Matrix4()
const _pelvis = new THREE.Matrix4()
const _chest = new THREE.Matrix4()
const _mesh = new THREE.Matrix4()
const _head = new THREE.Matrix4()
const _j1 = new THREE.Matrix4()
const _j2 = new THREE.Matrix4()
const _j3 = new THREE.Matrix4()
const _l = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _s = new THREE.Vector3()
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)

function local(out, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'))
  return out.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz))
}

// Random appearance for a townsperson
export function makeCharacter(rnd, o = {}) {
  const kind = o.kind ?? (rnd.random() < 0.08 ? 'kid' : rnd.random() < 0.14 ? 'elder' : 'adult')
  const female = o.female ?? rnd.random() < 0.5
  const hairStyle = o.hairStyle ?? (kind === 'elder' && !female && rnd.random() < 0.5 ? 'bald'
    : female ? rnd.pick(['long', 'bun', 'pony', 'curly', 'short']) : rnd.pick(['short', 'short', 'curly', 'bald', 'short']))
  const skirt = o.skirt ?? (female && kind !== 'kid' && rnd.random() < 0.35)
  const shorts = o.shorts ?? (!skirt && rnd.random() < 0.15)
  const skin = o.skin ?? rnd.pick(SKIN)
  const c = {
    x: 0, y: 0, z: 0, heading: 0, visible: true, index: -1,
    kind, female,
    scale: o.scale ?? (kind === 'kid' ? rnd.range(0.58, 0.7) : kind === 'elder' ? rnd.range(0.92, 1.0) : rnd.range(0.94, 1.08)),
    width: o.width ?? (kind === 'kid' ? 0.95 : rnd.pick([0.9, 1, 1, 1.08, 1.2])),
    hunch: kind === 'elder' ? 0.22 : 0,
    hairStyle,
    hat: o.hat ?? (rnd.random() < 0.12 ? rnd.pick(['cap', 'sun']) : 'none'),
    beard: o.beard ?? (!female && kind === 'adult' && rnd.random() < 0.25),
    vest: o.vest ?? false,
    skirt, shorts,
    longSleeves: o.longSleeves ?? rnd.random() < 0.55,
    // pose
    walkPhase: rnd.random() * 6.28, walk: 0, run: 0, breath: rnd.random() * 6.28,
    carry: 0, item: o.item ?? ITEMS.none, hammer: 0, sweep: 0, wave: 0, cheer: 0, sit: 0, talk: 0,
    tumble: 0, lie: 0, spin: 0, hop: 0, look: 0, fist: 0, kneel: 0, drive: 0, ride: 0, air: 0, phone: 0, steer: 0, lean: 0, sprint: 0,
    colors: {
      skin,
      hair: o.hair ?? (kind === 'elder' ? rnd.pick(GREY) : rnd.pick(HAIR)),
      shirt: rnd.pick(SHIRTS), pants: rnd.pick(PANTS), shoes: rnd.pick(SHOES),
      hat: rnd.pick(['#d84b3a', '#2f8f95', '#3d4f7a', '#e8a33a', '#f2e3c6']),
      vest: '#ff8a1e',
      ...o.colors,
    },
    ...Object.fromEntries(Object.entries(o).filter(([k]) => !['colors', 'kind', 'female'].includes(k))),
  }
  return c
}

export class CrowdRig {
  constructor(scene, max) {
    this.max = max
    this.list = []
    this.focus = new THREE.Vector3()
    this.drawDistance = 120
    const mat = wettable(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 }))
    this.material = mat
    const make = (geo, shadow = true) => {
      const m = new THREE.InstancedMesh(geo, mat, max)
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.castShadow = shadow
      m.receiveShadow = true
      m.frustumCulled = false
      m.count = 0
      scene.add(m)
      return m
    }
    const rbox = (w, h, d, r = 0.04) => new RoundedBoxGeometry(w, h, d, 2, r)
    const head = mergeGeometries([
      new THREE.SphereGeometry(0.125, 18, 14).scale(1, 1.13, 1.06),
      new THREE.BoxGeometry(0.035, 0.05, 0.05).translate(0, -0.005, 0.13), // nose
      new THREE.SphereGeometry(0.03, 8, 6).scale(0.6, 1, 1).translate(-0.124, 0, 0), // ears
      new THREE.SphereGeometry(0.03, 8, 6).scale(0.6, 1, 1).translate(0.124, 0, 0),
      new THREE.SphereGeometry(0.085, 12, 8).scale(1, 0.75, 0.95).translate(0, -0.075, 0.03), // jaw
    ])
    head.translate(0, 0.14, 0)
    const eyes = (r, z) => mergeGeometries([
      new THREE.SphereGeometry(r, 10, 8).scale(1, 1.15, 0.55).translate(-0.043, 0.162, z),
      new THREE.SphereGeometry(r, 10, 8).scale(1, 1.15, 0.55).translate(0.043, 0.162, z),
    ])
    // Hair caps are tilted back so the hairline sits above the brows
    const hairCap = (r, phi = 0.56) => new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * phi).scale(1, 1.1, 1.08).rotateX(-0.5).translate(0, 0.155, -0.012)
    this.parts = {
      hips: make(rbox(0.34, 0.17, 0.21)),
      thighL: make(rbox(0.15, 0.45, 0.17, 0.05).translate(0, -0.225, 0)),
      thighR: make(rbox(0.15, 0.45, 0.17, 0.05).translate(0, -0.225, 0)),
      shinL: make(rbox(0.12, 0.44, 0.14, 0.045).translate(0, -0.22, 0)),
      shinR: make(rbox(0.12, 0.44, 0.14, 0.045).translate(0, -0.22, 0)),
      footL: make(rbox(0.13, 0.08, 0.26, 0.03).translate(0, -0.03, 0.05)),
      footR: make(rbox(0.13, 0.08, 0.26, 0.03).translate(0, -0.03, 0.05)),
      skirt: make(new THREE.CylinderGeometry(0.19, 0.3, 0.52, 14, 1, true).translate(0, -0.22, 0)),
      chest: make(rbox(0.42, 0.52, 0.23, 0.08).translate(0, 0.26, 0)),
      vest: make(rbox(0.45, 0.4, 0.26, 0.08).translate(0, 0.25, 0)),
      neck: make(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10).translate(0, 0.04, 0)),
      head: make(head),
      eyeWhite: make(eyes(0.022, 0.123), false),
      pupil: make(eyes(0.012, 0.134), false),
      brows: make(mergeGeometries([
        new THREE.BoxGeometry(0.05, 0.013, 0.016).rotateZ(0.12).translate(-0.045, 0.2, 0.124),
        new THREE.BoxGeometry(0.05, 0.013, 0.016).rotateZ(-0.12).translate(0.045, 0.2, 0.124),
      ]), false),
      mouth: make(new THREE.BoxGeometry(0.055, 0.014, 0.014).translate(0, 0.085, 0.127), false),
      hairShort: make(hairCap(0.135)),
      hairCurly: make(mergeGeometries([hairCap(0.145, 0.6), ...[-1, 0, 1].map((k) => new THREE.SphereGeometry(0.05, 8, 6).translate(k * 0.07, 0.3, 0.02))])),
      hairLong: make(mergeGeometries([hairCap(0.137, 0.6), new THREE.BoxGeometry(0.25, 0.3, 0.07).translate(0, 0.03, -0.095)])),
      hairBun: make(mergeGeometries([hairCap(0.136), new THREE.SphereGeometry(0.06, 10, 8).translate(0, 0.27, -0.09)])),
      hairPony: make(mergeGeometries([hairCap(0.136), new THREE.CylinderGeometry(0.035, 0.02, 0.24, 8).rotateX(0.35).translate(0, 0.08, -0.16)])),
      beard: make(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5).scale(1, 0.9, 0.9).translate(0, 0.08, 0.035)),
      hatCap: make(mergeGeometries([new THREE.SphereGeometry(0.142, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.17, 0), new THREE.BoxGeometry(0.2, 0.02, 0.14).translate(0, 0.18, 0.15)])),
      hatHard: make(mergeGeometries([new THREE.SphereGeometry(0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.17, 0), new THREE.CylinderGeometry(0.19, 0.19, 0.02, 16).translate(0, 0.175, 0.01)])),
      hatSun: make(mergeGeometries([new THREE.CylinderGeometry(0.11, 0.14, 0.12, 14).translate(0, 0.28, 0), new THREE.CylinderGeometry(0.28, 0.28, 0.015, 20).translate(0, 0.23, 0)])),
      upperArmL: make(rbox(0.11, 0.3, 0.11, 0.04).translate(0, -0.14, 0)),
      upperArmR: make(rbox(0.11, 0.3, 0.11, 0.04).translate(0, -0.14, 0)),
      foreArmL: make(rbox(0.095, 0.27, 0.095, 0.035).translate(0, -0.13, 0)),
      foreArmR: make(rbox(0.095, 0.27, 0.095, 0.035).translate(0, -0.13, 0)),
      handL: make(new THREE.SphereGeometry(0.052, 10, 8).scale(0.9, 1.15, 0.7).translate(0, -0.035, 0)),
      handR: make(new THREE.SphereGeometry(0.052, 10, 8).scale(0.9, 1.15, 0.7).translate(0, -0.035, 0)),
      item: make(new THREE.BoxGeometry(1, 1, 1)),
    }
    this.hairPart = { short: 'hairShort', curly: 'hairCurly', long: 'hairLong', bun: 'hairBun', pony: 'hairPony' }
    this.hatPart = { cap: 'hatCap', hard: 'hatHard', sun: 'hatSun' }
    this.col = new THREE.Color()
  }

  add(c) {
    c.index = this.list.length
    this.list.push(c)
    for (const p of Object.values(this.parts)) p.count = this.list.length
    this.applyColors(c)
    return c
  }

  applyColors(c) {
    const C = c.colors
    const set = (part, color) => this.parts[part].setColorAt(c.index, this.col.set(color))
    const bareLegs = c.skirt || c.shorts
    set('hips', c.skirt ? C.pants : C.pants)
    set('thighL', c.skirt ? C.skin : C.pants)
    set('thighR', c.skirt ? C.skin : C.pants)
    set('shinL', bareLegs ? C.skin : C.pants)
    set('shinR', bareLegs ? C.skin : C.pants)
    set('footL', C.shoes)
    set('footR', C.shoes)
    set('skirt', C.pants)
    set('chest', C.shirt)
    set('vest', C.vest)
    set('neck', C.skin)
    set('head', C.skin)
    set('eyeWhite', '#f8f6f0')
    set('pupil', '#2a1d16')
    set('brows', C.hair)
    set('mouth', '#9a4a42')
    for (const h of Object.values(this.hairPart)) set(h, C.hair)
    set('beard', C.hair)
    set('hatCap', C.hat)
    set('hatHard', C.hat)
    set('hatSun', C.hat)
    set('upperArmL', C.shirt)
    set('upperArmR', C.shirt)
    set('foreArmL', c.longSleeves ? C.shirt : C.skin)
    set('foreArmR', c.longSleeves ? C.shirt : C.skin)
    set('handL', C.skin)
    set('handR', C.skin)
    const look = ITEM_LOOK[c.item]
    set('item', look ? look.color : '#ffffff')
    for (const p of Object.values(this.parts)) if (p.instanceColor) p.instanceColor.needsUpdate = true
  }

  setItem(c, item) {
    if (c.item === item) return
    c.item = item
    const look = ITEM_LOOK[item]
    if (look) {
      this.parts.item.setColorAt(c.index, this.col.set(look.color))
      this.parts.item.instanceColor.needsUpdate = true
    }
  }

  hide(c) {
    for (const p of Object.values(this.parts)) p.setMatrixAt(c.index, ZERO)
  }

  set(part, c, m) {
    this.parts[part].setMatrixAt(c.index, m)
  }

  update(time) {
    const fx = this.focus.x, fz = this.focus.z
    const dd = this.drawDistance * this.drawDistance
    for (const c of this.list) {
      if (!c.visible || (c.x - fx) ** 2 + (c.z - fz) ** 2 > dd) {
        if (!c.hidden) {
          this.hide(c)
          c.hidden = true
        }
        continue
      }
      c.hidden = false
      this.pose(c, time)
    }
    for (const p of Object.values(this.parts)) p.instanceMatrix.needsUpdate = true
  }

  pose(c, t) {
    const ph = c.walkPhase
    const walk = c.walk, run = c.run, sprint = c.sprint || 0
    const kid = c.kind === 'kid'
    const s = Math.sin(ph)
    // Gait: thigh swing, knee bend on the back-swing, arm swing with bent elbows.
    // Sprint: longer stride, higher heel kick, more bounce.
    const thighAmp = 0.48 * walk + 0.85 * run + 0.3 * sprint
    const kneeL = Math.max(0, Math.sin(ph + 1.3)) * (0.75 * walk + 1.5 * run + 0.55 * sprint)
    const kneeR = Math.max(0, Math.sin(ph + 1.3 + Math.PI)) * (0.75 * walk + 1.5 * run + 0.55 * sprint)
    const bob = Math.abs(Math.cos(ph)) * (0.035 * walk + 0.08 * run + 0.03 * sprint)
    const breath = Math.sin(t * 1.6 + c.breath) * 0.012
    const sit = Math.max(c.sit, c.drive, c.ride * 0.8)
    const kneel = c.kneel
    const hipY = 0.97 - sit * 0.5 - kneel * 0.42 + bob + c.hop - c.air * 0.1

    // Root: heading plus tumble / lying / leaning (bike)
    const lie = c.lie
    _q.setFromEuler(_e.set(-lie * Math.PI * 0.5 + c.tumble * c.spin, c.heading + c.tumble * c.spin * 0.5, c.tumble * Math.sin(c.spin * 1.3) * 0.6 + c.lean, 'YXZ'))
    _root.compose(_v.set(c.x, c.y + lie * 0.15, c.z), _q, _s.setScalar(c.scale))

    // Pelvis
    const lean = run * 0.22 + sprint * 0.2 + c.carry * 0.06 + c.hammer * 0.25 + c.sweep * 0.12 + kneel * 0.15 + c.ride * 0.35 + c.hunch * 0.6
    const twist = Math.sin(ph) * (walk * 0.1 + run * 0.15 + sprint * 0.08) + Math.sin(t * 3 + ph) * c.sweep * 0.25
    // Joints are unscaled; body width only scales the hip / chest meshes (heads stay round)
    const w = c.width
    _pelvis.multiplyMatrices(_root, local(_l, 0, hipY, 0, 0, twist * 0.5, 0))
    this.set('hips', c, _mesh.multiplyMatrices(_pelvis, local(_l, 0, 0, 0, 0, 0, 0, w, 1, w)))

    // Legs
    for (const [side, sx, knee, sign] of [['L', -0.095, kneeL, 1], ['R', 0.095, kneeR, -1]]) {
      let thigh = -s * thighAmp * sign
      let kn = knee
      if (sit > 0) { thigh = thigh * (1 - sit) - 1.5 * sit; kn = kn * (1 - sit) + 1.45 * sit }
      if (c.ride > 0.3) { thigh -= 0.25 * c.ride; kn += 0.4 * c.ride }
      if (kneel > 0.05) { thigh = -1.3 * kneel * (side === 'L' ? 1 : 0.2); kn = (side === 'L' ? 1.4 : 1.5) * kneel }
      if (c.air > 0.3) { thigh -= 0.6 * c.air; kn += 1.0 * c.air }
      const spread = c.ride > 0 ? sign * -0.25 * c.ride : 0
      _j1.multiplyMatrices(_pelvis, local(_l, sx * w, -0.04, 0, thigh, 0, spread))
      this.set('thigh' + side, c, _j1)
      _j2.multiplyMatrices(_j1, local(_l, 0, -0.45, 0, kn))
      this.set('shin' + side, c, _j2)
      _j3.multiplyMatrices(_j2, local(_l, 0, -0.44, 0, -kn * 0.25 - thigh * 0.2 * (1 - sit)))
      this.set('foot' + side, c, _j3)
    }
    if (c.skirt) {
      _j1.multiplyMatrices(_pelvis, local(_l, 0, 0.02, 0, -sit * 0.9, 0, 0, 1, 1 - sit * 0.3, 1))
      this.set('skirt', c, _j1)
    } else this.set('skirt', c, ZERO)

    // Chest (spine) with breathing
    _chest.multiplyMatrices(_pelvis, local(_l, 0, 0.07, 0, lean, twist, 0))
    _mesh.multiplyMatrices(_chest, local(_l, 0, 0, 0, 0, 0, 0, w, 1 + breath, w > 1.1 ? w * 1.12 : w))
    this.set('chest', c, _mesh)
    this.set('vest', c, c.vest ? _mesh : ZERO)

    // Neck + head (look around, nod while talking)
    const look = c.look + Math.sin(t * 0.7 + ph) * 0.12 * (1 - walk - run)
    const nod = (c.talk > 0 ? Math.sin(t * 6 + ph) * 0.1 : 0) - c.hunch * 0.3 - lean * 0.6 + c.phone * 0.4
    _j1.multiplyMatrices(_chest, local(_l, 0, 0.52, 0))
    this.set('neck', c, _j1)
    const hs = kid ? 1.22 : 1
    _head.multiplyMatrices(_j1, local(_l, 0, 0.06, 0.005, nod, look, 0, hs, hs, hs))
    this.set('head', c, _head)
    this.set('eyeWhite', c, _head)
    this.set('pupil', c, _head)
    this.set('brows', c, _head)
    this.set('mouth', c, _head)
    this.set('beard', c, c.beard ? _head : ZERO)
    for (const [style, part] of Object.entries(this.hairPart)) this.set(part, c, c.hairStyle === style && c.hat !== 'hard' ? _head : ZERO)
    for (const [hat, part] of Object.entries(this.hatPart)) this.set(part, c, c.hat === hat ? _head : ZERO)

    // Arms: [upper X swing, upper Z out, elbow bend]
    // a[1] > 0 swings the right arm outwards, < 0 the left arm outwards
    // sprinting: big pumping arm swing with tightly bent elbows
    let L = [s * (0.45 * walk + 0.8 * run + 0.45 * sprint), -0.08, -(0.25 * walk + 1.3 * run + 0.25 * sprint + 0.12)]
    let R = [-s * (0.45 * walk + 0.8 * run + 0.45 * sprint), 0.08, -(0.25 * walk + 1.3 * run + 0.25 * sprint + 0.12)]
    if (c.carry > 0.3) {
      if (c.item === ITEMS.log) R = [-0.2, 2.8, -0.4]
      else { L = [-0.55, 0.25, -1.2]; R = [-0.55, -0.25, -1.2] }
      if (c.item === ITEMS.bag) { L = [s * 0.3 * walk, -0.12, -0.2]; R = [0.05, 0.18, -0.05] }
    }
    if (c.hammer > 0.3) R = [-1.6 + Math.sin(t * 9 + ph) * 0.7 * c.hammer, 0.15, -0.9 - Math.sin(t * 9 + ph) * 0.4]
    if (c.sweep > 0.3) { const k = Math.sin(t * 3 + ph) * 0.2; L = [-0.7 + k, 0.2, -0.6]; R = [-0.9 + k, -0.2, -0.3] }
    if (c.wave > 0.3) R = [0, 2.5 + Math.sin(t * 9) * 0.2, -0.6 + Math.sin(t * 9) * 0.5]
    if (c.cheer > 0.3) { const k = Math.sin(t * 9) * 0.2; L = [0, -2.6 - k, -0.3]; R = [0, 2.6 + k, -0.3] }
    if (c.talk > 0.3) R = [-0.4 + Math.sin(t * 4 + ph) * 0.25, 0.15, -1.1 + Math.sin(t * 5 + ph) * 0.3]
    if (c.phone > 0.3) R = [-0.3, -0.35, -2.3]
    if (sit > 0.5 && c.talk <= 0.3 && c.drive < 0.3 && c.ride < 0.3) { L = [-0.35, 0.15, -0.9]; R = [-0.35, -0.15, -0.9] }
    if (c.drive > 0.3) { L = [-1.0 + c.steer * 0.15, 0.25, -0.5]; R = [-1.0 - c.steer * 0.15, -0.25, -0.5] }
    if (c.ride > 0.3) { L = [-1.0, -0.25, -0.5 - c.steer * 0.25]; R = [-1.0, 0.25, -0.5 + c.steer * 0.25] }
    if (kneel > 0.3 && c.hammer <= 0.3) { L = [-0.9, 0.2, -0.6]; R = [-0.9, -0.2, -0.6] }
    if (c.lie > 0.5) { L = [0, -1.2 - Math.sin(t * 2) * 0.1, -0.2]; R = [0, 1.2, -0.2] }
    if (c.tumble > 0.3) { L = [Math.sin(t * 20), -2.2, -0.5]; R = [Math.cos(t * 20), 2.2, -0.5] }
    if (c.fist > 0.3) R = [-2.7 + Math.sin(t * 14) * 0.25, 0.2, -1.3]
    if (c.air > 0.3) { L = [-0.4, -1.0, -0.6]; R = [-0.4, 1.0, -0.6] }

    for (const [side, sx, a] of [['L', -0.255, L], ['R', 0.255, R]]) {
      _j1.multiplyMatrices(_chest, local(_l, sx * w, 0.47, 0, a[0], 0, a[1]))
      this.set('upperArm' + side, c, _j1)
      _j2.multiplyMatrices(_j1, local(_l, 0, -0.29, 0, a[2]))
      this.set('foreArm' + side, c, _j2)
      _j3.multiplyMatrices(_j2, local(_l, 0, -0.27, 0))
      this.set('hand' + side, c, _j3)
      if (side === 'R') this._handR = _j3.clone()
      if (side === 'L') this._handL = _j3.clone()
    }

    // Item
    const it = ITEM_LOOK[c.item]
    if (it && (c.carry > 0.3 || c.item === ITEMS.broom || c.item === ITEMS.phone)) {
      const [sx, sy, sz] = it.size
      if (c.item === ITEMS.broom) _j1.multiplyMatrices(this._handR, local(_l, 0, -0.1, 0.05, 1.2, 0, 0, sx, sy, sz))
      else if (c.item === ITEMS.phone) _j1.multiplyMatrices(this._handR, local(_l, 0, -0.06, 0.03, 0, 0, 0, sx, sy, sz))
      else if (c.item === ITEMS.log) _j1.multiplyMatrices(_chest, local(_l, 0.22, 0.62, 0.0, 0, 0, 0, sx, sy, sz))
      else if (c.item === ITEMS.bag) _j1.multiplyMatrices(this._handR, local(_l, 0, -0.2, 0, 0, 0, 0, sx, sy, sz))
      else _j1.multiplyMatrices(_chest, local(_l, 0, 0.2, 0.32, 0, 0, 0, sx, sy, sz))
      this.set('item', c, _j1)
    } else this.set('item', c, ZERO)
  }
}
