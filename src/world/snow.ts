import * as THREE from 'three';

/** Light snowfall: soft flakes drifting down around the camera, wrapping inside a box that follows it. */
export function buildSnowfall(time: { value: number }, count = 5000): THREE.Points {
  const box = new THREE.Vector3(420, 160, 420);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: time, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uMap: { value: new THREE.CanvasTexture(canvas) } },
    vertexShader: /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uBox;
varying float vAlpha;
void main() {
  float fall = 3.0 + seed.w * 3.0;
  vec3 p = seed.xyz * uBox;
  p.y -= uTime * fall;
  p.x += sin(uTime * 0.6 + seed.w * 20.0) * 3.0 + uTime * 1.2;
  p.z += cos(uTime * 0.5 + seed.x * 20.0) * 3.0;
  // Wrap inside a box centred on the camera so snow is always around the view.
  vec3 origin = uCam - uBox * 0.5;
  p = origin + mod(p - origin, uBox);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = 1.4 + seed.y * 1.6;
  gl_PointSize = size * 300.0 / -mv.z;
  vAlpha = 0.85 * smoothstep(900.0, 60.0, -mv.z);
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(1.0, 1.0, 1.0, t.a * vAlpha);
}`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 4;
  points.name = 'Snowfall';
  points.onBeforeRender = (_r, _s, camera) => { (material.uniforms.uCam.value as THREE.Vector3).copy(camera.position); };
  return points;
}
