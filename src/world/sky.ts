import * as THREE from 'three';

export interface SkyParams {
  top: string;
  horizon: string;
  bottom: string;
  /** 0..1 strength of green/violet aurora ribbons (glacier). */
  aurora?: number;
  /** 0..1 star field strength. */
  stars?: number;
}

/** Gradient sky dome with optional aurora and stars; follows the camera so it never clips. */
export function buildSkyDome(params: SkyParams, time: { value: number }): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(params.top) },
      uHorizon: { value: new THREE.Color(params.horizon) },
      uBottom: { value: new THREE.Color(params.bottom) },
      uAurora: { value: params.aurora ?? 0 },
      uStars: { value: params.stars ?? 0 },
      uTime: time,
    },
    vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uTop, uHorizon, uBottom;
uniform float uAurora, uStars, uTime;
varying vec3 vDir;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main() {
  float y = vDir.y;
  vec3 col = y > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.75, y), 0.8)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.3, y));
  // Stars.
  vec2 sp = vec2(atan(vDir.z, vDir.x) * 90.0, y * 180.0);
  float star = step(0.992, hash(floor(sp))) * smoothstep(0.1, 0.5, y);
  col += vec3(star) * uStars * (0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(sp)) * 20.0));
  // Aurora ribbons.
  if (uAurora > 0.0) {
    float a = atan(vDir.z, vDir.x);
    float band = sin(a * 3.0 + vnoise(vec2(a * 4.0, uTime * 0.05)) * 3.0 + uTime * 0.07);
    float curtain = smoothstep(0.35, 0.0, abs(y - 0.38 - band * 0.08));
    float streaks = 0.5 + 0.5 * vnoise(vec2(a * 40.0, y * 3.0 - uTime * 0.2));
    vec3 aur = mix(vec3(0.2, 1.0, 0.6), vec3(0.6, 0.35, 1.0), smoothstep(0.35, 0.6, y));
    col += aur * curtain * streaks * uAurora;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2600, 48, 24), material);
  mesh.name = 'SkyDome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.onBeforeRender = (_r, _s, camera) => { mesh.position.copy(camera.position); };
  return mesh;
}

export function loadPanorama(scene: THREE.Scene, rotation = 1.9, stillCurrent: () => boolean = () => true): void {
  new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/sky/azure-sky.png`, (t) => {
    if (!stillCurrent()) { t.dispose(); return; }
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    scene.background = t;
    scene.backgroundRotation.set(0, rotation, 0);
  });
}
