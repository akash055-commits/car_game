import './style.css';
import * as THREE from 'three';
import { Physics, FIXED_DT } from './engine/Physics.js';
import { World } from './engine/World.js';
import { Environment } from './engine/Environment.js';
import { Car } from './engine/Car.js';
import { AudioEngine } from './engine/Audio.js';
import { Input } from './engine/Input.js';
import { CameraRig, CAMERA_MODES } from './engine/CameraRig.js';
import { Effects } from './engine/Effects.js';
import { UI } from './engine/UI.js';
import { Game } from './engine/Game.js';
import { safeStorage } from './engine/utils.js';

const store = safeStorage();
const settings = Object.assign(
  { quality: 'high', time: 'day', music: 0.5, sfx: 0.85, showFps: false, carColor: '#d01818', stripes: true, camera: 0 },
  store.get('vr.settings', {}),
);
const saveSettings = () => store.set('vr.settings', settings);

const loadFill = document.getElementById('ld-fill');
const loadText = document.getElementById('ld-text');
const progress = (pct, text) => {
  loadFill.style.width = `${pct}%`;
  loadText.textContent = text;
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
};

async function init() {
  await progress(10, 'Initialising physics…');
  const physics = new Physics();
  await physics.init();

  await progress(25, 'Painting the sky…');
  const world = new World(settings);

  await progress(45, 'Sculpting terrain & laying asphalt…');
  const env = new Environment(world, physics, world.quality);

  await progress(75, 'Polishing the car…');
  const car = new Car(world, physics, env, settings.carColor);
  car.model.materials.stripe.visible = settings.stripes;
  car.setLights(world.preset.lights);
  const audio = new AudioEngine(settings);
  const input = new Input();
  const rig = new CameraRig(world.camera, env);
  rig.mode = settings.camera % CAMERA_MODES.length;
  const effects = new Effects(world.scene, env);
  effects.setNight(settings.time === 'night');
  const ui = new UI(settings, audio);
  ui.setupMinimap(env);
  input.bindTouch(document.getElementById('app'));
  const game = new Game({ world, env, car, ui, audio, effects, rig, input });
  game.spawnAtStart();
  car.frozen = true;
  world.onResized = (w, h) => effects.resize(h);

  // Collisions: the event queue reports the car's colliders touching anything
  physics.onCollision((h1, h2, started) => {
    if (!started) return;
    const carHit = car.colliderHandles.has(h1) || car.colliderHandles.has(h2);
    if (!carHit) return;
    const other = car.colliderHandles.has(h1) ? h2 : h1;
    if (env.groundHandles.has(other)) {
      if (car.lastDeltaV > 6) game.onCrash(car.lastDeltaV * 0.6, car.mesh.position.clone());
      return;
    }
    const f = car.forward;
    const point = car.mesh.position.clone().addScaledVector(f, car.forwardSpeed >= 0 ? 2.1 : -2.1);
    game.onCrash(Math.max(car.lastDeltaV, car.speed * 0.25), point);
  });

  // UI wiring
  ui.on('free', () => { game.start('free'); startAudio(); });
  ui.on('trial', () => { game.start('trial'); startAudio(); });
  ui.on('resume', () => game.resume());
  ui.on('restart', () => game.start(game.mode));
  ui.on('quit', () => game.toMenu());
  ui.on('camera', () => { document.getElementById('cam-name').textContent = cycleCamera(); });
  ui.on('color', (c) => { settings.carColor = c; car.setColor(c); saveSettings(); });
  ui.on('setting', (key, value) => {
    settings[key] = value;
    saveSettings();
    if (key === 'quality') world.setQuality(value);
    if (key === 'time') {
      world.setTimeOfDay(value);
      car.setLights(world.preset.lights);
      effects.setNight(value === 'night');
    }
    if (key === 'music' || key === 'sfx') { audio.ensure(); audio.applyVolumes(); }
    if (key === 'stripes') car.model.materials.stripe.visible = value;
  });
  document.getElementById('cam-name').textContent = CAMERA_MODES[rig.mode];

  function startAudio() {
    audio.ensure();
    audio.startMusic();
  }
  function cycleCamera() {
    const name = rig.cycle();
    settings.camera = rig.mode;
    saveSettings();
    return name;
  }

  await progress(100, 'Ready!');
  document.getElementById('loading').classList.add('done');
  ui.showScreen('menu');

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let acc = 0;
  let elapsed = 0;
  let fpsFrames = 0, fpsTime = 0, fps = 60;
  let boost = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;
    fpsFrames++; fpsTime += dt;
    if (fpsTime > 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }

    const st = input.update(dt);
    if (input.justPressed('Escape') || input.justPressed('KeyP')) {
      if (game.state === 'paused') game.resume(); else game.pause();
    }
    if (input.justPressed('KeyM')) { audio.ensure(); const m = audio.toggleMute(); ui.popup(m ? 'MUTED' : 'SOUND ON', 'blue'); }
    const driving = game.state === 'playing' || game.state === 'countdown';
    if (driving) {
      if (input.justPressed('KeyC')) ui.banner(cycleCamera().toUpperCase(), '', 1);
      if (input.justPressed('KeyR') && game.state === 'playing') game.resetCar();
    }
    Object.assign(car.input, st);
    if (game.state === 'menu') Object.assign(car.input, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false });

    const paused = game.state === 'paused';
    if (!paused) {
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < 5) {
        car.fixedUpdate(FIXED_DT);
        physics.step();
        car.postStep(FIXED_DT);
        acc -= FIXED_DT;
        steps++;
      }
      if (steps === 5) acc = 0;
      for (const e of car.consumeEvents()) {
        if (e === 'shift') audio.shift();
        if (e === 'backfire') { audio.backfire(); car.triggerBackfire(); }
      }
      car.updateVisual(acc / FIXED_DT, dt, elapsed);
      game.update(dt);
      env.update(dt, elapsed);
      effects.update(dt, car);
    }

    // Camera
    boost += ((car.nitroActive ? 1 : 0) - boost) * Math.min(1, dt * 5);
    if (game.state === 'menu' || game.state === 'finished') rig.updateOrbit(car, dt, game.state === 'menu' ? 7.2 : 9, game.state === 'menu' ? 1.6 : 3);
    else if (!paused) rig.update(car, dt, boost);
    world.followFocus(car.mesh.position);

    audio.update(car, { offRoad: game.offRoad, paused: paused || game.state === 'menu' && !audio.ctx });
    if (driving || paused) {
      ui.updateGauge(car, dt);
      ui.drawMinimap(car, game.minimapExtras());
    }
    ui.update(dt, fps);
    input.endFrame();

    const speedFx = driving ? Math.min(1, Math.max(0, (car.speed - 25) / 45)) * 0.6 + boost * 0.6 : 0;
    world.render(speedFx);
  }
  frame();

  // expose for debugging / automated tests
  window.__game = { game, car, world, env, physics, audio, input, rig };
}

init().catch((err) => {
  console.error('Initialization failed:', err);
  const t = document.getElementById('ld-text');
  if (t) t.textContent = `Failed to start: ${err.message}`;
});
