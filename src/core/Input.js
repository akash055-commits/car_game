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
