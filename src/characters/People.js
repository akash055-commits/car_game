// Townspeople: walkers who path-find along sidewalks, wait at crosswalks, pop into shops,
// sit on benches and chat; shopkeepers who sweep and wave; joggers around the lake;
// market sellers; kids at the playground. Everyone dodges the car, and if bumped they
// tumble, lie dazed, get up dizzy and shake a fist (cartoon style, nobody gets hurt).
import { makeCharacter, ITEMS } from './Rig.js'
import { EMOTE } from './Emotes.js'
import { makeRandom, clamp, angleDelta, damp } from '../core/math.js'

// Shared reaction logic for every character (also used by builders and taxi fares)
export function updateReaction(c, dt, ctx) {
  const r = c.reaction
  if (r) {
    r.t += dt
    if (r.type === 'dodge') {
      const k = Math.min(1, r.t / 0.45)
      c.x += r.dx * 5 * dt * (1 - k * 0.5)
      c.z += r.dz * 5 * dt * (1 - k * 0.5)
      c.hop = Math.sin(k * Math.PI) * 0.4
      c.walk = 0
      c.run = 1
      c.walkPhase += dt * 14
      if (k >= 1) {
        c.hop = 0
        c.run = 0
        c.reaction = { type: 'recover', t: 0, d: 0.9 }
        if (Math.random() < 0.6) ctx.emotes.show(c, EMOTE.angry, 1.6)
        c.fist = 1
      }
      return true
    }
    if (r.type === 'knock') {
      if (r.phase === 'fly') {
        r.vy -= 14 * dt
        c.x += r.vx * dt
        c.z += r.vz * dt
        c.y += r.vy * dt
        c.spin += dt * 11
        c.tumble = 1
        const g = ctx.ground(c.x, c.z)
        if (c.y <= g && r.vy < 0) {
          c.y = g
          r.phase = 'lie'
          r.t = 0
          c.tumble = 0
          c.spin = 0
          c.lie = 1
          ctx.onVoice?.('oof', c.x, c.z)
        }
      } else if (r.phase === 'lie') {
        c.y = ctx.ground(c.x, c.z)
        if (r.t > 1.6) { r.phase = 'up'; r.t = 0 }
      } else if (r.phase === 'up') {
        c.lie = Math.max(0, 1 - r.t / 0.6)
        if (r.t > 0.6) {
          c.lie = 0
          r.phase = 'dizzy'
          r.t = 0
          ctx.emotes.show(c, EMOTE.dizzy, 2.2)
        }
      } else if (r.phase === 'dizzy') {
        c.heading += Math.sin(r.t * 6) * dt * 2
        c.look = Math.sin(r.t * 5) * 0.4
        if (r.t > 2.2) {
          r.phase = 'angry'
          r.t = 0
          c.fist = 1
          c.heading = Math.atan2(ctx.car.x - c.x, ctx.car.z - c.z)
          ctx.emotes.show(c, EMOTE.angry, 1.8)
          ctx.onVoice?.('angry', c.x, c.z)
        }
      } else if (r.phase === 'angry') {
        if (r.t > 1.6) {
          c.fist = 0
          c.look = 0
          c.reaction = null
        }
      }
      return true
    }
    if (r.type === 'recover') {
      c.walk = damp(c.walk, 0, 8, dt)
      if (r.t > r.d) {
        c.fist = 0
        c.reaction = null
      }
      return true
    }
  }
  if (c.noReact || !c.visible) return false

  // Threat detection against the player's car
  const car = ctx.car
  const dx = c.x - car.x, dz = c.z - car.z
  const d2 = dx * dx + dz * dz
  const speed = car.speed
  if (Math.abs(c.y - car.y) > 2.5 || d2 > 400) return false
  if (d2 < 1.9 * 1.9 && speed > 1.6) {
    // bumped: cartoon tumble
    const s = Math.min(speed, 18)
    c.reaction = { type: 'knock', phase: 'fly', t: 0, vx: car.vx * 0.55 + dx * 1.5, vz: car.vz * 0.55 + dz * 1.5, vy: 3 + s * 0.25 }
    c.sit = 0
    c.carry = 0
    c.walk = 0
    c.run = 0
    c.hammer = 0
    c.sweep = 0
    c.talk = 0
    c.wave = 0
    ctx.emotes.show(c, EMOTE.alarm, 0.8)
    ctx.onVoice?.('yelp', c.x, c.z)
    ctx.onKnock?.(c)
    if (c.onKnocked) c.onKnocked()
    return true
  }
  if (speed > 3 && c.sit < 0.5) {
    const t = (-dx * car.vx - dz * car.vz) / (speed * speed) // time until closest approach (negative dx: towards)
    const ahead = (dx * car.vx + dz * car.vz) / speed
    const lateral = (dx * car.vz - dz * car.vx) / speed
    if (ahead > 0 && ahead < 3 + speed * 0.55 && Math.abs(lateral) < 2.3) {
      void t
      const side = lateral >= 0 ? 1 : -1
      c.reaction = { type: 'dodge', t: 0, dx: (car.vz / speed) * side, dz: (-car.vx / speed) * side }
      c.heading = Math.atan2(-car.vx, -car.vz)
      c.carry = 0
      c.hammer = 0
      ctx.emotes.show(c, EMOTE.alarm, 1.0)
      ctx.onVoice?.('hey', c.x, c.z)
      return true
    }
  }
  return false
}

// Move a character towards a point; returns true when arrived
export function walkTo(c, tx, tz, speed, dt, ctx, arrive = 0.35) {
  const dx = tx - c.x, dz = tz - c.z
  const d = Math.hypot(dx, dz)
  if (d < arrive) {
    c.walk = damp(c.walk, 0, 10, dt)
    c.run = damp(c.run, 0, 10, dt)
    return true
  }
  const step = Math.min(d, speed * dt)
  c.x += (dx / d) * step
  c.z += (dz / d) * step
  const target = Math.atan2(dx, dz)
  c.heading += angleDelta(c.heading, target) * Math.min(1, dt * 10)
  const running = speed > 2.4
  c.walk = damp(c.walk, running ? 0 : 1, 8, dt)
  c.run = damp(c.run, running ? 1 : 0, 8, dt)
  c.walkPhase += dt * speed * (running ? 3.1 : 4.6)
  c.y = ctx.ground(c.x, c.z)
  return false
}

export class People {
  constructor(rig, layout, town, props, quality) {
    this.rig = rig
    this.layout = layout
    this.town = town
    this.rnd = makeRandom(77)
    this.walkers = []
    this.others = []
    this.benchTaken = new Set()
    const nodes = layout.walk.nodes
    const rnd = this.rnd

    const count = quality.name === 'low' ? 55 : 110
    for (let i = 0; i < count; i++) {
      const n = nodes[Math.floor(rnd.random() * nodes.length)]
      const c = rig.add(makeCharacter(rnd))
      c.role = 'walker'
      c.x = n.x + rnd.range(-1, 1)
      c.z = n.z + rnd.range(-1, 1)
      c.y = layout.getDriveHeight(c.x, c.z)
      c.node = n.id
      c.lane = rnd.range(-0.7, 0.7)
      c.speed = rnd.range(1.15, 1.55)
      c.state = 'think'
      c.timer = rnd.range(0, 3)
      if (rnd.random() < 0.25) {
        c.item = ITEMS.bag
        c.carry = 1
        rig.applyColors(c)
      }
      this.walkers.push(c)
    }

    // Shopkeepers in front of their shops
    for (const s of town.shops.slice(0, 12)) {
      const c = rig.add(makeCharacter(rnd, { colors: { shirt: '#f8f1e4' } }))
      c.role = 'keeper'
      const out = 0.6
      c.home = { x: s.door.x + Math.sin(s.rot) * out, z: s.door.z + Math.cos(s.rot) * out, rot: s.rot }
      c.x = c.home.x
      c.z = c.home.z
      c.y = layout.getDriveHeight(c.x, c.z)
      c.heading = s.rot
      c.item = ITEMS.broom
      rig.applyColors(c)
      c.timer = rnd.range(2, 8)
      c.state = 'sweep'
      this.others.push(c)
    }

    // Joggers around the lake
    const loop = town.joggingLoop
    if (loop) {
      for (let i = 0; i < 4; i++) {
        const c = rig.add(makeCharacter(rnd, { colors: { shirt: rnd.pick(['#e0568c', '#4a7bd0', '#5aa05a', '#e8a33a']), pants: '#2a2626' } }))
        c.role = 'jogger'
        c.angle = (i / 4) * Math.PI * 2
        c.dir = i % 2 ? 1 : -1
        c.speed = rnd.range(2.6, 3.4)
        this.others.push(c)
      }
    }

    // Market sellers behind their stalls
    for (const s of town.stalls || []) {
      const c = rig.add(makeCharacter(rnd, { colors: { shirt: rnd.pick(['#f2e3c6', '#c9dcc8', '#f0d0c8']) } }))
      c.role = 'seller'
      const back = -1.6
      c.home = { x: s.x + Math.sin(s.rot) * back, z: s.z + Math.cos(s.rot) * back }
      c.x = c.home.x
      c.z = c.home.z
      c.y = layout.getHeight(c.x, c.z)
      c.heading = s.rot
      this.others.push(c)
    }

    // Market crowd: shoppers browsing between the stalls
    const market = town.places.find((p) => p.name === 'Market')
    if (market && town.stalls) {
      for (let i = 0; i < 18; i++) {
        const c = rig.add(makeCharacter(rnd))
        c.role = 'shopper'
        c.market = market
        c.x = market.x + rnd.range(-8, 8)
        c.z = market.z + rnd.range(-6, 6)
        c.y = layout.getHeight(c.x, c.z)
        c.timer = rnd.range(0, 4)
        c.speed = rnd.range(0.9, 1.3)
        if (rnd.random() < 0.5) { c.item = ITEMS.bag; c.carry = 1; rig.applyColors(c) }
        this.others.push(c)
      }
    }

    // Kids at the playground
    const pg = town.park?.playground
    if (pg) {
      for (let i = 0; i < 3; i++) {
        const c = rig.add(makeCharacter(rnd, { scale: 0.68 }))
        c.role = i < 2 ? 'swing' : 'kid'
        c.home = { x: pg.x + (i < 2 ? (i ? 0.8 : -0.8) : 4), z: pg.z + (i < 2 ? 0 : 3) }
        c.x = c.home.x
        c.z = c.home.z
        c.y = layout.getHeight(c.x, c.z)
        c.heading = 0
        this.others.push(c)
      }
    }
    this.all = [...this.walkers, ...this.others]
  }

  pickDestination(c) {
    const nodes = this.layout.walk.nodes
    for (let tries = 0; tries < 6; tries++) {
      const goal = Math.floor(this.rnd.random() * nodes.length)
      if (goal === c.node) continue
      const path = this.layout.findPath(c.node, goal)
      if (path && path.length > 1 && path.length < 40) {
        c.path = path
        c.pi = 1
        c.state = 'walk'
        return
      }
    }
    c.state = 'idle'
    c.timer = 2
  }

  arrivalActivity(c) {
    const r = this.rnd.random()
    const near = (list, max) => {
      let best = null, bd = max * max
      for (const p of list) {
        const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2
        if (d < bd) { bd = d; best = p }
      }
      return best
    }
    if (r < 0.3) {
      const shop = near(this.town.shopDoors.map((s) => ({ ...s.door, s })), 28)
      if (shop) {
        c.state = 'toShop'
        c.goal = { x: shop.x, z: shop.z }
        return
      }
    }
    if (r < 0.55) {
      const free = (this.benches || []).filter((b) => !this.benchTaken.has(b))
      const bench = near(free, 30)
      if (bench) {
        this.benchTaken.add(bench)
        c.bench = bench
        c.state = 'toBench'
        c.goal = { x: bench.x + Math.sin(bench.rot) * 0.35, z: bench.z + Math.cos(bench.rot) * 0.35 }
        return
      }
    }
    if (r < 0.75) {
      const friend = this.walkers.find((o) => o !== c && o.state === 'idle' && !o.partner && (o.x - c.x) ** 2 + (o.z - c.z) ** 2 < 36)
      if (friend) {
        c.state = 'chat'
        friend.state = 'chat'
        c.partner = friend
        friend.partner = c
        c.timer = friend.timer = this.rnd.range(4, 9)
        return
      }
      c.state = 'idle'
      c.timer = this.rnd.range(2, 6)
      return
    }
    this.pickDestination(c)
  }

  update(dt, time, ctx) {
    for (const c of this.walkers) this.updateWalker(c, dt, time, ctx)
    for (const c of this.others) this.updateOther(c, dt, time, ctx)
  }

  updateWalker(c, dt, time, ctx) {
    if (c.taken) return // borrowed by an activity (taxi fare)
    if (updateReaction(c, dt, ctx)) {
      if (c.bench) { this.benchTaken.delete(c.bench); c.bench = null }
      if (c.partner) { c.partner.partner = null; c.partner = null }
      c.state = 'think'
      c.timer = 0.5
      return
    }
    const nodes = this.layout.walk.nodes
    c.timer -= dt
    switch (c.state) {
      case 'think':
        c.walk = damp(c.walk, 0, 8, dt)
        if (c.timer <= 0) this.pickDestination(c)
        break
      case 'walk': {
        const n = nodes[c.path[c.pi]]
        const prev = nodes[c.path[c.pi - 1]]
        const link = prev.links.find((l) => l.to === n.id)
        // wait at the curb if a car is coming
        if (link?.crosswalk && !c.crossing) {
          const mx = (n.x + prev.x) / 2, mz = (n.z + prev.z) / 2
          if (ctx.carNear(mx, mz, 13)) {
            c.walk = damp(c.walk, 0, 8, dt)
            c.heading += angleDelta(c.heading, Math.atan2(n.x - prev.x, n.z - prev.z)) * Math.min(1, dt * 5)
            break
          }
          c.crossing = true
        }
        // lane offset to the right of travel
        const sx = n.x - prev.x, sz = n.z - prev.z
        const sl = Math.hypot(sx, sz) || 1
        const tx = n.x + (sz / sl) * c.lane * (link?.crosswalk ? 0.4 : 1)
        const tz = n.z - (sx / sl) * c.lane * (link?.crosswalk ? 0.4 : 1)
        const sp = link?.crosswalk ? c.speed * 1.25 : c.speed
        if (walkTo(c, tx, tz, sp, dt, ctx, 0.6)) {
          c.crossing = false
          c.node = n.id
          c.pi++
          if (c.pi >= c.path.length) this.arrivalActivity(c)
        }
        break
      }
      case 'toShop':
        if (walkTo(c, c.goal.x, c.goal.z, c.speed, dt, ctx)) {
          c.state = 'inside'
          c.visible = false
          c.timer = this.rnd.range(5, 14)
        }
        break
      case 'inside':
        if (c.timer <= 0) {
          c.visible = true
          c.state = 'back'
        }
        break
      case 'back': {
        const n = nodes[c.node]
        if (walkTo(c, n.x, n.z, c.speed, dt, ctx, 0.7)) this.pickDestination(c)
        break
      }
      case 'toBench':
        if (walkTo(c, c.goal.x, c.goal.z, c.speed, dt, ctx, 0.25)) {
          c.state = 'sit'
          c.timer = this.rnd.range(10, 26)
        }
        break
      case 'sit':
        c.sit = damp(c.sit, 1, 6, dt)
        c.heading += angleDelta(c.heading, c.bench.rot) * Math.min(1, dt * 6)
        c.x = damp(c.x, c.bench.x + Math.sin(c.bench.rot) * 0.1, 6, dt)
        c.z = damp(c.z, c.bench.z + Math.cos(c.bench.rot) * 0.1, 6, dt)
        c.y = (c.bench.y ?? c.y)
        if (c.timer <= 0) {
          c.sit = 0
          this.benchTaken.delete(c.bench)
          c.bench = null
          c.state = 'back'
        }
        break
      case 'chat': {
        const p = c.partner
        if (!p || p.state !== 'chat') {
          c.talk = 0
          c.partner = null
          this.pickDestination(c)
          break
        }
        c.walk = damp(c.walk, 0, 8, dt)
        c.heading += angleDelta(c.heading, Math.atan2(p.x - c.x, p.z - c.z)) * Math.min(1, dt * 5)
        c.talk = Math.sin(time * 0.9 + c.index) > 0 ? 1 : 0
        if (c.timer <= 0) {
          c.talk = 0
          c.partner = null
          this.pickDestination(c)
        }
        break
      }
      case 'idle':
        c.walk = damp(c.walk, 0, 8, dt)
        c.look = Math.sin(time * 0.6 + c.index) * 0.6
        if (c.timer <= 0) {
          c.look = 0
          this.pickDestination(c)
        }
        break
    }
  }

  updateOther(c, dt, time, ctx) {
    if (updateReaction(c, dt, ctx)) return
    switch (c.role) {
      case 'keeper': {
        // return home after a dodge, sweep, and wave at a slow-passing car
        const home = c.home
        if ((c.x - home.x) ** 2 + (c.z - home.z) ** 2 > 0.2) {
          c.sweep = 0
          walkTo(c, home.x, home.z, 1.3, dt, ctx, 0.3)
          break
        }
        c.walk = damp(c.walk, 0, 8, dt)
        const car = ctx.car
        const near = (car.x - c.x) ** 2 + (car.z - c.z) ** 2 < 120 && car.speed < 6
        c.timer -= dt
        if (near && !c.waved) {
          c.waved = true
          c.wave = 1
          c.sweep = 0
          c.heading = Math.atan2(car.x - c.x, car.z - c.z)
          ctx.emotes.show(c, this.rnd.random() < 0.5 ? EMOTE.wave : EMOTE.music, 1.8)
          ctx.onVoice?.('hello', c.x, c.z)
          c.timer = 2
        } else if (!near && c.timer <= 0) {
          c.waved = false
          c.wave = 0
          c.sweep = c.sweep ? 0 : 1
          c.heading = home.rot + (c.sweep ? this.rnd.range(-0.8, 0.8) : 0)
          c.timer = this.rnd.range(3, 7)
        }
        c.y = ctx.ground(c.x, c.z)
        break
      }
      case 'jogger': {
        const loop = this.town.joggingLoop
        c.angle += (c.dir * c.speed * dt) / loop.r
        const tx = loop.x + Math.cos(c.angle) * loop.r, tz = loop.z + Math.sin(c.angle) * loop.r
        if ((tx - c.x) ** 2 + (tz - c.z) ** 2 > 9) walkTo(c, tx, tz, 3, dt, ctx)
        else {
          c.x = tx
          c.z = tz
          c.heading = Math.atan2(-Math.sin(c.angle) * c.dir, Math.cos(c.angle) * c.dir)
          c.run = 1
          c.walk = 0
          c.walkPhase += dt * c.speed * 3.1
          c.y = ctx.ground(c.x, c.z)
        }
        break
      }
      case 'seller': {
        if ((c.x - c.home.x) ** 2 + (c.z - c.home.z) ** 2 > 0.2) { walkTo(c, c.home.x, c.home.z, 1.2, dt, ctx); break }
        c.walk = damp(c.walk, 0, 8, dt)
        c.talk = Math.sin(time * 0.7 + c.index * 2) > 0.3 ? 1 : 0
        c.look = Math.sin(time * 0.5 + c.index) * 0.7
        break
      }
      case 'swing': {
        const a = Math.sin(time * 2.2 + c.index) * 0.9
        c.sit = 1
        c.x = c.home.x
        c.z = c.home.z + Math.sin(a) * 1.3
        c.y = this.layout.getHeight(c.home.x, c.home.z) + 0.15 + (1 - Math.cos(a)) * 1.3
        c.heading = 0
        c.cheer = a > 0.8 ? 1 : 0
        break
      }
      case 'shopper': {
        // browse: walk to a stall front, look and chat, move on
        c.timer -= dt
        if (!c.goal || c.timer <= 0) {
          const s = this.town.stalls[Math.floor(this.rnd.random() * this.town.stalls.length)]
          const off = this.rnd.range(-1.4, 1.4)
          c.goal = { x: s.x + Math.cos(s.rot) * off + Math.sin(s.rot) * 1.9, z: s.z - Math.sin(s.rot) * off + Math.cos(s.rot) * 1.9, rot: s.rot + Math.PI }
          c.timer = this.rnd.range(6, 14)
        }
        if (walkTo(c, c.goal.x, c.goal.z, c.speed, dt, ctx, 0.3)) {
          c.heading += angleDelta(c.heading, c.goal.rot) * Math.min(1, dt * 4)
          c.talk = Math.sin(time * 0.8 + c.index) > 0.4 ? 1 : 0
          c.look = Math.sin(time * 0.6 + c.index) * 0.5
        } else c.talk = 0
        break
      }
      case 'kid': {
        c.t = (c.t || 0) + dt
        const tx = c.home.x + Math.cos(c.t * 0.8) * 3, tz = c.home.z + Math.sin(c.t * 1.1) * 2
        walkTo(c, tx, tz, 2.6, dt, ctx, 0.1)
        break
      }
    }
  }

  setBenches(benches) {
    this.benches = benches
  }

  // Borrow a walker for an activity (e.g. a taxi fare)
  borrowNear(x, z, maxDist = 60) {
    let best = null, bd = maxDist * maxDist
    for (const c of this.walkers) {
      if (c.taken || !c.visible || c.reaction || c.state === 'sit') continue
      const d = (c.x - x) ** 2 + (c.z - z) ** 2
      if (d < bd) { bd = d; best = c }
    }
    if (best) {
      best.taken = true
      if (best.partner) { best.partner.partner = null; best.partner = null }
      best.talk = 0
    }
    return best
  }

  release(c) {
    c.taken = false
    c.visible = true
    c.sit = 0
    c.state = 'back'
    c.node = this.layout.nearestWalkNode(c.x, c.z)
  }
}

export { clamp }
