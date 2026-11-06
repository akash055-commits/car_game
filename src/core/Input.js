// Unified input: keyboard + touch (TouchControls writes into the same state).

export class Input {
  constructor() {
    this.keys = new Set()
    // Analog values in [-1, 1] / [0, 1] written by touch controls
    this.touch = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, active: false }
    this.listeners = {}
    this.enabled = true
    // Mouse: buttons held (0 left, 2 right) and the cursor in normalised device coords
    this.mouse = { 0: false, 1: false, 2: false }
    this.cursor = { x: 0, y: 0 }

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault()
      if (!this.keys.has(e.code)) this.emit('press', e.code)
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code)
      this.emit('release', e.code)
    })
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.mouse[0] = this.mouse[1] = this.mouse[2] = false
    })
  }

  // Mouse buttons + cursor on the game canvas
  attachMouse(dom) {
    dom.addEventListener('contextmenu', (e) => e.preventDefault())
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || !this.enabled) return
      this.mouse[e.button] = true
      this.emit('mousedown', e.button)
    })
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return
      if (this.mouse[e.button]) this.emit('mouseup', e.button)
      this.mouse[e.button] = false
    })
    window.addEventListener('pointermove', (e) => {
      const r = dom.getBoundingClientRect()
      this.cursor.x = ((e.clientX - r.left) / r.width) * 2 - 1
      this.cursor.y = -((e.clientY - r.top) / r.height) * 2 + 1
      if (document.pointerLockElement) this.emit('look', e.movementX, e.movementY)
    })
    dom.addEventListener('wheel', (e) => this.emit('wheel', Math.sign(e.deltaY)), { passive: true })
  }

  get fire() {
    return this.enabled && (this.mouse[0] || this.has('ControlLeft', 'ControlRight') || !!this.touch.fire)
  }

  get aimHeld() {
    return this.enabled && (this.mouse[2] || !!this.touch.aim)
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
    if (!this.enabled) return { x: 0, y: 0, sprint: false, run: false, jump: false }
    const t = this.touch
    const y = (this.has('KeyW', 'ArrowUp', 'KeyZ') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0) + (t.moveY || 0)
    const x = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft', 'KeyQ') ? 1 : 0) + (t.moveX || 0)
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), sprint: this.has('ShiftLeft', 'ShiftRight') || t.boost, run: !!t.run, jump: this.has('Space') || t.jump, aim: this.aimHeld }
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
      boost: this.has('ShiftLeft', 'ShiftRight', 'KeyX') || t.boost,
    }
  }
}
