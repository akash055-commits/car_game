// Pickups scattered around the valley: health packs (by hospitals and clinics), body
// armour (police stations, the fort), ammo crates (gun shops, the fort, back streets),
// rocket ammo (fort armory) and nitro canisters (highways). They respawn after a while.
import * as THREE from 'three'
import { U } from '../world/Uniforms.js'
import { RING } from '../world/Regions.js'

const LOOK = {
  health: { color: 0xf8f6f0, glow: new THREE.Color(3, 0.6, 0.5), label: 'Health' },
  armor: { color: 0x2f5fd0, glow: new THREE.Color(0.6, 1.2, 3.5), label: 'Body armour' },
  ammo: { color: 0x5d6b45, glow: new THREE.Color(2.8, 2.2, 0.6), label: 'Ammo' },
  rocket: { color: 0x4f5b3a, glow: new THREE.Color(3.2, 1.2, 0.4), label: 'Rockets' },
  nitro: { color: 0x2f7bff, glow: new THREE.Color(0.8, 1.6, 4.0), label: 'Nitro' },
}

function model(kind) {
  const g = new THREE.Group()
  const L = LOOK[kind]
  const mat = new THREE.MeshStandardMaterial({ color: L.color, roughness: 0.5, emissive: L.color, emissiveIntensity: 0.25 })
  const add = (geo, m = mat, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    g.add(mesh)
    return mesh
  }
  if (kind === 'health') {
    add(new THREE.BoxGeometry(0.6, 0.45, 0.25))
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.25, 0.2) })
    add(new THREE.BoxGeometry(0.34, 0.1, 0.27), red)
    add(new THREE.BoxGeometry(0.1, 0.34, 0.27), red)
  } else if (kind === 'armor') {
    add(new THREE.BoxGeometry(0.55, 0.65, 0.2))
    add(new THREE.BoxGeometry(0.2, 0.25, 0.22), mat, 0, 0.42, 0)
  } else if (kind === 'ammo') {
    add(new THREE.BoxGeometry(0.62, 0.36, 0.36))
    add(new THREE.BoxGeometry(0.64, 0.07, 0.38), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 0.4) }))
  } else if (kind === 'rocket') {
    add(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 10).rotateZ(Math.PI / 2))
    add(new THREE.ConeGeometry(0.09, 0.22, 10).rotateZ(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.0, 0.3) }), 0.56, 0, 0)
  } else {
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.62, 14))
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0xc9c2b8, metalness: 0.8, roughness: 0.3 }), 0, 0.38, 0)
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: L.glow, transparent: true, opacity: 0.7, depthWrite: false }))
  ring.position.y = -0.85
  g.add(ring)
  g.userData.spin = g.children[0]
  return g
}

export class Pickups {
  constructor(scene, layout, town) {
    this.scene = scene
    this.layout = layout
    this.items = []
    this.listeners = {}
    const front = (p, k = 3) => ({ x: p.door.x + Math.sin(p.rot ?? 0) * k, z: p.door.z + Math.cos(p.rot ?? 0) * k })
    for (const h of town.hospitals) this.add('health', front(h, 4))
    for (const p of town.policeStations) this.add('armor', front(p, 4))
    for (const s of town.gunShops) { this.add('ammo', front(s, 2.5)); this.add('armor', front(s, 5)) }
    const fort = town.fort
    if (fort) {
      this.add('rocket', { x: fort.armory.x, z: fort.armory.z })
      this.add('rocket', { x: fort.armory.x + 3, z: fort.armory.z })
      this.add('ammo', { x: fort.armory.x - 3, z: fort.armory.z })
      this.add('armor', { x: fort.armory.x, z: fort.armory.z + 3 })
      this.add('health', { x: fort.helipad.x + 10, z: fort.helipad.z })
    }
    // back-street ammo and health around the towns
    const spots = town.places.filter((p) => p.kind === 'landmark')
    spots.forEach((p, i) => { if (i % 2 === 0) this.add(i % 4 === 0 ? 'health' : 'ammo', front(p, 2)) })
    // nitro canisters along the ring highway
    for (const [x, z] of [[RING.x0, 100], [RING.x0, -300], [0, RING.z0], [300, RING.z0], [RING.x1, -250], [200, RING.z1], [-250, RING.z1], [25, 240]]) this.add('nitro', { x, z })
  }

  on(n, fn) {
    ;(this.listeners[n] ||= []).push(fn)
  }

  emit(n, ...a) {
    for (const fn of this.listeners[n] || []) fn(...a)
  }

  add(kind, { x, z }) {
    const y = this.layout.getDriveHeight(x, z) + 0.9
    const mesh = model(kind)
    mesh.position.set(x, y, z)
    this.scene.add(mesh)
    this.items.push({ kind, x, y, z, mesh, active: true, timer: 0, phase: Math.random() * 6 })
  }

  // pos: player position; mode: 'foot' | vehicle type
  update(dt, t, pos, mode) {
    for (const it of this.items) {
      if (!it.active) {
        it.timer -= dt
        if (it.timer <= 0) {
          it.active = true
          it.mesh.visible = true
        }
        continue
      }
      // only animate the ones near the camera
      if ((it.x - pos.x) ** 2 + (it.z - pos.z) ** 2 > 140 * 140) continue
      it.mesh.userData.spin.parent.rotation.y = t * 1.6 + it.phase
      it.mesh.position.y = it.y + Math.sin(t * 2.2 + it.phase) * 0.12
      const r = mode === 'foot' ? 1.6 : 2.6
      if ((it.x - pos.x) ** 2 + (it.z - pos.z) ** 2 < r * r && Math.abs(it.y - 0.9 - pos.y) < 2.5) {
        const ok = it.kind === 'nitro' ? mode !== 'foot' && mode !== 'heli' : mode === 'foot' || mode === 'car' || mode === 'bike'
        if (!ok) continue
        it.active = false
        it.mesh.visible = false
        it.timer = it.kind === 'nitro' ? 25 : 50
        this.emit('collect', it.kind, it)
      }
    }
    void U
  }
}
