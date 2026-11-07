// Weapon definitions. Damage is per pellet; rate is shots per second; spread is the cone
// half-angle in radians (aimSpread while aiming with the right mouse button).
export const WEAPONS = [
  { id: 'fists', slot: 1, name: 'Fists', melee: true, damage: 34, rate: 2.4, range: 1.7, hold: null, icon: '✊' },
  { id: 'pistol', slot: 2, name: 'Pistol', damage: 36, rate: 4.5, spread: 0.016, aimSpread: 0.004, bloom: 0.012, clip: 12, ammo: 96, reload: 1.3, range: 140, recoil: 0.06, hold: 'pistol', driveBy: true, price: 20, icon: '🔫' },
  { id: 'smg', slot: 3, name: 'SMG', damage: 22, rate: 12, auto: true, spread: 0.04, aimSpread: 0.016, bloom: 0.006, clip: 30, ammo: 210, reload: 1.8, range: 100, recoil: 0.035, hold: 'pistol', driveBy: true, price: 30, icon: '⚡' },
  { id: 'shotgun', slot: 4, name: 'Shotgun', damage: 17, pellets: 9, rate: 1.25, spread: 0.1, aimSpread: 0.075, bloom: 0, clip: 6, ammo: 42, reload: 2.5, range: 45, recoil: 0.2, hold: 'rifle', price: 30, icon: '💥' },
  { id: 'rifle', slot: 5, name: 'Assault Rifle', damage: 30, rate: 9, auto: true, spread: 0.028, aimSpread: 0.006, bloom: 0.004, clip: 30, ammo: 240, reload: 2.1, range: 180, recoil: 0.05, hold: 'rifle', price: 40, icon: '🎯' },
  { id: 'sniper', slot: 6, name: 'Sniper Rifle', damage: 160, rate: 0.75, spread: 0.02, aimSpread: 0, bloom: 0, clip: 5, ammo: 25, reload: 2.8, range: 450, recoil: 0.3, hold: 'rifle', scope: true, price: 50, icon: '🔭' },
  { id: 'rocket', slot: 7, name: 'Rocket Launcher', damage: 0, projectile: 'rocket', rate: 0.55, spread: 0.01, aimSpread: 0.002, bloom: 0, clip: 1, ammo: 8, reload: 2.6, range: 400, recoil: 0.45, hold: 'launcher', price: 80, icon: '🚀' },
]

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]))
