// Quiet background playlist (CC0 tracks from brunosimon/folio-2025). Streams one track at
// a time, fades in gently and moves on to the next track when one ends.
import { Howl } from 'howler'

const BASE = import.meta.env.BASE_URL
const TRACKS = [
  { name: 'Sudo', src: `${BASE}sounds/music/sudo.mp3` },
  { name: 'Boy', src: `${BASE}sounds/music/boy.mp3` },
  { name: 'Baguira', src: `${BASE}sounds/music/baguira.mp3` },
]
const MAX_VOLUME = 0.4 // slider 1.0 -> 0.4, default slider 0.3 -> 0.12 (very quiet)

export class MusicPlayer {
  constructor(settings) {
    this.settings = settings
    this.index = Math.floor(Math.random() * TRACKS.length)
    this.howl = null
    this.onTrack = null
    this.started = false
  }

  get target() {
    return this.settings.musicMuted ? 0 : this.settings.music * MAX_VOLUME * this.settings.master
  }

  start() {
    if (this.started) return
    this.started = true
    this.play(this.index)
  }

  play(i) {
    if (this.howl) {
      const old = this.howl
      old.fade(old.volume(), 0, 1500)
      setTimeout(() => old.unload(), 1600)
    }
    const track = TRACKS[i]
    const howl = new Howl({
      src: [track.src],
      html5: true,
      volume: 0,
      onend: () => this.next(),
      onloaderror: () => setTimeout(() => this.next(), 4000),
    })
    howl.once('play', () => {
      howl.fade(0, this.target, 4000)
      if (this.onTrack) this.onTrack(track.name)
    })
    howl.play()
    this.howl = howl
  }

  next() {
    this.index = (this.index + 1) % TRACKS.length
    this.play(this.index)
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
    return TRACKS[this.index].name
  }
}
