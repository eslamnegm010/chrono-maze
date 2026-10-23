import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ChronoShader } from './ChronoShader.js';

/**
 * Owns the WebGL renderer, the world scene/camera and a separate
 * weapon scene/camera. The weapon is drawn after clearing depth so the gun
 * never clips into walls.
 */
export class RenderPipeline {
  constructor(container) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060d);
    this.scene.fog = new THREE.FogExp2(0x05060d, 0.0135);

    this.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 700);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.weaponScene = new THREE.Scene();
    this.weaponCam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    container.appendChild(this.renderer.domElement);

    this.composer = null;
    this.fxPass = null;
    this.bloomEnabled = false;
    this._initComposer();

    window.addEventListener('resize', () => this.resize());
  }

  get canvas() {
    return this.renderer.domElement;
  }

  _initComposer() {
    try {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const weaponPass = new RenderPass(this.weaponScene, this.weaponCam);
      weaponPass.clear = false;
      weaponPass.clearDepth = true;
      composer.addPass(weaponPass);
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.45, 0.42));
      this.fxPass = new ShaderPass(ChronoShader);
      composer.addPass(this.fxPass);
      this.composer = composer;
      this.bloomEnabled = true;
    } catch (e) {
      console.warn('Post-processing unavailable, using direct rendering.', e);
      this.composer = null;
    }
  }

  setBloom(enabled) {
    this.bloomEnabled = enabled && !!this.composer;
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    for (const cam of [this.camera, this.weaponCam]) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  }

  /** @param {{slow:number, damage:number, lowHp:number, time:number}} fx */
  render(fx) {
    const r = this.renderer;
    if (this.bloomEnabled) {
      const u = this.fxPass.uniforms;
      u.uSlow.value = fx.slow;
      u.uDamage.value = fx.damage;
      u.uLowHp.value = fx.lowHp;
      u.uTime.value = fx.time;
      r.autoClear = true;
      this.composer.render();
      return;
    }
    r.autoClear = false;
    r.setRenderTarget(null);
    r.clear();
    r.render(this.scene, this.camera);
    r.clearDepth();
    r.render(this.weaponScene, this.weaponCam);
  }
}
