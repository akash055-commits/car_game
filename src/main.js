import '@fontsource/nunito/600.css'
import '@fontsource/nunito/800.css'
import './ui/ui.css'
import { Game } from './Game.js'

const app = document.getElementById('app')
const game = new Game(app)
window.__game = game
game.init((p, label) => console.log('loading', p, label)).then(() => {
  game.start()
  console.log('ready')
})
