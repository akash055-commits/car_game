// Quiet background music, one CC0 track per season (from brunosimon/folio-2025):
// Autumn "Sudo", Spring "Baguira", Monsoon "Boy". Streams one track at a time, loops it
// with a gentle pause, and cross-fades when the season changes.
import { Howl } from 'howler'

const BASE = import.meta.env.BASE_URL
const TRACKS = {
  autumn: { name: 'Sudo', src: `${BASE}sounds/music/sudo.mp3`, gain: 1 },
  spring: { name: 'Baguira', src: `${BASE}sounds/music/baguira.mp3`, gain: 0.66 }, // louder master
  monsoon: { name: 'Boy', src: `${BASE}sounds/music/boy.mp3`, gain: 1 },
}
const MAX_VOLUME = 0.28 // slider 1.0 -> 0.28; the default slider 0.3 sits around 0.08: subtle
const LOOP_GAP = 6000

export class MusicPlayer {
  constructor(settings) {
    this.settings = settings
    this.season = 'autumn'
    this.howl = null
    this.track = null
    this.onTrack = null
    this.started = false
  }

  get target() {
    const g = this.track ? this.track.gain : 1
    return this.settings.musicMuted ? 0 : this.settings.music * MAX_VOLUME * this.settings.master * g
  }

  start(season = this.season) {
    if (this.started) return
    this.started = true
    this.season = season
    this.play(TRACKS[season])
  }

  setSeason(season) {
    if (season === this.season && this.howl) return
    this.season = season
    if (this.started) this.play(TRACKS[season])
  }

  play(track) {
    clearTimeout(this.gapTimer)
    if (this.howl) {
      const old = this.howl
      old.off('end')
      old.fade(old.volume(), 0, 2500)
      setTimeout(() => old.unload(), 2600)
    }
    this.track = track
    const howl = new Howl({
      src: [track.src],
      html5: true,
      volume: 0,
      onloaderror: () => { this.gapTimer = setTimeout(() => this.play(TRACKS[this.season]), 5000) },
    })
    howl.on('end', () => {
      if (this.howl !== howl) return
      this.gapTimer = setTimeout(() => {
        if (this.howl !== howl) return
        howl.volume(0)
        howl.play()
        howl.fade(0, this.target, 4000)
      }, LOOP_GAP)
    })
    howl.once('play', () => {
      howl.fade(0, this.target, 4000)
      if (this.onTrack) this.onTrack(track.name)
    })
    howl.play()
    this.howl = howl
  }

  refreshVolume() {
    if (this.howl) this.howl.fade(this.howl.volume(), this.target, 400)
  }

  pause() {
    if (this.howl && this.howl.playing()) this.howl.pause()
  }

  resume() {
    if (this.howl && this.started && !this.howl.playing()) this.howl.play()
  }

  get trackName() {
    return this.track ? this.track.name : ''
  }
}
