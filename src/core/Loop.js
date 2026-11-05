// Fixed-timestep simulation loop with render interpolation.
// Physics always advances in 1/60 s steps, so driving feels identical at 30, 60 or 144 fps.

export class Loop {
  constructor({ step = 1 / 60, maxSteps = 5 } = {}) {
    this.step = step
    this.maxSteps = maxSteps
    this.accumulator = 0
    this.elapsed = 0
    this.last = 0
    this.running = false
    this.onFixed = () => {}
    this.onFrame = () => {}
    this._tick = this._tick.bind(this)
  }

  start() {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    requestAnimationFrame(this._tick)
  }

  stop() {
    this.running = false
  }

  _tick(now) {
    if (!this.running) return
    requestAnimationFrame(this._tick)
    let dt = (now - this.last) / 1000
    this.last = now
    // Tab switches or long hitches should not cause a spiral of catch-up steps
    if (dt > 0.25) dt = 0.25
    if (dt < 0) dt = 0
    this.elapsed += dt
    this.accumulator += dt

    let steps = 0
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      this.onFixed(this.step)
      this.accumulator -= this.step
      steps++
    }
    if (steps === this.maxSteps) this.accumulator = 0

    const alpha = this.accumulator / this.step
    this.onFrame(dt, alpha, this.elapsed)
  }
}
