// Wanted level (0-5 stars). Crimes add "heat"; the police remember where they last saw
// you. Break line of sight and get out of the search area for long enough and they give
// up. A fresh coat of paint at a Spray & Fix (while no officer is watching) also works.
export const CRIMES = {
  shots: 0.34, // firing a gun where people can see
  assault: 0.45, // punching someone
  downed: 1.0, // shooting / running someone down
  carjack: 0.75,
  wreck: 0.8, // destroying a car
  explosion: 0.9,
  copHit: 0.5, // shooting at or ramming the police
  copDowned: 2.0,
  copCar: 1.2, // stealing a police car
  military: 2.0, // taking the tank out of Fort Granite
}

export class Wanted {
  constructor() {
    this.heat = 0
    this.level = 0
    this.lastSeen = null // { x, z }
    this.unseen = 0 // seconds since a cop last saw you
    this.searching = false
    this.listeners = {}
    this.cool = 0
  }

  on(n, fn) {
    ;(this.listeners[n] ||= []).push(fn)
  }

  emit(n, ...a) {
    for (const fn of this.listeners[n] || []) fn(...a)
  }

  get searchRadius() {
    return 70 + this.level * 40
  }

  // witnessed: someone (or a cop) saw it happen
  crime(kind, pos, witnessed = true) {
    if (!witnessed) return
    const before = this.level
    this.heat = Math.min(5.99, this.heat + (CRIMES[kind] ?? 0.5))
    if (kind === 'military') this.heat = Math.max(this.heat, 3)
    this.level = Math.min(5, Math.floor(this.heat + 0.001))
    this.lastSeen = { x: pos.x, z: pos.z }
    this.unseen = 0
    if (this.level > before) this.emit('level', this.level, before)
  }

  // a cop has eyes on you
  seen(pos) {
    if (this.level === 0) return
    this.lastSeen = { x: pos.x, z: pos.z }
    this.unseen = 0
    if (this.searching) {
      this.searching = false
      this.emit('spotted')
    }
  }

  clear(reason = 'lost') {
    if (this.level === 0) return
    const before = this.level
    this.heat = 0
    this.level = 0
    this.searching = false
    this.lastSeen = null
    this.emit('cleared', reason, before)
  }

  update(dt, playerPos) {
    if (this.level === 0) return
    this.unseen += dt
    this.searching = this.unseen > 2.5
    const out = !this.lastSeen || Math.hypot(playerPos.x - this.lastSeen.x, playerPos.z - this.lastSeen.z) > this.searchRadius
    // evading: unseen, outside the search circle, for long enough
    const need = 6 + this.level * 3
    if (this.searching && out && this.unseen > need) this.clear('lost')
    // while they search, the heat slowly fades back to the current star level
    this.heat = Math.max(this.level, this.heat - dt * 0.05)
  }
}
