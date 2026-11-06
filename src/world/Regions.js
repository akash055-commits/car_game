// The wider valley: every town grid, the military base and the highway network.
// Layout reads this to build streets, blocks, terrain flattening and the road texture;
// Town reads the district plans and street names; Traffic reads the lane loops.

// Maple Hollow keeps its original 8 × 8 street grid in the middle of the map
export const GRID = [-175, -125, -75, -25, 25, 75, 125, 175]

export const TOWNS = [
  {
    id: 'maple', name: 'Maple Hollow', prefix: '', style: 'maple',
    xs: GRID, zs: GRID, height: null, // keeps the original gently rolling town ground
    removed: ['v:75:-75:-25', 'v:75:-25:25', 'h:-25:25:75', 'h:-25:75:125', 'v:-125:-175:-125'],
    merged: [
      { id: 'park', x0: 25, x1: 125, z0: -75, z1: 25 },
      { id: 'yard', x0: -175, x1: -75, z0: -175, z1: -125 },
    ],
    names: {
      x: { '-175': 'West Ring', '-125': 'Cedar Avenue', '-75': 'Oak Avenue', '-25': 'Main Street', 25: 'Maple Avenue', 75: 'Birch Lane', 125: 'Elm Street', 175: 'East Ring' },
      z: { '-175': 'South Ring', '-125': 'Harbour Road', '-75': 'Willow Road', '-25': 'Market Street', 25: 'Station Road', 75: 'Chestnut Road', 125: 'Hill Street', 175: 'North Ring' },
    },
    loops: [[0, 0, 7, 7], [1, 2, 3, 4], [3, 3, 5, 5], [2, 4, 4, 6], [4, 4, 6, 6], [1, 0, 3, 2], [5, 0, 7, 2], [0, 4, 2, 6]],
  },
  {
    id: 'harbor', name: 'Harbor Bay', prefix: 'H', style: 'harbor',
    xs: [380, 430, 480, 530, 580, 630], zs: [-75, -25, 25, 75, 125], height: 0.9,
    removed: [], merged: [],
    districts: {
      'H4,0': 'docks', 'H4,1': 'docks', 'H4,2': 'docks', 'H4,3': 'docks',
      'H3,0': 'warehouse', 'H3,3': 'warehouse', 'H2,2': 'shops', 'H1,2': 'shops', 'H2,1': 'downtown',
      'H3,1': 'apartments', 'H3,2': 'apartments', 'H0,0': 'garage', 'H1,0': 'clinic', 'H1,3': 'civic', 'H2,3': 'plaza',
    },
    names: {
      x: { 380: 'Quay Street', 430: 'Anchor Avenue', 480: 'Ring Road East', 530: 'Lantern Lane', 580: 'Netmaker Row', 630: 'Seawall Drive' },
      z: { '-75': 'Saltmarsh Road', '-25': 'Pier Street', 25: 'Harbor Road', 75: 'Gull Street', 125: 'Lighthouse Road' },
    },
    loops: [[0, 0, 5, 4], [1, 1, 3, 3], [3, 0, 5, 2]],
  },
  {
    id: 'pine', name: 'Pine Ridge', prefix: 'P', style: 'chalet',
    xs: [-125, -75, -25, 25, 75], zs: [430, 480, 530], height: 14,
    removed: [], merged: [],
    districts: { 'P1,0': 'lodge', 'P2,1': 'shops', 'P3,0': 'sawmill', 'P3,1': 'lookout', 'P2,0': 'garage' },
    names: {
      x: { '-125': 'Spruce Lane', '-75': 'Fir Avenue', '-25': 'Summit Street', 25: 'Ridge Road', 75: 'Larch Lane' },
      z: { 430: 'Valley View', 480: 'Timber Street', 530: 'Snowcap Road' },
    },
    loops: [[0, 0, 4, 2]],
  },
  {
    id: 'dust', name: 'Dustwater', prefix: 'D', style: 'desert',
    xs: [-620, -570, -520, -470], zs: [-600, -550, -500], height: 3,
    removed: [], merged: [],
    districts: { 'D1,0': 'garage', 'D2,0': 'motel', 'D2,1': 'moto', 'D1,1': 'shops' },
    names: {
      x: { '-620': 'Cactus Row', '-570': 'Mesa Road', '-520': 'Rattler Street', '-470': 'Canyon Drive' },
      z: { '-600': 'Dry Creek Road', '-550': 'Sundown Street', '-500': 'Old Mine Road' },
    },
    loops: [[0, 0, 3, 2]],
  },
]

// Fort Granite: a fenced military base with an internal loop road
export const FORT = { id: 'fort', name: 'Fort Granite', x0: -690, x1: -510, z0: -110, z1: 50, height: 4, gate: { x: -510, z: -25 } }

// Highways and connector roads (all axis-aligned). `hwy` roads have gravel shoulders,
// no sidewalks and fewer lamps.
const H = (ax, az, bx, bz) => ({ ax, az, bx, bz, hwy: true })
export const RING = { x0: -420, x1: 480, z0: -420, z1: 300 }
export const EXTRA_EDGES = [
  // airport access + terminal road (original)
  { ax: 25, az: -175, bx: 25, bz: -200 },
  { ax: -80, az: -200, bx: 25, bz: -200 },
  { ax: 25, az: -200, bx: 130, bz: -200 },
  // ring highway around the valley (passes through Harbor Bay along x = 480)
  H(-420, -420, 480, -420),
  H(480, -420, 480, -75),
  H(480, 125, 480, 300),
  H(480, 300, 25, 300), H(25, 300, -420, 300),
  H(-420, 300, -420, -25), H(-420, -25, -420, -175), H(-420, -175, -420, -420),
  // spokes from Maple Hollow
  H(25, 175, 25, 300), // north to the ring
  H(25, 300, 25, 430), // climb to Pine Ridge
  H(175, 25, 380, 25), // east to Harbor Bay
  H(-175, -25, -420, -25), // west to the ring
  H(-175, -175, -420, -175), // south-west to the ring
  H(-420, -25, -510, -25), // Fort Granite gate road
  H(-420, -420, -420, -500), H(-420, -500, -470, -500), // down to Dustwater
  // Fort Granite internal loop
  { ax: -690, az: -110, bx: -510, bz: -110, fort: true },
  { ax: -510, az: -110, bx: -510, bz: -25, fort: true },
  { ax: -510, az: -25, bx: -510, bz: 50, fort: true },
  { ax: -510, az: 50, bx: -690, bz: 50, fort: true },
  { ax: -690, az: 50, bx: -690, bz: -110, fort: true },
  { ax: -600, az: -110, bx: -600, bz: 50, fort: true },
]

// Highway names for the HUD / addresses
export const HIGHWAY_NAMES = { ring: 'Valley Ring', north: 'Pine Pass', east: 'Coast Road', west: 'Fort Road', south: 'Desert Highway' }

// Traffic lane loops on the highways (rectangles in world coordinates)
export const HIGHWAY_LOOPS = [[RING.x0, RING.z0, RING.x1, RING.z1]]

// Settlement rectangles used for terrain flattening, foliage / prop placement and labels
export function settlementRects() {
  const out = []
  for (const t of TOWNS) {
    out.push({ id: t.id, name: t.name, x0: t.xs[0], x1: t.xs[t.xs.length - 1], z0: t.zs[0], z1: t.zs[t.zs.length - 1], height: t.height })
  }
  out.push({ id: FORT.id, name: FORT.name, x0: FORT.x0, x1: FORT.x1, z0: FORT.z0, z1: FORT.z1, height: FORT.height })
  return out
}

// Water: the original stream + river now flows on through Harbor Bay to the sea
export const SEA_X = 690
export const STREAM = { hw: 3.4, depth: -1.5, pts: [[96, 360], [110, 290], [104, 234], [102, 200], [106, 170], [108, 140], [103, 110], [100, 80], [100, 50], [100, 30], [92, 0], [84, -14]] }
export const RIVER = { hw: 4.6, depth: -1.8, pts: [[90, -30], [110, -38], [128, -46], [150, -50], [176, -53], [200, -55], [240, -66], [290, -60], [340, -66], [366, -84], [392, -100], [450, -104], [520, -102], [600, -106], [680, -104], [800, -104]] }
