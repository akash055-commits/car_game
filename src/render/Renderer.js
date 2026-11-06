// Renderer + post-processing chain:
// Render (MSAA, HDR) -> NaN guard -> Bloom (emissives only) -> Output (ACES + sRGB) -> Tilt-shift H/V -> Grade
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { TiltShiftShader, GradeShader, SanitizeShader } from './Shaders.js'

export class Renderer {
  constructor(container, quality) {
    this.quality = quality
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false })
    r.setPixelRatio(quality.pixelRatio)
    r.setSize(window.innerWidth, window.innerHeight)
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 1.0
    r.outputColorSpace = THREE.SRGBColorSpace
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(r.domElement)
    this.renderer = r

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.3, 2600)

    const size = r.getDrawingBufferSize(new THREE.Vector2())
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality.msaa ? 4 : 0,
    })
    this.composer = new EffectComposer(r, target)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // guard against NaN / Inf pixels before anything blurs them (see SanitizeShader)
    this.sanitize = new ShaderPass(SanitizeShader)
    this.composer.addPass(this.sanitize)

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.55, 1.0)
    this.bloom.enabled = quality.bloom
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.tiltH = new ShaderPass(TiltShiftShader)
    this.tiltV = new ShaderPass(TiltShiftShader)
    this.tiltH.enabled = this.tiltV.enabled = quality.tiltShift
    this.composer.addPass(this.tiltH)
    this.composer.addPass(this.tiltV)

    this.grade = new ShaderPass(GradeShader)
    this.composer.addPass(this.grade)

    this.onResize()
    window.addEventListener('resize', () => this.onResize())
  }

  setTiltShift(enabled) {
    this.tiltH.enabled = this.tiltV.enabled = enabled
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(this.quality.pixelRatio)
    this.renderer.setSize(w, h)
    this.composer.setPixelRatio(this.quality.pixelRatio)
    this.composer.setSize(w, h)
    const pw = w * this.quality.pixelRatio, ph = h * this.quality.pixelRatio
    // Blur strength scales with resolution so the look is consistent on every screen
    const amount = 2.0 * (ph / 1080) + 0.6
    this.tiltH.uniforms.uDir.value = [amount / pw, 0]
    this.tiltV.uniforms.uDir.value = [0, amount / ph]
    this.tiltH.uniforms.uAmount.value = this.tiltV.uniforms.uAmount.value = 1
    this.grade.uniforms.uResolution.value = [pw, ph]
  }

  render(time) {
    this.grade.uniforms.uTime.value = time
    this.composer.render()
  }
}
