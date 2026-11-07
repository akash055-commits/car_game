# Seasons Valley

An open-world action sandbox in the browser. Start in **Maple Hollow** and explore a 1.6 km valley: the seaside streets of **Harbor Bay**, **Pine Ridge** up the mountain pass, the desert town of **Dustwater** and the **Fort Granite** army base, all linked by the Valley Ring highway.

- **Vehicles:** drive the buggy, ride motorbikes with nitro, fly the helicopter, take the tank, or steal any car on the road.
- **Combat and police:** use seven weapons. Get a wanted level and outrun escalating police: patrol cars, officers on foot, a helicopter, roadblocks and the army.
- **Missions:** twelve missions, separate for the motorbike, the car, the tank and on foot.
- **The valley:** it still has its cosy side, with townsfolk, builders, an airport, three seasons and day and night.

**Play it live: [www.akashm.site/games/seasons-valley](https://www.akashm.site/games/seasons-valley/)** (that copy is updated separately, see below)

Built with [three.js](https://threejs.org), [Rapier](https://rapier.rs) physics and the Web Audio API. Every model, texture and sound effect is generated in code.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/ (works from any folder)
```

### Publishing to the portfolio site

The live copy lives in [akash055-commits.github.io](https://github.com/akash055-commits/akash055-commits.github.io) under `games/seasons-valley/`. After `npm run build`, replace that folder with the contents of `dist/` and push the site's `main` branch.

## Controls

| Keyboard / mouse | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Drive, ride, walk (relative to the camera on foot); `A` `D` pivot the tank |
| `Shift` or `X` | **Nitro** in the car and on the bike (blue bar, refills; bikes pop a wheelie). Sprint on foot. Helicopter down |
| `Space` | Handbrake drift, bike brake, jump, helicopter up |
| `F` (or `E`) | Get in or out. Next to a slow traffic car: **steal it**. Also takes a police car whose crew is out |
| Left click (or `Ctrl`) | Shoot. Tank cannon. Drive-by from a car or bike (SMG or pistol) |
| Right click | Aim over the shoulder (scope with the sniper rifle). Tank machine gun |
| `1` – `7` | Fists, pistol, SMG, shotgun, assault rifle, sniper rifle, rocket launcher |
| `Tab` (hold) / mouse wheel | Weapon wheel / cycle weapons |
| `R` | Reload on foot. Reset your vehicle onto the road when driving |
| `Backspace` | Back onto the nearest road when on foot |
| `G` | Start or quit a **mission** or activity at a marker. Shop at Bullseye Arms |
| `J` | Missions and activities list, with "show the way" |
| `I` | Helicopter engine start / stop |
| `Q` `E` | Helicopter sideways strafe |
| `8` `9` `0` | Autumn / Spring / Monsoon |
| `N` | Day / night |
| `C` | Camera style (overhead / chase in vehicles, shoulder / overhead on foot) |
| `M` | Music on / off |
| `H` | Horn (people turn round, some grumble) |
| Mouse drag / wheel | Look / zoom. In the overhead view you aim at the cursor, and right-drag orbits |
| Click the minimap | The whole valley, with towns, hospitals (+), police (P), gun shops (G) and Spray & Fix (S) |

On phones and tablets an on-screen joystick and buttons appear automatically:

- **On foot:** jump, sprint, FIRE, AIM and WEAPON. Aim snaps gently onto the nearest person.
- **Car and bike:** gas, nitro, drift or brake, and SHOOT.
- **Tank:** cannon, machine gun and gas.
- **Helicopter:** up, down and engine.

## What's in the valley

**Towns and places**
- **Maple Hollow** (the original town): market, town square, cinema, school, park and lake, hospital, police station, airport and stunt park.
- **Harbor Bay**: container docks with gantry cranes, piers over the sea, a lighthouse, the fish market, warehouses, a clinic and a police station. A river runs through the south of town.
- **Pine Ridge**: a mountain village reached by the climbing Pine Pass. Chalets, Summit Lodge, a sawmill and Lookout Point.
- **Dustwater**: a desert town with the Sundown Motel, a roadside diner and the Motocross Arena.
- **Fort Granite**: a fenced army base with barracks, hangars, watchtowers, a helipad, the firing range and the **tank depot**.
- **Valley Ring**: a 3 km highway loop linking everything, with gravel shoulders and double yellow lines.

**Vehicles**
- **Buggy:** five gears, drifts, about 140 km/h, 190 km/h on nitro.
- **Motorbikes:** three of them. About 170 km/h, 230 km/h on nitro. Hard crashes throw you over the bars.
- **Helicopter.**
- **Tank:** tracked and skid-steered, with a slewing turret, cannon and machine gun. It crushes cars.
- **Stolen cars and vans:** any traffic car you take.
- **Police cars:** steal one once its crew is out.
- Vehicles take damage, smoke, catch fire and explode, then come back later. **Spray & Fix** garages repair you.

**People**
- Townsfolk have faces with coloured eyes, blinking lids, eyebrows and lips that change with their mood.
- They walk heel to toe, with swaying hips and swinging arms.
- They dodge cars, flee gunfire, cower or put their hands up when you aim at them, and tumble when they're hit.
- Anyone taken down lies still for a while, then gets back up or quietly reappears elsewhere. There's no blood.

**Traffic and planes**
- Traffic drives every town and the ring road. Drivers honk when you block them and panic near gunfire. Shot-up cars burn and then explode.
- Airliners stop for you on the taxiway, abort a take-off if you're on the runway, and trail smoke if hit.

**Weapons**
- Hitscan bullets with tracers, bullet holes and head shots.
- Rockets and tank shells explode: they throw people and cars, scatter props and blow apart construction sites.
- **Pickups:** health by hospitals, armour by police stations, ammo, rockets at the fort, and nitro canisters on the highway.
- **Bullseye Arms** gun shops sell ammo and armour for coins.

**You**
- Health and armour; health regenerates up to half.
- Fall damage, and blasts knock you over.
- When knocked out you wake up at the nearest hospital and pay a bill. If arrested you're released from the police station with a fine.

**Sound**
- Each vehicle has its own synthesised engine:
  - the buggy is an inline-four with little bass;
  - the motorbike is a raspy parallel twin with crackling over-run;
  - the tank is a V12 diesel with clanking tracks.
- Also: nitro hiss, a different gunshot per weapon, explosions that arrive late over distance, ricochets, sirens, the police helicopter, and the original seasonal ambience and music.

## Missions

| Marker | Mission | Goal |
| --- | --- | --- |
| **B** motorbike | Hot Wheels Delivery | 5 orders across Maple Hollow against a clock that grows with each delivery |
| **B** | Mountain Pass Sprint | Beat 3 AI riders up Pine Pass to the Lookout |
| **B** | Dust Devil Motocross | 3 laps of the Dustwater arena against the clock, with a bonus for jumps |
| **B** | Paparazzi | Tail a celebrity, snap 3 photos without being spotted, then lose the police |
| **C** car | Getaway Driver | Wait at the bank, lose a 3-star chase, drop the crew at the Harbor Bay warehouses |
| **C** | Street King | One lap of the Valley Ring against 3 AI street racers |
| **C** | Repo Man | Steal a marked car in Harbor Bay and deliver it to Dustwater in one piece |
| **C** | Derby Takedown | Ram or shoot 4 gang cars into wrecks |
| **T** tank | Live Fire Exercise | Destroy 8 target hulks around Fort Granite in 2 minutes |
| **T** | Rampage | Destroy 15 vehicles in 2 minutes |
| **F** on foot | Dockside Turf | Take down 8 armed gang members in the container yard, grab the briefcase and escape |
| **F** | Shooting Range | Hit 15 pop-up targets in 60 seconds |

The original activities (Town Courier, Town Taxi and Checkpoint Rally) and the ember hunt, now 40 embers, are still there. Coins, records and finished missions are saved in your browser.

## How the wanted system works

The police systems borrow well-known open-world crime-game ideas: wanted stars, a search area, hiding in a respray garage, and waking up at the hospital or police station. Everything is written from scratch with its own names and art.

- **Crimes add heat when someone sees or hears them.** They include gunfire, punching people, running someone down, carjacking, wrecking cars, explosions, attacking the police, stealing a police car and taking the tank out of the fort.
- **The response escalates with your stars:**
  - **1★** patrol cars chase you, and officers try to arrest you if you stand still near them;
  - **2★** officers shoot;
  - **3★** more cars, plus a helicopter with a searchlight that you can shoot down;
  - **4★** roadblocks ahead, and a marksman in the helicopter;
  - **5★** army jeeps with soldiers from Fort Granite.
- **Losing them:** the minimap shows the search area around where you were last seen. Once no officer can see you (the stars flash), get outside the circle and stay hidden until the stars clear. Or drive into a Spray & Fix while nobody is watching.
- **Police cars** find their way to you along the road network (A* routing). Up close they drive straight at you to box you in.

## Credits

Music: "Sudo" (Autumn), "Baguira" (Spring) and "Boy" (Monsoon) from [Bruno Simon's folio-2025](https://github.com/brunosimon/folio-2025/tree/main/static/sounds/musics), released under CC0 1.0. See `public/sounds/music/LICENSE.md`.
