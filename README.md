# Seasons Valley

A cozy open-world town in the browser. Drive a little off-road buggy, ride a motorbike, fly a helicopter or get out and walk around **Maple Hollow**: a big town full of people going about their day, builders putting up houses and shops (and rebuilding them if you knock them down), traffic, a busy market and a working airport. Switch between **Autumn**, **Spring** and **Monsoon** at any time, drive into the night, take on courier, taxi and rally activities and hunt for 25 glowing embers.

**Play it live: [www.akashm.site/games/seasons-valley](https://www.akashm.site/games/seasons-valley/)**

Built with [three.js](https://threejs.org), [Rapier](https://rapier.rs) physics and the Web Audio API.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/ (works from any folder)
```

### Publishing to the portfolio site

The live copy lives in [akash055-commits.github.io](https://github.com/akash055-commits/akash055-commits.github.io) under `games/seasons-valley/`. After `npm run build`, replace that folder with the contents of `dist/` and push the site's `main` branch.

## Controls

| Keyboard | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Drive / ride / walk (camera-relative on foot) |
| `Space` | Handbrake drift · jump on foot · helicopter climb |
| `Shift` | Boost · run on foot · helicopter descend |
| `F` (or `E`) | Get in / out of the buggy, motorbike or helicopter |
| `I` | Helicopter engine start / stop (wait for full rotor speed) |
| `Q` `E` | Helicopter sideways strafe |
| `G` | Start an activity at a glowing marker, or quit one |
| `J` | Activities list (with "show the way") |
| `1` `2` `3` | Autumn / Spring / Monsoon |
| `N` | Day ↔ night |
| `C` | Camera style (diorama ↔ chase in vehicles, eye-level ↔ diorama on foot) |
| `R` | Reset the vehicle onto the road |
| `M` | Music on / off |
| `H` | Horn (people turn round, and some grumble) |
| Mouse drag / wheel | Orbit / zoom the camera |
| Click the minimap | Enlarge to the full town map |

On phones and tablets an on-screen joystick and buttons appear automatically. They change for walking (jump, run), driving (gas, boost, drift) and flying (up, down, engine). Tap the on-screen prompt to get in a vehicle or start an activity; drag on the scene to look around.

## What's inside

- **Town:** a grid of eight streets each way with sidewalks, crossings and bridges. It holds houses, shops, apartments, offices, a cinema, a town square with a clock tower, a busy market, a school, a park and lake, a fire station, police station, hospital, hotel, library, gas station, stunt park and builders' yard.
- **People:** more than 200 hand-rigged townsfolk with faces, outfits and animation. They walk the sidewalks with path-finding, wait at crossings, shop at the market, sit on benches, chat, jog and play. They dodge your vehicle, and if you bump one they tumble, get up dizzy and shake a fist (cartoon style).
- **Builders:** nine construction sites where crews carry materials and hammer homes and shops together piece by piece. Crash into one and the pieces collapse with real physics; the builders sigh and rebuild.
- **Vehicles:** the buggy (raycast suspension, 5-speed gearbox, drifts), a sport motorbike with lean and balance assist, and a helicopter with start-up and shut-down, collective, altitude hold and coordinated turns. Park it anywhere. Town traffic drives the streets.
- **On foot:** get out anywhere and walk, run and jump with an eye-level third-person camera.
- **Airport:** a runway you can drive on, taxiways, a terminal with jet bridges, a control tower, hangars with parked planes and airliners that push back, taxi, take off, fly a circuit and land automatically. Jets with contrails cross the sky overhead.
- **Activities:** Town Courier (parcels and building supplies against the clock), Town Taxi (pick up waving fares, tips for smooth rides) and Checkpoint Rally (12 hoops, medals). Coins and records are saved.
- **Seasons and time:** every colour is a shared shader uniform, so seasons blend smoothly. A layered sky with clouds, stars and a moon; the day/night cycle lights windows, street lamps and headlights.
- **Sound:** procedural engines for the buggy and bike, helicopter rotor and turbine, jet roar, footsteps, voices, hammers, honks and seasonal ambience, all synthesized in code. The tyre squeal is subtle and only on real slides. Each season has its own quiet background track.

Graphics quality (High / Low) and volumes live in the settings panel. Phones start on Low automatically.

## Credits

Music: "Sudo" (Autumn), "Baguira" (Spring) and "Boy" (Monsoon) from [Bruno Simon's folio-2025](https://github.com/brunosimon/folio-2025/tree/main/static/sounds/musics), released under CC0 1.0. See `public/sounds/music/LICENSE.md`.
