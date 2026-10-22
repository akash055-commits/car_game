import { Howl } from 'howler';

export class AudioEngine {
  constructor() {
    this.sounds = {};
    this.isInitialized = false;
  }

  async init() {
    // In a real scenario, these would be URLs to actual assets.
    // For this prototype, I will use placeholders or instructions to add them.
    this.sounds.backgroundMusic = new Howl({
      src: ['https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'], // Placeholder
      loop: true,
      volume: 0.3,
      html5: true
    });

    this.sounds.engine = new Howl({
      src: ['https://actions.google.com/sounds/v1/transportation/car_engine_idle.ogg'], // Placeholder
      loop: true,
      volume: 0.5
    });

    this.sounds.collision = new Howl({
      src: ['https://actions.google.com/sounds/v1/impacts/crash_metal.ogg'], // Placeholder
      volume: 0.6
    });

    this.isInitialized = true;
  }

  playBackgroundMusic() {
    if (this.isInitialized) {
      this.sounds.backgroundMusic.play();
    }
  }

  playEngineSound() {
    if (this.isInitialized) {
      this.sounds.engine.play();
    }
  }

  updateEngineVolume(volume) {
    if (this.isInitialized && this.sounds.engine.playing()) {
      this.sounds.engine.volume(volume);
    }
  }

  stopEngineSound() {
    if (this.isInitialized) {
      this.sounds.engine.stop();
    }
  }

  playCollisionSound() {
    if (this.isInitialized) {
      this.sounds.collision.play();
    }
  }
}
