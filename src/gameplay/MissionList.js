// Story-style missions, each tied to one way of getting around. A mission is a start
// marker plus a list of steps; Missions.js runs the steps (see the step types there).
// Positions are resolved at start time so they follow the town layout.

export const VEHICLE_COLORS = { bike: '#e8742c', car: '#3a7bd5', tank: '#5d8a3a', foot: '#d6452f' }
export const VEHICLE_LABEL = { bike: 'Motorbike', car: 'Car', tank: 'Tank', foot: 'On foot' }
export const VEHICLE_LETTER = { bike: 'B', car: 'C', tank: 'T', foot: 'F' }

// helpers used by the step definitions (town = game.town, rnd = random 0..1)
const place = (town, name) => town.places.find((p) => p.name === name || p.name.startsWith(name))
const inRect = (p, x0, x1, z0, z1) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1

export const MISSIONS = [
  // ---------------------------------------------------------------- motorbike
  {
    id: 'pizza', vehicle: 'bike', name: 'Hot Wheels Delivery', reward: 220,
    blurb: 'Five piping hot orders across Maple Hollow. Every delivery adds time to the clock. Lane-split, jump the kerbs, use your nitro.',
    start: (town) => place(town, 'Pizzeria') || town.shops[0],
    steps: (town, rnd) => {
      const houses = town.houses.filter((h) => inRect(h, -175, 175, -175, 175))
      const pick = () => houses[Math.floor(rnd() * houses.length)]
      return [
        { type: 'timer', seconds: 55 },
        ...[1, 2, 3, 4, 5].map((n) => ({ type: 'goto', at: pick().gate, r: 4.5, stop: true, label: `Deliver order ${n} of 5`, bonusTime: 22 })),
      ]
    },
  },
  {
    id: 'mountain', vehicle: 'bike', name: 'Mountain Pass Sprint', reward: 380,
    blurb: 'Three local riders think they own the climb to Pine Ridge. Beat them up Pine Pass to the Lookout Point.',
    start: () => ({ x: 25, z: 186 }),
    steps: (town) => {
      const look = place(town, 'Lookout Point')
      return [{ type: 'race', opponents: 3, kind: 'bike', grid: { x: 25, z: 190, heading: 0 }, checkpoints: [{ x: 25, z: 250 }, { x: 25, z: 310 }, { x: 25, z: 380 }, { x: 25, z: 440 }, { x: look.door.x, z: look.door.z }], label: 'Win the race to the Lookout' }]
    },
  },
  {
    id: 'moto', vehicle: 'bike', name: 'Dust Devil Motocross', reward: 260,
    blurb: 'Three laps of the Dustwater arena against the clock. Big air earns a bonus.',
    start: (town) => ({ x: town.motoArena.x, z: town.motoArena.z - 24 }),
    steps: (town) => {
      const a = town.motoArena
      const lap = [{ x: a.x - 13, z: a.z - 13 }, { x: a.x + 13, z: a.z - 13 }, { x: a.x + 13, z: a.z + 13 }, { x: a.x - 13, z: a.z + 13 }]
      return [{ type: 'race', opponents: 0, laps: 3, limit: 100, checkpoints: lap, label: 'Three laps of the arena', countJumps: true }]
    },
  },
  {
    id: 'paparazzi', vehicle: 'bike', name: 'Paparazzi', reward: 320,
    blurb: 'A celebrity is cruising Harbor Bay. Tail the white car, get close for three photos without being spotted, then lose the police.',
    start: () => ({ x: 380, z: 60 }),
    steps: () => [
      { type: 'tail', spawn: { x: 405, z: 75 }, photos: 3, label: 'Tail the celebrity and snap 3 photos' },
      { type: 'wanted', level: 2 },
      { type: 'evade', label: 'The police are after you. Lose them' },
    ],
  },
  // ---------------------------------------------------------------- car
  {
    id: 'getaway', vehicle: 'car', name: 'Getaway Driver', reward: 450,
    blurb: 'Pick the crew up outside the bank, wait for the job, then lose the heat and get them to the Harbor Bay warehouses.',
    start: () => ({ x: -100, z: 25 }),
    steps: (town) => {
      const bank = place(town, 'Bank') || town.shops[3]
      const hide = place(town, 'Harbor Bay Warehouses') || place(town, 'Harbor Docks')
      return [
        { type: 'goto', at: bank.gate, r: 5, stop: true, label: 'Pull up outside the bank' },
        { type: 'hold', seconds: 6, r: 8, label: 'Keep the engine running…' },
        { type: 'wanted', level: 3 },
        { type: 'evade', label: 'Alarm! Lose the police' },
        { type: 'goto', at: hide.door, r: 7, stop: true, label: 'Drop the crew at the Harbor Bay warehouses' },
      ]
    },
  },
  {
    id: 'streetking', vehicle: 'car', name: 'Street King', reward: 420,
    blurb: 'One lap of the Valley Ring against three tuned street racers. Nitro is legal. Finish first.',
    start: () => ({ x: 150, z: 300 }),
    steps: () => [{ type: 'race', opponents: 3, kind: 'sedan', grid: { x: 140, z: 300, heading: -Math.PI / 2 }, checkpoints: [{ x: -150, z: 300 }, { x: -420, z: 300 }, { x: -420, z: 0 }, { x: -420, z: -420 }, { x: 0, z: -420 }, { x: 480, z: -420 }, { x: 480, z: -150 }, { x: 480, z: 200 }, { x: 480, z: 300 }, { x: 150, z: 300 }], label: 'Win one lap of the Valley Ring' }],
  },
  {
    id: 'repo', vehicle: 'car', name: 'Repo Man', reward: 300,
    blurb: 'A customer stopped paying for their car. Find it in Harbor Bay and bring it to the Spray & Fix in Dustwater without wrecking it.',
    start: () => ({ x: 330, z: 25 }),
    steps: (town) => {
      const garage = town.sprayShops.find((s) => s.name.includes('Dustwater')) || town.sprayShops[0]
      return [
        { type: 'takeCar', spawn: { x: 555, z: 75 }, label: 'Find the marked car and get in' },
        { type: 'goto', at: garage.bay || garage.door, r: 6, stop: true, minHealth: 0.55, label: 'Deliver it to Spray & Fix Dustwater (keep it in one piece)' },
      ]
    },
  },
  {
    id: 'derby', vehicle: 'car', name: 'Derby Takedown', reward: 400,
    blurb: 'Four gang cars are tearing around Maple Hollow. Ram or shoot them until every one is a wreck.',
    start: () => ({ x: -175, z: 60 }),
    steps: () => [{ type: 'wreckCars', count: 4, limit: 200, area: { x: 0, z: 0 }, label: 'Wreck the gang cars' }],
  },
  // ---------------------------------------------------------------- tank
  {
    id: 'livefire', vehicle: 'tank', name: 'Live Fire Exercise', reward: 350,
    blurb: 'The range officer wants eight target hulks destroyed around Fort Granite in two minutes.',
    start: (town) => ({ x: town.fort.tankSpawn.x - 14, z: town.fort.tankSpawn.z }),
    steps: (town) => {
      const f = town.fort
      const pts = [[f.x1 + 60, f.z0 - 30], [f.x1 + 90, 20], [f.x0 - 30, f.z1 + 70], [f.x0 + 60, f.z1 + 80], [f.x1 + 30, f.z1 + 60], [f.x0 + 20, f.z0 - 60], [f.x1 + 120, -80], [(f.x0 + f.x1) / 2, f.z0 - 70]]
      return [{ type: 'destroy', targets: pts.map(([x, z]) => ({ x, z })), limit: 120, label: 'Destroy the target hulks' }]
    },
  },
  {
    id: 'rampage', vehicle: 'tank', name: 'Rampage', reward: 500,
    blurb: 'Two minutes, one tank, fifteen vehicles. The police will not like it.',
    start: () => ({ x: -440, z: -25 }),
    steps: () => [{ type: 'rampage', count: 15, limit: 120, label: 'Destroy 15 vehicles' }],
  },
  // ---------------------------------------------------------------- on foot
  {
    id: 'turf', vehicle: 'foot', name: 'Dockside Turf', reward: 450,
    blurb: 'A gang has taken over the Harbor Bay container yard. Take them all down, grab the briefcase and get away.',
    start: () => ({ x: 560, z: -60 }),
    steps: () => [
      { type: 'eliminate', at: { x: 605, z: -30 }, count: 8, spread: 22, label: 'Take down the gang' },
      { type: 'goto', at: { x: 605, z: -30 }, r: 2.5, label: 'Grab the briefcase', item: true },
      { type: 'wanted', level: 2 },
      { type: 'evade', label: 'Lose the police' },
    ],
  },
  {
    id: 'range', vehicle: 'foot', name: 'Shooting Range', reward: 200,
    blurb: 'Fort Granite\'s range: hit fifteen pop-up targets in sixty seconds. Any gun will do; the sniper rifle helps.',
    start: (town) => ({ x: town.fort.range.x, z: town.fort.range.z - 6 }),
    steps: () => [{ type: 'range', hits: 15, limit: 60, label: 'Hit the glowing targets' }],
  },
]

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]))
