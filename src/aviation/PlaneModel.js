// Low-poly aircraft: a twin-jet airliner and a high-wing prop plane, each returned as a
// Group with handles for landing gear, propellers and blinking navigation lights.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const LIVERIES = [
  { body: '#f4f1ea', stripe: '#d84b3a', tail: '#d84b3a' },
  { body: '#f4f1ea', stripe: '#2f8f95', tail: '#2f8f95' },
  { body: '#f4f1ea', stripe: '#3d4f7a', tail: '#e8a33a' },
  { body: '#e9e4da', stripe: '#5aa05a', tail: '#3d4f7a' },
]

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, ...extra })
}

function shadowed(m) {
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export function makeAirliner(liveryIndex = 0) {
  const L = LIVERIES[liveryIndex % LIVERIES.length]
  const g = new THREE.Group()
  const body = mat(L.body)
  const stripe = mat(L.stripe)
  const tailMat = mat(L.tail)
  const dark = mat('#2a2f36', { roughness: 0.2, metalness: 0.4 })
  const grey = mat('#9aa0a6', { metalness: 0.5 })

  // Fuselage along +z (nose forward)
  const R = 1.9, len = 26
  const fus = new THREE.CylinderGeometry(R, R, len, 20, 1, true).rotateX(Math.PI / 2)
  const nose = new THREE.SphereGeometry(R, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 1.6).translate(0, 0, len / 2)
  const tail = new THREE.ConeGeometry(R, 7, 20, 1, true).rotateX(-Math.PI / 2).translate(0, 0.6, -len / 2 - 3.5)
  g.add(shadowed(new THREE.Mesh(mergeGeometries([fus, nose, tail]), body)))
  // cheat line + window band
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, len - 2, 20, 1, true, -0.55, 1.1).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), stripe))
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, len - 4, 20, 1, true, 0.15, 0.06).rotateX(Math.PI / 2).translate(0, 0, 0), dark))
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, len - 4, 20, 1, true, -0.21, 0.06).rotateX(Math.PI / 2).rotateY(Math.PI), dark))
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 0.9).translate(0, 0.75, len / 2 + 1.6), dark)
  cockpit.rotation.x = -0.35
  g.add(cockpit)

  // Wings (swept, tapered)
  const wingShape = new THREE.Shape([new THREE.Vector2(0, 2.6), new THREE.Vector2(15.5, -3.2), new THREE.Vector2(15.5, -4.6), new THREE.Vector2(0, -2.8)])
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.35, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, -0.9, 0)
  for (const s of [1, -1]) {
    const w = shadowed(new THREE.Mesh(wingGeo, body))
    w.scale.x = s
    w.rotation.z = s * 0.05
    g.add(w)
    // engine nacelle
    const eng = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.75, 3.6, 16, 1).rotateX(Math.PI / 2), grey))
    eng.position.set(s * 5.6, -1.9, 1.6)
    g.add(eng)
    const intake = new THREE.Mesh(new THREE.CircleGeometry(0.72, 16), dark)
    intake.position.set(s * 5.6, -1.9, 3.42)
    g.add(intake)
    // horizontal stabiliser
    const hs = shadowed(new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.22, 2.4).translate(s * 3.4, 0, 0), body))
    hs.position.set(0, 0.9, -len / 2 - 4.6)
    hs.rotation.y = s * -0.25
    g.add(hs)
  }
  // Vertical fin
  const finShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-4.6, 0), new THREE.Vector2(-6.6, 6.2), new THREE.Vector2(-4.4, 6.2)])
  const fin = shadowed(new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.3, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.15, 1.2, -len / 2 + 0.6), tailMat))
  g.add(fin)

  // Landing gear (retractable)
  const gear = new THREE.Group()
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 14).rotateZ(Math.PI / 2)
  const tyre = mat('#1e1e1e', { roughness: 0.9 })
  for (const [x, z] of [[0, len / 2 - 2], [2.6, -1.0], [-2.6, -1.0]]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.2, 8), grey)
    strut.position.set(x, -R - 0.9, z)
    gear.add(strut)
    for (const dx of [-0.35, 0.35]) {
      const w = new THREE.Mesh(wheelGeo, tyre)
      w.position.set(x + dx, -R - 2.0, z)
      w.castShadow = true
      gear.add(w)
    }
  }
  g.add(gear)

  // Navigation lights
  const lights = {
    red: new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) })),
    green: new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 4, 0.6) })),
    strobe: new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6) })),
    beacon: new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.4, 0.2) })),
  }
  lights.red.position.set(-15.5, -0.9, -3.9)
  lights.green.position.set(15.5, -0.9, -3.9)
  lights.strobe.position.set(0, 7.5, -len / 2 - 6)
  lights.beacon.position.set(0, R + 0.2, 0)
  for (const l of Object.values(lights)) g.add(l)

  return { group: g, gear, lights, props: [], gearHeight: R + 2.55, length: len + 10, kind: 'jet' }
}

export function makePropPlane(liveryIndex = 0) {
  const L = LIVERIES[(liveryIndex + 1) % LIVERIES.length]
  const g = new THREE.Group()
  const body = mat(L.body)
  const stripe = mat(L.stripe)
  const dark = mat('#2a2f36', { roughness: 0.2, metalness: 0.4 })
  const fus = new THREE.CylinderGeometry(0.75, 0.45, 7.5, 14).rotateX(Math.PI / 2)
  const nose = new THREE.SphereGeometry(0.75, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 3.75)
  g.add(shadowed(new THREE.Mesh(mergeGeometries([fus, nose]), body)))
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.18, 6.5).translate(0, -0.1, -0.3), stripe))
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1.6).translate(0, 0.55, 1.5), dark)
  g.add(canopy)
  const wing = shadowed(new THREE.Mesh(new THREE.BoxGeometry(11, 0.16, 1.6), body))
  wing.position.set(0, 0.85, 1.2)
  g.add(wing)
  for (const s of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), dark)
    strut.position.set(s * 1.6, 0.1, 1.2)
    strut.rotation.z = s * 0.75
    g.add(strut)
  }
  const hs = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 1.0), body))
  hs.position.set(0, 0.25, -3.6)
  g.add(hs)
  const fin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 1.2), stripe))
  fin.position.set(0, 0.95, -3.7)
  fin.rotation.x = -0.25
  g.add(fin)
  const prop = new THREE.Group()
  prop.position.set(0, 0, 4.55)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.0, 0.05), dark)
  const blade2 = blade.clone()
  blade2.rotation.z = Math.PI / 2
  prop.add(blade, blade2, new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 10).rotateX(Math.PI / 2), stripe))
  g.add(prop)
  const gear = new THREE.Group()
  const tyre = mat('#1e1e1e', { roughness: 0.9 })
  for (const [x, z] of [[0, 3.0], [1.1, 0.4], [-1.1, 0.4]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12).rotateZ(Math.PI / 2), tyre)
    w.position.set(x, -1.05, z)
    gear.add(w)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), dark)
    leg.position.set(x, -0.75, z)
    gear.add(leg)
  }
  g.add(gear)
  const lights = {
    red: new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) })),
    green: new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 4, 0.6) })),
    strobe: new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6) })),
    beacon: new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.4, 0.2) })),
  }
  lights.red.position.set(-5.5, 0.85, 1.2)
  lights.green.position.set(5.5, 0.85, 1.2)
  lights.strobe.position.set(0, 1.7, -4.1)
  lights.beacon.position.set(0, 0.8, -1)
  for (const l of Object.values(lights)) g.add(l)
  return { group: g, gear, lights, props: [prop], gearHeight: 1.35, length: 9, kind: 'prop' }
}

// Blink nav lights: steady red/green, strobe + beacon flashes
export function animateLights(model, t, offset = 0) {
  const k = (t + offset) % 1.2
  model.lights.strobe.visible = k < 0.06 || (k > 0.18 && k < 0.24)
  model.lights.beacon.visible = ((t + offset) % 1.0) < 0.12
}
