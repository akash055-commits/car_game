// Rapier wrapper: fixed-step world, event queue, and mesh <-> body syncing with interpolation.
import RAPIER from '@dimforge/rapier3d-compat'

export class Physics {
  constructor() {
    this.RAPIER = RAPIER
    this.world = null
    this.eventQueue = null
    this.dynamics = [] // { mesh, body, prev:{p,q}, curr:{p,q} }
    this.colliderTags = new Map() // collider handle -> { kind, material }
    this.onImpact = null // (force, tagA, tagB, point) => void
    this.onCollision = null // (handle1, handle2, started) => void
  }

  async init() {
    await RAPIER.init()
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = 1 / 60
    this.eventQueue = new RAPIER.EventQueue(true)
  }

  tag(collider, info) {
    this.colliderTags.set(collider.handle, info)
    return collider
  }

  getTag(handle) {
    return this.colliderTags.get(handle)
  }

  // Register a dynamic body whose transform should drive a mesh (or instanced slot)
  addDynamic(body, apply) {
    const t = body.translation()
    const r = body.rotation()
    const entry = {
      body,
      apply, // (position, quaternion) => void
      prev: { p: { ...t }, q: { x: r.x, y: r.y, z: r.z, w: r.w } },
      curr: { p: { ...t }, q: { x: r.x, y: r.y, z: r.z, w: r.w } },
      sleeping: false,
    }
    this.dynamics.push(entry)
    return entry
  }

  step(dt) {
    if (!this.world) return
    this.world.timestep = dt
    for (const d of this.dynamics) {
      d.prev.p.x = d.curr.p.x; d.prev.p.y = d.curr.p.y; d.prev.p.z = d.curr.p.z
      d.prev.q.x = d.curr.q.x; d.prev.q.y = d.curr.q.y; d.prev.q.z = d.curr.q.z; d.prev.q.w = d.curr.q.w
    }

    this.world.step(this.eventQueue)

    for (const d of this.dynamics) {
      d.sleeping = d.body.isSleeping()
      const t = d.body.translation()
      const r = d.body.rotation()
      d.curr.p.x = t.x; d.curr.p.y = t.y; d.curr.p.z = t.z
      d.curr.q.x = r.x; d.curr.q.y = r.y; d.curr.q.z = r.z; d.curr.q.w = r.w
    }

    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (this.onCollision) this.onCollision(h1, h2, started)
    })
    this.eventQueue.drainContactForceEvents((event) => {
      if (!this.onImpact) return
      const h1 = event.collider1()
      const h2 = event.collider2()
      this.onImpact(event.totalForceMagnitude(), h1, h2, event)
    })
  }

  // Interpolate visuals between the last two physics states
  sync(alpha) {
    for (const d of this.dynamics) {
      if (d.sleeping && d.synced) continue
      d.synced = true
      d.apply(d.prev, d.curr, alpha)
    }
  }
}
