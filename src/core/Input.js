// Unified input: keyboard + touch (TouchControls writes into the same state).

export class Input {
  constructor() {
    this.keys = new Set()
    // Analog values in [-1, 1] / [0, 1] written by touch controls
    this.touch = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, active: false }
    this.listeners = {}
    this.enabled = true

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
      if (!this.keys.has(e.code)) this.emit('press', e.code)
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
  }

  on(name, fn) {
    ;(this.listeners[name] ||= []).push(fn)
  }

  emit(name, ...args) {
    for (const fn of this.listeners[name] || []) fn(...args)
  }

  has(...codes) {
    return codes.some((c) => this.keys.has(c))
  }

  // Walking intent (camera-relative): x = strafe right, y = forward
  get foot() {
    if (!this.enabled) return { x: 0, y: 0, sprint: false, jump: false }
    const t = this.touch
    const y = (this.has('KeyW', 'ArrowUp', 'KeyZ') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0) + (t.moveY || 0)
    const x = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft', 'KeyQ') ? 1 : 0) + (t.moveX || 0)
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), sprint: this.has('ShiftLeft', 'ShiftRight') || t.boost, jump: this.has('Space') || t.jump }
  }

  // Helicopter: Space/Shift collective, W/S pitch, A/D yaw, Q/E bank (strafe)
  get heli() {
    if (!this.enabled) return { collective: 0, pitch: 0, bank: 0, yaw: 0 }
    const t = this.touch
    const k = (a, b) => (this.has(...a) ? 1 : 0) - (this.has(...b) ? 1 : 0)
    return {
      collective: Math.max(-1, Math.min(1, k(['Space'], ['ShiftLeft', 'ShiftRight']) + (t.up ? 1 : 0) - (t.down ? 1 : 0))),
      pitch: Math.max(-1, Math.min(1, k(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) + (t.moveY || 0))),
      yaw: Math.max(-1, Math.min(1, k(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) - (t.moveX || 0))),
      bank: k(['KeyE'], ['KeyQ']),
    }
  }

  // Driving intent, merged from keyboard and touch
  get state() {
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false }
    const up = this.has('KeyW', 'ArrowUp', 'KeyZ') ? 1 : 0
    const down = this.has('KeyS', 'ArrowDown') ? 1 : 0
    const left = this.has('KeyA', 'ArrowLeft', 'KeyQ') ? 1 : 0
    const right = this.has('KeyD', 'ArrowRight') ? 1 : 0
    const t = this.touch
    return {
      throttle: Math.max(up, t.throttle),
      brake: Math.max(down, t.brake),
      steer: Math.max(-1, Math.min(1, left - right + t.steer)),
      handbrake: this.has('Space') || t.handbrake,
      boost: this.has('ShiftLeft', 'ShiftRight') || t.boost,
    }
  }
}
