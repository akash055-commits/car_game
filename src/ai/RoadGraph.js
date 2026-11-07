// Road network router: A* over Layout's street + highway graph (intersections and
// bends are nodes, straight street segments are edges). Used by police and AI racers
// to find their way across the valley, and by the minimap GPS line.
export class RoadGraph {
  constructor(layout) {
    this.layout = layout
    this.nodes = layout.nodes.map((n, i) => ({ id: i, x: n.x, z: n.z, links: [] }))
    const index = new Map(layout.nodes.map((n, i) => [`${n.x},${n.z}`, i]))
    for (const e of layout.edges) {
      const a = index.get(`${e.ax},${e.az}`), b = index.get(`${e.bx},${e.bz}`)
      if (a === undefined || b === undefined) continue
      const len = Math.hypot(e.bx - e.ax, e.bz - e.az)
      // highways are a little "cheaper" so routes prefer them over long distances
      const cost = len * (e.hwy ? 0.8 : 1)
      this.nodes[a].links.push({ to: b, cost })
      this.nodes[b].links.push({ to: a, cost })
    }
  }

  nearestNode(x, z) {
    let best = 0, bd = Infinity
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2
      if (d < bd) { bd = d; best = n.id }
    }
    return best
  }

  // Node closest to (x, z) that is also roughly in the direction of travel
  findPath(from, to) {
    if (from === to) return [from]
    const N = this.nodes
    const g = new Map([[from, 0]])
    const came = new Map()
    const open = [{ id: from, f: 0 }]
    const closed = new Set()
    const h = (a) => Math.hypot(N[a].x - N[to].x, N[a].z - N[to].z) * 0.8
    let guard = 0
    while (open.length && guard++ < 4000) {
      let bi = 0
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i
      const cur = open.splice(bi, 1)[0].id
      if (cur === to) {
        const path = [cur]
        let c = cur
        while (came.has(c)) { c = came.get(c); path.unshift(c) }
        return path
      }
      if (closed.has(cur)) continue
      closed.add(cur)
      for (const l of N[cur].links) {
        const tg = g.get(cur) + l.cost
        if (tg < (g.get(l.to) ?? Infinity)) {
          g.set(l.to, tg)
          came.set(l.to, cur)
          open.push({ id: l.to, f: tg + h(l.to) })
        }
      }
    }
    return null
  }

  // World-space waypoints from (x0, z0) to (x1, z1) along the roads, keeping right
  route(x0, z0, x1, z1, lane = 1.9) {
    const a = this.nearestNode(x0, z0), b = this.nearestNode(x1, z1)
    const path = this.findPath(a, b)
    if (!path) return [{ x: x1, z: z1 }]
    const pts = []
    for (let i = 0; i < path.length; i++) {
      const n = this.nodes[path[i]]
      const prev = this.nodes[path[i - 1]] || n
      const next = this.nodes[path[i + 1]] || n
      // offset to the right of the direction of travel (averaged at corners)
      let dx = next.x - prev.x, dz = next.z - prev.z
      const l = Math.hypot(dx, dz) || 1
      dx /= l
      dz /= l
      pts.push({ x: n.x - dz * lane, z: n.z + dx * lane })
    }
    pts.push({ x: x1, z: z1 })
    return pts
  }
}
