import * as THREE from 'three';

/**
 * Environment — sky dome, atmospheric sun, directional + fill lighting, and
 * an IBL environment map generated from the sky for physically-based
 * reflections on every material in the scene.
 */

const SKY_VERT = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A physically-inspired gradient sky with a hazy sun disc + horizon glow.
const SKY_FRAG = /* glsl */`
  varying vec3 vWorldPos;
  uniform vec3 uSunDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform float uSunSize;

  void main() {
    vec3 dir = normalize(vWorldPos);
    float h = dir.y;

    // sky gradient
    float t = clamp(h, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, pow(t, 0.55));
    // ground / below horizon
    vec3 col = h < 0.0 ? mix(uHorizon, uGround, clamp(-h * 3.0, 0.0, 1.0)) : sky;

    // sun disc + halo — tighter and less blown out
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.5, sd);
    float glow = pow(sd, 350.0) * 0.5 + pow(sd, 40.0) * 0.18 + pow(sd, 6.0) * 0.08;
    col += uSunColor * (disc * 3.2 + glow);

    // subtle horizon haze band
    float haze = exp(-abs(h) * 8.0) * 0.15;
    col += uHorizon * haze;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.sunDir = new THREE.Vector3(0.45, 0.62, 0.35).normalize();
    this._build();
  }

  _build() {
    // ---- Sky dome
    const skyUniforms = {
      uSunDir: { value: this.sunDir.clone() },
      uZenith: { value: new THREE.Color(0x4a86c8).convertSRGBToLinear() },
      uHorizon: { value: new THREE.Color(0xeae3d2).convertSRGBToLinear() },
      uGround: { value: new THREE.Color(0x2a241d).convertSRGBToLinear() },
      uSunColor: { value: new THREE.Color(0xfff3dd).convertSRGBToLinear() },
      uSunSize: { value: 0.018 },
    };
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), skyMat);
    sky.name = 'sky';
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);
    this.sky = sky;
    this.skyUniforms = skyUniforms;

    // ---- IBL from the sky
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat.clone());
    envSky.material.side = THREE.BackSide;
    envScene.add(envSky);
    const envRT = pmrem.fromScene(envScene, 0, 0.1, 1000);
    this.scene.environment = envRT.texture;
    this.envRT = envRT;
    pmrem.dispose();

    // ---- Sun (key light)
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.1);
    sun.position.copy(this.sunDir).multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 400;
    const s = 90;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    // ---- Sky fill (hemisphere) for realistic ambient bounce
    const hemi = new THREE.HemisphereLight(0xc4d2e0, 0x7a6748, 1.15);
    this.scene.add(hemi);

    // ---- Warm bounce fill from the "ground" (opposite the sun)
    const fill = new THREE.DirectionalLight(0xffd9a0, 0.65);
    fill.position.set(-0.5, 0.25, -0.6).multiplyScalar(60);
    this.scene.add(fill);

    // ---- Warm ambient floor so undersides/interiors never crush to black
    this.scene.add(new THREE.AmbientLight(0x4a4436, 0.9));

    // ---- Atmospheric fog for depth
    this.scene.fog = new THREE.FogExp2(0xd2cab6, 0.006);

    // ---- Ambient god-ray-ish volumetric sun sprite
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._sunGlowTexture(),
      color: 0xfff0d0, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, depthTest: false,
    }));
    sunSprite.scale.set(600, 600, 1);
    sunSprite.position.copy(this.sunDir).multiplyScalar(3000);
    this.scene.add(sunSprite);
  }

  _sunGlowTexture() {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.2, 'rgba(255,240,210,0.5)');
    g.addColorStop(0.5, 'rgba(255,220,170,0.15)');
    g.addColorStop(1, 'rgba(255,220,170,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  update(dt) {
    // keep the sky centered on the camera happens externally; nothing dynamic yet
    void dt;
  }
}
