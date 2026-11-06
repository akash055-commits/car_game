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
export const EYES = ['#5a3a22', '#3b2618', '#2f6f95', '#4f7a4a', '#7a6a3a', '#3b4a5a']
// Outfits for uniformed characters
export const OUTFITS = {
  police: { shirt: '#2c3e66', pants: '#1f2a44', shoes: '#151515', hat: '#1f2a44', vest: '#1a2238', belt: '#121212' },
  army: { shirt: '#5d6b45', pants: '#4f5b3a', shoes: '#3a3020', hat: '#4f5b3a', vest: '#454f35', belt: '#2a2a1e' },
  gang: { shirt: '#7a1f2a', pants: '#1f1f22', shoes: '#f2f0ea', hat: '#7a1f2a', vest: '#2a2626', belt: '#121212' },
}
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

// Mitten hand with a thumb (side: +1 left, -1 right)
function hand(side) {
  return mergeGeometries([
    new THREE.SphereGeometry(0.05, 10, 8).scale(0.85, 1.2, 0.62).translate(0, -0.04, 0),
    new THREE.CapsuleGeometry(0.014, 0.035, 3, 6).rotateZ(side * 0.7).rotateX(-0.4).translate(side * 0.035, -0.025, 0.022),
  ])
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
    blinkEvery: rnd.range(2.2, 5.5), glasses: o.glasses ?? false, belt: o.belt ?? false, weapon: o.weapon ?? null,
    aim: 0, aimPitch: 0, punch: 0, cower: 0, handsUp: 0, panic: 0, hit: 0, lieDir: 1, lieVar: rnd.random(), expr: null, mouthOpen: 0,
    carry: 0, item: o.item ?? ITEMS.none, hammer: 0, sweep: 0, wave: 0, cheer: 0, sit: 0, talk: 0,
    tumble: 0, lie: 0, spin: 0, hop: 0, look: 0, fist: 0, kneel: 0, drive: 0, ride: 0, air: 0, phone: 0, steer: 0, lean: 0, sprint: 0,
    colors: {
      skin,
      hair: o.hair ?? (kind === 'elder' ? rnd.pick(GREY) : rnd.pick(HAIR)),
      shirt: rnd.pick(SHIRTS), pants: rnd.pick(PANTS), shoes: rnd.pick(SHOES),
      hat: rnd.pick(['#d84b3a', '#2f8f95', '#3d4f7a', '#e8a33a', '#f2e3c6']),
      vest: '#ff8a1e',
      eyes: rnd.pick(EYES),
      belt: '#3b2a20',
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
      new THREE.SphereGeometry(0.026, 10, 8).scale(0.78, 1.25, 1.15).translate(0, -0.004, 0.127), // nose
      new THREE.SphereGeometry(0.017, 8, 6).scale(1.5, 0.8, 1).translate(0, -0.027, 0.13), // nose tip / nostrils
      new THREE.SphereGeometry(0.04, 10, 8).scale(1, 0.8, 0.6).translate(-0.06, -0.02, 0.095), // cheeks
      new THREE.SphereGeometry(0.04, 10, 8).scale(1, 0.8, 0.6).translate(0.06, -0.02, 0.095),
      new THREE.SphereGeometry(0.035, 10, 8).scale(1.2, 0.8, 0.9).translate(0, -0.11, 0.075), // chin
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
      iris: make(eyes(0.0145, 0.131), false),
      pupil: make(eyes(0.0075, 0.1365), false),
      glint: make(mergeGeometries([
        new THREE.SphereGeometry(0.0035, 6, 4).translate(-0.039, 0.168, 0.138),
        new THREE.SphereGeometry(0.0035, 6, 4).translate(0.047, 0.168, 0.138),
      ]), false),
      lids: make(eyes(0.025, 0.1285), false),
      browL: make(new THREE.BoxGeometry(0.05, 0.013, 0.016).translate(-0.045, 0.2, 0.124), false),
      browR: make(new THREE.BoxGeometry(0.05, 0.013, 0.016).translate(0.045, 0.2, 0.124), false),
      mouthIn: make(new THREE.SphereGeometry(0.024, 10, 6).scale(1.2, 0.7, 0.4).translate(0, 0.085, 0.118), false),
      lipUpper: make(new THREE.CapsuleGeometry(0.008, 0.044, 3, 8).rotateZ(Math.PI / 2).translate(0, 0.09, 0.126), false),
      lipLower: make(new THREE.CapsuleGeometry(0.0085, 0.04, 3, 8).rotateZ(Math.PI / 2).translate(0, 0.079, 0.124), false),
      glasses: make(mergeGeometries([
        new THREE.BoxGeometry(0.17, 0.042, 0.012).translate(0, 0.165, 0.142),
        new THREE.BoxGeometry(0.012, 0.012, 0.11).translate(-0.088, 0.17, 0.09),
        new THREE.BoxGeometry(0.012, 0.012, 0.11).translate(0.088, 0.17, 0.09),
      ]), false),
      belt: make(rbox(0.36, 0.06, 0.23, 0.02).translate(0, 0.06, 0)),
      hairShort: make(hairCap(0.135)),
      hairCurly: make(mergeGeometries([hairCap(0.145, 0.6), ...[-1, 0, 1].map((k) => new THREE.SphereGeometry(0.05, 8, 6).translate(k * 0.07, 0.3, 0.02))])),
      hairLong: make(mergeGeometries([hairCap(0.137, 0.6), new THREE.BoxGeometry(0.25, 0.3, 0.07).translate(0, 0.03, -0.095)])),
      hairBun: make(mergeGeometries([hairCap(0.136), new THREE.SphereGeometry(0.06, 10, 8).translate(0, 0.27, -0.09)])),
      hairPony: make(mergeGeometries([hairCap(0.136), new THREE.CylinderGeometry(0.035, 0.02, 0.24, 8).rotateX(0.35).translate(0, 0.08, -0.16)])),
      beard: make(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5).scale(1, 0.9, 0.9).translate(0, 0.08, 0.035)),
      hatCap: make(mergeGeometries([new THREE.SphereGeometry(0.142, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.17, 0), new THREE.BoxGeometry(0.2, 0.02, 0.14).translate(0, 0.18, 0.15)])),
      hatHard: make(mergeGeometries([new THREE.SphereGeometry(0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.17, 0), new THREE.CylinderGeometry(0.19, 0.19, 0.02, 16).translate(0, 0.175, 0.01)])),
      hatSun: make(mergeGeometries([new THREE.CylinderGeometry(0.11, 0.14, 0.12, 14).translate(0, 0.28, 0), new THREE.CylinderGeometry(0.28, 0.28, 0.015, 20).translate(0, 0.23, 0)])),
      hatPolice: make(mergeGeometries([new THREE.CylinderGeometry(0.15, 0.14, 0.09, 16).translate(0, 0.24, 0), new THREE.CylinderGeometry(0.17, 0.15, 0.035, 16).translate(0, 0.3, 0), new THREE.BoxGeometry(0.2, 0.015, 0.1).rotateX(0.25).translate(0, 0.205, 0.15)])),
      hatHelmet: make(mergeGeometries([new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1.08).translate(0, 0.17, 0), new THREE.CylinderGeometry(0.175, 0.18, 0.025, 16).translate(0, 0.17, 0)])),
      hatBeanie: make(mergeGeometries([new THREE.SphereGeometry(0.145, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.15, 1.06).translate(0, 0.16, -0.005), new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0.33, 0)])),
      upperArmL: make(rbox(0.11, 0.3, 0.11, 0.04).translate(0, -0.14, 0)),
      upperArmR: make(rbox(0.11, 0.3, 0.11, 0.04).translate(0, -0.14, 0)),
      foreArmL: make(rbox(0.095, 0.27, 0.095, 0.035).translate(0, -0.13, 0)),
      foreArmR: make(rbox(0.095, 0.27, 0.095, 0.035).translate(0, -0.13, 0)),
      handL: make(hand(1)),
      handR: make(hand(-1)),
      item: make(new THREE.BoxGeometry(1, 1, 1)),
      // held guns (drawn in the right hand)
      pistol: make(mergeGeometries([new THREE.BoxGeometry(0.035, 0.035, 0.17).translate(0, 0.02, 0.07), new THREE.BoxGeometry(0.03, 0.09, 0.04).rotateX(-0.25).translate(0, -0.025, 0.0)])),
      launcher: make(mergeGeometries([new THREE.CylinderGeometry(0.075, 0.075, 1.15, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0.06, 0.15), new THREE.CylinderGeometry(0.095, 0.075, 0.12, 12).rotateX(Math.PI / 2).translate(0, 0.06, 0.72), new THREE.BoxGeometry(0.035, 0.1, 0.04).translate(0, -0.03, 0.05), new THREE.BoxGeometry(0.03, 0.06, 0.08).translate(0, 0.16, 0.2)])),
      rifle: make(mergeGeometries([new THREE.BoxGeometry(0.045, 0.06, 0.55).translate(0, 0.03, 0.15), new THREE.BoxGeometry(0.02, 0.02, 0.3).translate(0, 0.05, 0.55), new THREE.BoxGeometry(0.035, 0.09, 0.04).rotateX(-0.3).translate(0, -0.03, 0.02), new THREE.BoxGeometry(0.035, 0.1, 0.03).translate(0, -0.035, 0.2), new THREE.BoxGeometry(0.05, 0.08, 0.2).translate(0, 0.01, -0.18)])),
    }
    this.hairPart = { short: 'hairShort', curly: 'hairCurly', long: 'hairLong', bun: 'hairBun', pony: 'hairPony' }
    this.hatPart = { cap: 'hatCap', hard: 'hatHard', sun: 'hatSun', police: 'hatPolice', helmet: 'hatHelmet', beanie: 'hatBeanie' }
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
    set('iris', C.eyes || '#5a3a22')
    set('pupil', '#120c0a')
    set('glint', '#ffffff')
    set('lids', C.skin)
    set('browL', C.hair)
    set('browR', C.hair)
    set('mouthIn', '#4a1c1c')
    set('lipUpper', '#a8584e')
    set('lipLower', '#b8645a')
    set('glasses', '#1a1a1e')
    set('belt', C.belt || '#3b2a20')
    set('pistol', '#2a2a2e')
    set('rifle', '#2f3330')
    set('launcher', '#4f5b3a')
    for (const h of Object.values(this.hairPart)) set(h, C.hair)
    set('beard', C.hair)
    set('hatCap', C.hat)
    set('hatHard', C.hat)
    set('hatSun', C.hat)
    set('hatPolice', C.hat)
    set('hatHelmet', C.hat)
    set('hatBeanie', C.hat)
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
    const moving = Math.min(1, walk + run)
    const aim = c.aim || 0, cower = c.cower || 0, handsUp = c.handsUp || 0, panic = c.panic || 0, hit = c.hit || 0
    // Gait: thigh swing, knee bend on the back-swing, arm swing with bent elbows.
    // Sprint: longer stride, higher heel kick, more bounce.
    const thighAmp = 0.48 * walk + 0.85 * run + 0.3 * sprint
    const kneeL = Math.max(0, Math.sin(ph + 1.3)) * (0.75 * walk + 1.5 * run + 0.55 * sprint)
    const kneeR = Math.max(0, Math.sin(ph + 1.3 + Math.PI)) * (0.75 * walk + 1.5 * run + 0.55 * sprint)
    const bob = Math.abs(Math.cos(ph)) * (0.035 * walk + 0.08 * run + 0.03 * sprint)
    const breath = Math.sin(t * 1.6 + c.breath) * 0.012
    const sit = Math.max(c.sit, c.drive, c.ride * 0.8)
    const kneel = Math.max(c.kneel, cower * 0.85)
    // standing still: slow weight shift from foot to foot
    const idle = (1 - moving) * (1 - sit) * (1 - kneel) * (1 - c.lie)
    const shift = Math.sin(t * 0.55 + c.breath) * idle
    const hipY = 0.97 - sit * 0.5 - kneel * 0.42 + bob + c.hop - c.air * 0.1

    // Root: heading plus tumble / lying (on the back or face down) / leaning (bike)
    const lie = c.lie
    const lieDir = c.lieDir || 1
    _q.setFromEuler(_e.set(-lie * Math.PI * 0.5 * lieDir + c.tumble * c.spin + (c.pitch || 0), c.heading + c.tumble * c.spin * 0.5, c.tumble * Math.sin(c.spin * 1.3) * 0.6 + c.lean + lie * (c.lieVar - 0.5) * 0.5, 'YXZ'))
    _root.compose(_v.set(c.x, c.y + lie * 0.15, c.z), _q, _s.setScalar(c.scale))

    // Pelvis: forward twist, hip roll and a little side-to-side sway
    const lean = run * 0.22 + sprint * 0.2 + c.carry * 0.06 + c.hammer * 0.25 + c.sweep * 0.12 + kneel * 0.15 + c.ride * 0.35 + c.hunch * 0.6 + cower * 0.35 + panic * 0.1 - hit * 0.3 + aim * 0.06
    const twist = Math.sin(ph) * (walk * 0.1 + run * 0.15 + sprint * 0.08) + Math.sin(t * 3 + ph) * c.sweep * 0.25
    const roll = Math.sin(ph) * (walk * 0.06 + run * 0.035) + shift * 0.05
    const sway = Math.cos(ph) * walk * 0.02 + shift * 0.03
    // Joints are unscaled; body width only scales the hip / chest meshes (heads stay round)
    const w = c.width
    _pelvis.multiplyMatrices(_root, local(_l, sway, hipY, 0, 0, twist * 0.5, roll))
    this.set('hips', c, _mesh.multiplyMatrices(_pelvis, local(_l, 0, 0, 0, 0, 0, 0, w, 1, w)))
    this.set('belt', c, c.belt ? _mesh : ZERO)

    // Legs (heel strike with toes up, push off with toes down)
    const gait = Math.min(1, walk + run) * (1 - sit) * (1 - kneel)
    for (const [side, sx, knee, sign] of [['L', -0.095, kneeL, 1], ['R', 0.095, kneeR, -1]]) {
      let thigh = -s * thighAmp * sign
      let kn = knee
      if (sit > 0) { thigh = thigh * (1 - sit) - 1.5 * sit; kn = kn * (1 - sit) + 1.45 * sit }
      if (c.ride > 0.3) { thigh -= 0.25 * c.ride; kn += 0.4 * c.ride }
      if (kneel > 0.05) { thigh = -1.3 * kneel * (side === 'L' ? 1 : 0.2); kn = (side === 'L' ? 1.4 : 1.5) * kneel }
      if (c.air > 0.3) { thigh -= 0.6 * c.air; kn += 1.0 * c.air }
      if (lie > 0.5) {
        // fallen: one knee drawn up, depending on how they landed
        if ((side === 'L') === c.lieVar > 0.5) { thigh -= 0.6 * lie; kn += 1.0 * lie }
        else kn += 0.15 * lie
      }
      // idle: weight on one leg, the other knee slightly relaxed
      if (idle > 0.1) kn += Math.max(0, shift * (side === 'L' ? 1 : -1)) * 0.18
      const spread = c.ride > 0 ? sign * -0.25 * c.ride : lie * sign * -0.12
      _j1.multiplyMatrices(_pelvis, local(_l, sx * w, -0.04, 0, thigh, 0, spread))
      this.set('thigh' + side, c, _j1)
      _j2.multiplyMatrices(_j1, local(_l, 0, -0.45, 0, kn))
      this.set('shin' + side, c, _j2)
      let foot = -kn * 0.25 - thigh * 0.2 * (1 - sit)
      if (gait > 0.05 && c.air < 0.3) foot = foot * (1 - gait) + (-(thigh + kn) * 0.92 + thigh * 0.55) * gait
      _j3.multiplyMatrices(_j2, local(_l, 0, -0.44, 0, foot))
      this.set('foot' + side, c, _j3)
    }
    if (c.skirt) {
      _j1.multiplyMatrices(_pelvis, local(_l, 0, 0.02, 0, -sit * 0.9, 0, 0, 1, 1 - sit * 0.3, 1))
      this.set('skirt', c, _j1)
    } else this.set('skirt', c, ZERO)

    // Chest (spine): shoulders counter-rotate against the hips, with breathing
    _chest.multiplyMatrices(_pelvis, local(_l, 0, 0.07, 0, lean, -twist * 1.5, -roll * 0.7))
    _mesh.multiplyMatrices(_chest, local(_l, 0, 0, 0, 0, 0, 0, w, 1 + breath, w > 1.1 ? w * 1.12 : w))
    this.set('chest', c, _mesh)
    this.set('vest', c, c.vest ? _mesh : ZERO)

    // Neck + head: keeps facing forward while walking, looks around when idle, nods when talking
    const look = c.look + Math.sin(t * 0.7 + ph) * 0.12 * (1 - walk - run) + twist * 1.0
    const nod = (c.talk > 0 ? Math.sin(t * 6 + ph) * 0.1 : 0) - c.hunch * 0.3 - lean * 0.6 + c.phone * 0.4 - aim * (c.aimPitch || 0) * 0.5 + cower * 0.5
    _j1.multiplyMatrices(_chest, local(_l, 0, 0.52, 0))
    this.set('neck', c, _j1)
    const hs = kid ? 1.22 : 1
    _head.multiplyMatrices(_j1, local(_l, 0, 0.06, 0.005, nod, look, 0, hs, hs, hs))
    this.set('head', c, _head)

    // ---- Face: eyes + blinking lids, expressive brows and lips
    let ex = c.expr
    if (!ex) ex = c.fist > 0.3 || c.punch > 0.1 ? 'angry' : panic > 0.3 || cower > 0.3 || handsUp > 0.3 ? 'scared' : lie > 0.5 || c.tumble > 0.3 || hit > 0.2 ? 'hurt' : c.wave > 0.3 || c.cheer > 0.3 ? 'happy' : aim > 0.5 ? 'focus' : 'neutral'
    this.set('eyeWhite', c, _head)
    this.set('iris', c, _head)
    this.set('pupil', c, _head)
    this.set('glint', c, _head)
    const blink = lie > 0.6 || ((t + c.breath * 3) % c.blinkEvery) < 0.13
    const lidOpen = ex === 'scared' ? 0.12 : ex === 'angry' || ex === 'focus' ? 0.5 : ex === 'hurt' ? 0.6 : ex === 'happy' ? 0.45 : 0.33
    const lid = blink ? 1.06 : lidOpen
    const EYE_TOP = 0.19
    _mesh.multiplyMatrices(_head, local(_l, 0, EYE_TOP, 0))
    _mesh.multiply(local(_l, 0, 0, 0, 0, 0, 0, 1, lid, 1))
    _mesh.multiply(local(_l, 0, -EYE_TOP, 0))
    this.set('lids', c, _mesh)
    const BR = { neutral: [0, 0.12], angry: [-0.008, -0.38], focus: [-0.004, -0.18], scared: [0.016, 0.3], hurt: [0.005, 0.4], happy: [0.007, 0.05] }[ex] || [0, 0.12]
    for (const [part, bx, sign] of [['browL', -0.045, 1], ['browR', 0.045, -1]]) {
      _mesh.multiplyMatrices(_head, local(_l, bx, 0.2 + BR[0], 0.124, 0, 0, BR[1] * sign))
      _mesh.multiply(local(_l, -bx, -0.2, -0.124))
      this.set(part, c, _mesh)
    }
    let open = c.mouthOpen || 0
    if (c.talk > 0.3) open = Math.max(open, 0.25 + 0.25 * Math.sin(t * 13 + ph))
    if (ex === 'scared') open = Math.max(open, 0.6)
    else if (ex === 'angry' && c.fist > 0.3) open = Math.max(open, 0.35 + 0.25 * Math.sin(t * 9))
    else if (ex === 'hurt') open = Math.max(open, lie > 0.5 ? 0.15 : 0.4)
    const wide = ex === 'happy' ? 1.25 : ex === 'angry' ? 0.9 : 1
    _mesh.multiplyMatrices(_head, local(_l, 0, 0.085, 0.12, 0, 0, 0, wide, 0.15 + open * 1.3, 1))
    _mesh.multiply(local(_l, 0, -0.085, -0.12))
    this.set('mouthIn', c, _mesh)
    _mesh.multiplyMatrices(_head, local(_l, 0, open * 0.004 + (ex === 'happy' ? 0.002 : 0), 0, 0, 0, 0, 1, 1, 1))
    _mesh.multiply(local(_l, 0, 0.09, 0.126))
    _mesh.multiply(local(_l, 0, 0, 0, 0, 0, 0, wide, 1, 1))
    _mesh.multiply(local(_l, 0, -0.09, -0.126))
    this.set('lipUpper', c, _mesh)
    _mesh.multiplyMatrices(_head, local(_l, 0, -open * 0.02, 0))
    _mesh.multiply(local(_l, 0, 0.079, 0.124))
    _mesh.multiply(local(_l, 0, 0, 0, 0, 0, 0, wide, 1, 1))
    _mesh.multiply(local(_l, 0, -0.079, -0.124))
    this.set('lipLower', c, _mesh)
    this.set('glasses', c, c.glasses ? _head : ZERO)
    this.set('beard', c, c.beard ? _head : ZERO)
    const covered = c.hat === 'hard' || c.hat === 'helmet' || c.hat === 'police' || c.hat === 'beanie'
    for (const [style, part] of Object.entries(this.hairPart)) this.set(part, c, c.hairStyle === style && (!covered || style === 'long' || style === 'pony') ? _head : ZERO)
    for (const [hat, part] of Object.entries(this.hatPart)) this.set(part, c, c.hat === hat ? _head : ZERO)

    // Arms: [upper X swing, upper Z out, elbow bend]
    // a[1] > 0 swings the right arm outwards, < 0 the left arm outwards
    // walking: elbows bend more on the forward swing; sprinting: big pumping arm swing
    const fwdL = Math.max(0, s), fwdR = Math.max(0, -s)
    let L = [s * (0.45 * walk + 0.8 * run + 0.45 * sprint), -0.08 - shift * 0.03, -(0.25 * walk + 1.3 * run + 0.25 * sprint + 0.12 + fwdL * 0.3 * walk)]
    let R = [-s * (0.45 * walk + 0.8 * run + 0.45 * sprint), 0.08 - shift * 0.03, -(0.25 * walk + 1.3 * run + 0.25 * sprint + 0.12 + fwdR * 0.3 * walk)]
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
    if (panic > 0.3) { L = [-1.3 + Math.sin(t * 13 + ph) * 0.5, -0.55, -0.9]; R = [-1.3 + Math.cos(t * 13 + ph) * 0.5, 0.55, -0.9] }
    if (cower > 0.3) { L = [-2.5, -0.55, -1.9]; R = [-2.5, 0.55, -1.9] }
    if (handsUp > 0.3) { L = [-0.3, -2.25, -1.1]; R = [-0.3, 2.25, -1.1] }
    if (c.lie > 0.5) {
      if (c.lieVar < 0.33) { L = [0, -1.3 - Math.sin(t * 2) * 0.05, -0.2]; R = [0, 1.15, -0.35] }
      else if (c.lieVar < 0.66) { L = [-2.9, -0.35, -0.2]; R = [0.1, 0.25, -0.15] }
      else { L = [0.15, -0.35, -1.4]; R = [-0.4, 0.6, -0.4] }
    }
    if (c.tumble > 0.3) { L = [Math.sin(t * 20), -2.2, -0.5]; R = [Math.cos(t * 20), 2.2, -0.5] }
    if (c.fist > 0.3) R = [-2.7 + Math.sin(t * 14) * 0.25, 0.2, -1.3]
    if (c.air > 0.3) { L = [-0.4, -1.0, -0.6]; R = [-0.4, 1.0, -0.6] }
    const pitchA = c.aimPitch || 0
    if (aim > 0.3) {
      if (c.weapon === 'rifle' || c.weapon === 'shotgun' || c.weapon === 'sniper' || c.weapon === 'rocket') { R = [-1.25 - pitchA, -0.35, -1.25]; L = [-1.5 - pitchA, 0.3, -0.35] }
      else { R = [-1.52 - pitchA, -0.18, -0.08]; L = [-1.45 - pitchA, 0.38, -0.42] }
    }
    if (c.punch > 0.05) {
      const k = Math.sin(Math.min(1, c.punch) * Math.PI)
      R = [-0.9 - k * 0.75, -0.15, -1.9 + k * 1.8]
      L = [-1.0, 0.25, -1.9]
    }
    if (hit > 0.2) { L[0] += hit * 0.6; R[0] += hit * 0.6; L[1] -= hit * 0.4; R[1] += hit * 0.4 }

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

    // Guns: drawn while aiming (police, gang members, the player)
    const showGun = c.weapon && (aim > 0.2 || c.holdGun) && c.lie < 0.5
    const held = showGun ? (c.weapon === 'pistol' || c.weapon === 'smg' ? 'pistol' : c.weapon === 'rocket' ? 'launcher' : 'rifle') : null
    for (const part of ['pistol', 'rifle', 'launcher']) {
      if (part !== held) { this.set(part, c, ZERO); continue }
      _j1.multiplyMatrices(this._handR, local(_l, 0, part === 'pistol' ? -0.07 : -0.06, part === 'pistol' ? 0.015 : 0.02, Math.PI / 2, 0, 0))
      this.set(part, c, _j1)
    }
    if (c.trackHands) (c.handMatrix ||= new THREE.Matrix4()).copy(this._handR)

    // Item
    const it = ITEM_LOOK[c.item]
    if (it && !showGun && (c.carry > 0.3 || c.item === ITEMS.broom || c.item === ITEMS.phone)) {
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
