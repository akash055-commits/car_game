# Seasons Valley

A cozy, physics-driven 3D driving game in the browser. Cruise a little off-road buggy around a valley circuit, switch between **Autumn**, **Spring** and **Monsoon** at any time, drive into the night, hunt for 25 glowing embers and chase your best lap.

Built with [three.js](https://threejs.org), [Rapier](https://rapier.rs) physics and the Web Audio API.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/ (works from any folder)
```

## Controls

| Keyboard | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Drive, brake and reverse, steer |
| `Space` | Handbrake drift |
| `Shift` | Boost |
| `1` `2` `3` | Autumn / Spring / Monsoon |
| `N` | Day ↔ night |
| `C` | Diorama camera ↔ chase camera |
| `R` | Reset the car onto the road |
| `M` | Music on / off |
| `H` | Horn |
| Mouse drag / wheel | Orbit / zoom the camera |

On phones and tablets an on-screen joystick, gas, boost and drift buttons appear automatically. Drag on the scene to look around.

## What's inside

- **Driving:** raycast-vehicle suspension, tyre grip that changes on pavers, dirt, wood and wet surfaces, a 5-speed gearbox, handbrake drifts, jumps and knockable crates, barrels and cones.
- **World:** a heightfield valley with a cobbled circuit, lake, stream, a wooden bridge, cabin, pier, lanterns, wind-swept grass and fluffy leaf-card trees.
- **Seasons and time:** every colour is a shared shader uniform, so seasons blend smoothly. The day/night cycle brings out lanterns, headlights, stars, fireflies and (in the monsoon) lightning.
- **Look:** soft shadows, emissive bloom, a tilt-shift "miniature" blur and per-season colour grading.
- **Sound:** a procedural engine that follows the real RPM, gears and throttle, plus tyre, surface, wind, impact and ambience sounds, all synthesized in code. Background music plays very quietly.
- **Game:** a lap timer with 6 checkpoints, a saved best lap and 25 collectibles with saved progress.

Graphics quality (High / Low) and volumes live in the settings panel. Phones start on Low automatically.

## Credits

Music: "Sudo", "Boy" and "Baguira" from [Bruno Simon's folio-2025](https://github.com/brunosimon/folio-2025/tree/main/static/sounds/musics), released under CC0 1.0. See `public/sounds/music/LICENSE.md`.
