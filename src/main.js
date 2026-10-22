import * as THREE from 'three';
import { Physics } from './engine/Physics.js';
import { World } from './engine/World.js';
import { Car } from './engine/Car.js';
import { AudioEngine } from './engine/Audio.js';
import { Environment } from './engine/Environment.js';
import { UI } from './engine/UI.js';
import RAPIER from '@dimforge/rapier3d-compat';

async function init() {
  console.log("Initializing Game...");

  const physics = new Physics();
  await physics.init();
  console.log("Physics initialized.");

  const world = new World(physics);
  console.log("World initialized.");

  const ui = new UI();
  console.log("UI initialized.");

  const audio = new AudioEngine();
  await audio.init();
  console.log("Audio initialized.");

  const environment = new Environment(world, physics);
  console.log("Environment initialized.");

  let car = null;

  function animate() {
    requestAnimationFrame(animate);

    physics.step();

    if (car && car.mesh) {
      // --- COLLISION DETECTION & SHAKE ---
      const events = physics.getContactEvents();
      for (const event of events) {
        if (event.flag === RAPIER.CollisionEventFlag.Started) {
          const carBody = car.rigidBody;
          if (event.colliderHandle1 === car.rigidBody.collider(0) ||
              event.colliderHandle2 === car.rigidBody.collider(0)) {
            audio.playCollisionSound();
            // Trigger a camera shake on collision
            world.shake(0.15, 0.3);
          }
        }
      }

      // Update Car
      car.update();

      // Reactive Audio
      const vel = car.rigidBody.linvel();
      const speed = Math.sqrt(vel.x**2 + vel.y**2 + vel.z**2);
      audio.updateEngineVolume(0.3 + Math.min(speed / 20, 0.7));

      // Update UI
      ui.updateSpeed(speed);

      // Camera Follow
      const carPos = car.mesh.position;
      const carQuat = car.mesh.quaternion;
      const offset = new THREE.Vector3(0, 3, -7);
      offset.applyQuaternion(carQuat);

      const targetCameraPos = carPos.clone().add(offset);
      world.camera.position.lerp(targetCameraPos, 0.08);
      const lookAtTarget = carPos.clone().add(new THREE.Vector3(0, 1, 0));
      world.camera.lookAt(lookAtTarget);
    } else {
      world.camera.position.set(0, 10, 20);
      world.camera.lookAt(0, 0, 0);
    }

    // Apply camera shake
    world.updateShake();

    // Render scene (using composer for bloom)
    world.render();
  }

  ui.onStart(async () => {
    console.log("User clicked Start. Attempting to create car...");
    try {
      car = new Car(world, physics);
      console.log("Car successfully created and added to scene.");
      audio.playBackgroundMusic();
      audio.playEngineSound();
      animate();
    } catch (err) {
      console.error("Failed to create car:", err);
    }
  });
}

init().catch(err => console.error("Initialization failed:", err));
