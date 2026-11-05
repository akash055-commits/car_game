import RAPIER from '@dimforge/rapier3d-compat';

export const FIXED_DT = 1 / 60;

export class Physics {
  constructor() {
    this.world = null;
    this.eventQueue = null;
    this.collisionHandlers = [];
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
    this.world.timestep = FIXED_DT;
    this.eventQueue = new RAPIER.EventQueue(true);
    return this.world;
  }

  onCollision(fn) {
    this.collisionHandlers.push(fn);
  }

  step() {
    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      for (const fn of this.collisionHandlers) fn(h1, h2, started);
    });
  }
}
