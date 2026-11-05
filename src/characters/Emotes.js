// Speech-bubble emotes that pop above people's heads (!, angry, ?, love, dizzy stars,
// music, party, coins). One instanced billboard mesh with an icon atlas.
import * as THREE from 'three'

export const EMOTE = { alarm: 0, angry: 1, question: 2, love: 3, dizzy: 4, music: 5, party: 6, coin: 7, wave: 8, sad: 9 }
const ICONS = ['!', '!!', '?', '♥', '✦', '♪', '★', '$', 'hi', '…']
const COLORS = ['#e8742c', '#d6452f', '#4a7bd0', '#e0568c', '#e8b52c', '#2f8f95', '#e8a33a', '#4f9a43', '#e8742c', '#6b5545']

function atlas() {
  const n = ICONS.length
  const s = 128
  const cv = document.createElement('canvas')
  cv.width = s * n
  cv.height = s
  const ctx = cv.getContext('2d')
  ICONS.forEach((icon, i) => {
    const x = i * s
    ctx.fillStyle = '#fffaf2'
    ctx.beginPath()
    ctx.arc(x + s / 2, s / 2 - 6, 48, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x + s / 2 - 12, s / 2 + 34)
    ctx.lineTo(x + s / 2, s / 2 + 56)
    ctx.lineTo(x + s / 2 + 12, s / 2 + 34)
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = COLORS[i]
    ctx.beginPath()
    ctx.arc(x + s / 2, s / 2 - 6, 45, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = COLORS[i]
    ctx.font = `bold ${icon.length > 1 ? 50 : 64}px Nunito, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (i === EMOTE.angry) {
      // classic "anger vein" mark
      ctx.lineWidth = 10
      ctx.lineCap = 'round'
      for (const [a, b] of [[[-18, -26], [-6, -10]], [[18, -26], [6, -10]], [[-18, 14], [-6, -2]], [[18, 14], [6, -2]]]) {
        ctx.beginPath()
        ctx.moveTo(x + s / 2 + a[0], s / 2 - 6 + a[1])
        ctx.quadraticCurveTo(x + s / 2, s / 2 - 6, x + s / 2 + b[0], s / 2 - 6 + b[1])
        ctx.stroke()
      }
    } else ctx.fillText(icon, x + s / 2, s / 2 - 2)
  })
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return { tex, n }
}

export class Emotes {
  constructor(scene, max = 80) {
    const { tex, n } = atlas()
    this.max = max
    this.active = []
    const geo = new THREE.InstancedBufferGeometry()
    const base = new THREE.PlaneGeometry(1, 1)
    geo.index = base.index
    geo.setAttribute('position', base.attributes.position)
    geo.setAttribute('uv', base.attributes.uv)
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aPos', this.aPos)
    geo.setAttribute('aData', this.aData)
    geo.instanceCount = 0
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: { uTex: { value: tex }, uCount: { value: n } },
      vertexShader: /* glsl */ `
        attribute vec3 aPos;
        attribute vec2 aData; // icon, scale
        uniform float uCount;
        varying vec2 vUv;
        void main() {
          vec4 mv = viewMatrix * vec4(aPos, 1.0);
          mv.xy += position.xy * aData.y * 0.9;
          gl_Position = projectionMatrix * mv;
          vUv = vec2((uv.x + aData.x) / uCount, uv.y);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(uTex, vUv);
          if (c.a < 0.05) discard;
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10
    scene.add(this.mesh)
  }

  // Show an emote above a character (replaces that character's current emote)
  show(c, icon, duration = 2) {
    if (c.emote) c.emote.life = 0
    const e = { c, icon, life: duration, max: duration, t: 0 }
    c.emote = e
    this.active.push(e)
    if (this.active.length > this.max) this.active.shift()
  }

  update(dt) {
    let n = 0
    const P = this.aPos.array, D = this.aData.array
    this.active = this.active.filter((e) => e.life > 0)
    for (const e of this.active) {
      e.life -= dt
      e.t += dt
      if (e.life <= 0) {
        if (e.c.emote === e) e.c.emote = null
        continue
      }
      if (!e.c.visible) continue
      const pop = Math.min(1, e.t * 6)
      const out = Math.min(1, e.life * 4)
      const s = (0.8 + Math.sin(Math.min(1, e.t * 6) * Math.PI) * 0.25) * pop * out
      P[n * 3] = e.c.x
      P[n * 3 + 1] = e.c.y + 2.25 * (e.c.scale || 1) + Math.sin(e.t * 4) * 0.05 + (e.c.lie || 0) * -1.2
      P[n * 3 + 2] = e.c.z
      D[n * 2] = e.icon
      D[n * 2 + 1] = s
      n++
    }
    this.mesh.geometry.instanceCount = n
    this.aPos.needsUpdate = true
    this.aData.needsUpdate = true
  }
}
