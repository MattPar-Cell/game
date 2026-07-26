import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * PostFX — the cinematic post-processing stack:
 *   RenderPass → GTAO (ambient occlusion) → Bloom → Grade → SMAA → Output
 *
 * The custom Grade pass adds vignette, subtle chromatic aberration at the
 * frame edges, film grain, a filmic contrast/saturation lift, and a radial
 * hurt-flash driven by the game.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uChroma: { value: 0.0006 },
    uGrain: { value: 0.018 },
    uContrast: { value: 1.05 },
    uSaturation: { value: 1.1 },
    uHurt: { value: 0.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uChroma, uGrain, uContrast, uSaturation, uHurt;
    uniform vec2 uResolution;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float r = length(center);

      // chromatic aberration scaled toward edges
      float ca = uChroma * (0.3 + r * 2.0);
      vec2 dir = normalize(center + 1e-5);
      vec3 col;
      col.r = texture2D(tDiffuse, uv - dir * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + dir * ca).b;

      // filmic contrast around 0.5
      col = (col - 0.5) * uContrast + 0.5;
      // saturation
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // vignette
      float vig = smoothstep(0.9, 0.25, r);
      col *= mix(1.0, vig, uVignette);

      // hurt flash (red radial pulse)
      float hurt = uHurt * smoothstep(0.2, 0.9, r);
      col = mix(col, vec3(0.6, 0.02, 0.04), hurt);

      // film grain — coarse, and reduced in deep shadow so it doesn't crawl
      float lum2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float grainAmt = uGrain * smoothstep(0.0, 0.18, lum2);
      float g = hash(floor(uv * uResolution * 0.5) + fract(uTime) * 137.0);
      col += (g - 0.5) * grainAmt;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());
    const dpr = renderer.getPixelRatio();
    const w = size.x * dpr, h = size.y * dpr;

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Ambient occlusion
    this.gtao = new GTAOPass(scene, camera, w, h);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    if (this.gtao.updateGtaoMaterial) {
      this.gtao.updateGtaoMaterial({
        radius: 0.5, distanceExponent: 1, thickness: 1,
        scale: 1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false,
      });
    }
    this.composer.addPass(this.gtao);

    // Bloom
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.6, 0.82);
    this.composer.addPass(this.bloom);

    // Grade
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uResolution.value.set(w, h);
    this.composer.addPass(this.grade);

    // AA + output
    this.smaa = new SMAAPass(w, h);
    this.composer.addPass(this.smaa);
    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this._time = 0;
    this.hurt = 0;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    const dpr = this.renderer.getPixelRatio();
    this.grade.uniforms.uResolution.value.set(w * dpr, h * dpr);
  }

  triggerHurt(amount = 1) { this.hurt = Math.min(1, this.hurt + amount); }

  render(dt) {
    this._time += dt;
    this.grade.uniforms.uTime.value = this._time;
    this.hurt = Math.max(0, this.hurt - dt * 2.2);
    this.grade.uniforms.uHurt.value = this.hurt;
    this.composer.render();
  }
}
