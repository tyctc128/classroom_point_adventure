import * as THREE from 'three';
import { CREEK, CREEK_HALF_WIDTH, creekLevel, FALLS_S, heightAt, LAKE, Polyline, RIVER, riverHalfWidth, riverLevel, riverOpen, SEA_LEVEL } from './layout';
import { mulberry32 } from './noise';
import { GRASSLAND, type TerrainTheme } from './palette';

let W: TerrainTheme['water'] = GRASSLAND.water;

export const waterUniforms = { uTime: { value: 0 } };
const poolLevel = riverLevel(FALLS_S + 4);

const WATER_VERTEX = /* glsl */ `
attribute float depth;
attribute float mask;
varying float vDepth;
varying float vMask;
varying vec2 vUv;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vDepth = depth;
  vMask = mask;
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform float uFlow;
varying float vDepth;
varying float vMask;
varying vec2 vUv;
varying vec3 vWorld;
#include <fog_pars_fragment>
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }
void main() {
  if (vMask < 0.5) discard;
  float d = clamp(vDepth / 3.0, 0.0, 1.0);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, d));
  // Flowing ripples: rivers stream along uv.y, the lake drifts slowly.
  vec2 p = vUv * vec2(1.0, 1.0);
  p.y -= uTime * uFlow;
  float r1 = vnoise(vWorld.xz * 0.45 + vec2(uTime * 0.12, -uTime * 0.07) + p * 0.2);
  float r2 = vnoise(vWorld.xz * 1.3 - vec2(uTime * 0.2, uTime * 0.16) + p * 0.9);
  float ripple = r1 * 0.6 + r2 * 0.4;
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fresnel = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 3.0);
  col = mix(col, uSky, fresnel * 0.55);
  // Glints: sparkle in the ripples plus a sun highlight on the perturbed surface.
  float glint = smoothstep(0.78, 0.92, ripple);
  col += vec3(0.85, 0.95, 1.0) * glint * 0.3;
  vec3 n = normalize(vec3((r1 - 0.5) * 0.5, 1.0, (r2 - 0.5) * 0.5));
  vec3 sunDir = normalize(vec3(-0.55, 0.62, 0.45));
  float spec = pow(max(dot(reflect(-sunDir, n), viewDir), 0.0), 60.0);
  col += vec3(1.0, 0.96, 0.85) * spec * 1.4;
  // Foam where the water is shallow: shorelines and rocks.
  float foamLine = smoothstep(0.35, 0.0, vDepth + (r2 - 0.5) * 0.35);
  float streaks = smoothstep(0.62, 0.9, vnoise(vec2(vUv.x * 7.0, (vUv.y - uTime * uFlow * 1.4) * 1.2)));
  float foam = max(foamLine, streaks * uFlow * 1.2 * (1.0 - d * 0.6));
  col = mix(col, vec3(0.96, 0.99, 1.0), clamp(foam, 0.0, 1.0) * 0.85);
  gl_FragColor = vec4(col, 0.93);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function waterMaterial(deep: string, shallow: string, flow: number, sky?: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uDeep: { value: new THREE.Color(deep) },
        uShallow: { value: new THREE.Color(shallow) },
        uSky: { value: new THREE.Color(sky ?? W.sky) },
        uFlow: { value: flow },
      },
    ]) as Record<string, THREE.IUniform>,
    transparent: true,
    fog: true,
    depthWrite: true,
    side: THREE.DoubleSide, // stream ribbons are wound the other way from the lake plane
  });
}

export function bindTime(material: THREE.ShaderMaterial): THREE.ShaderMaterial {
  material.uniforms.uTime = waterUniforms.uTime;
  return material;
}

function buildLake(): THREE.Mesh {
  const w = LAKE.rx * 2.7;
  const d = LAKE.rz * 2.9;
  const geometry = new THREE.PlaneGeometry(w, d, 110, 50);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const depth = new Float32Array(pos.count);
  const mask = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + LAKE.cx;
    const z = pos.getZ(i) + LAKE.cz;
    pos.setXYZ(i, x, LAKE.level, z);
    depth[i] = LAKE.level - heightAt(x, z);
    const e = ((x - LAKE.cx) / LAKE.rx) ** 2 + ((z - LAKE.cz) / LAKE.rz) ** 2;
    const nr = RIVER.nearest(x, z);
    mask[i] = e < 1.5 || (nr.s < FALLS_S - 0.3 && nr.d < 5) ? 1 : 0;
  }
  geometry.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  geometry.setAttribute('mask', new THREE.BufferAttribute(mask, 1));
  const mesh = new THREE.Mesh(geometry, bindTime(waterMaterial(W.lakeDeep, W.lakeShallow, 0.02)));
  mesh.name = 'Lake';
  mesh.renderOrder = 1;
  return mesh;
}

interface StreamSpec {
  line: Polyline;
  start: number;
  end: number;
  halfWidth: (s: number) => number;
  level: (s: number) => number;
  deep: string;
  shallow: string;
  flow: number;
  name: string;
}

/** Ribbon of flowing water following a polyline; depth per vertex drives colour and foam. */
function buildStream(spec: StreamSpec): THREE.Mesh {
  const { line, start, end } = spec;
  const steps = Math.ceil((end - start) / 0.6);
  const across = 14;
  const positions: number[] = [];
  const uvs: number[] = [];
  const depth: number[] = [];
  const mask: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = start + ((end - start) * i) / steps;
    const p = line.at(s);
    const t = line.tangent(s);
    const half = spec.halfWidth(s);
    const level = spec.level(s);
    for (let k = 0; k <= across; k++) {
      const u = k / across;
      const off = (u - 0.5) * 2 * half;
      const x = p.x - t.z * off;
      const z = p.z + t.x * off;
      positions.push(x, level, z);
      uvs.push(u, s / 8);
      depth.push(level - heightAt(x, z));
      mask.push(1);
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * (across + 1) + k;
      const b = a + across + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  geometry.setAttribute('mask', new THREE.Float32BufferAttribute(mask, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, bindTime(waterMaterial(spec.deep, spec.shallow, spec.flow)));
  mesh.name = spec.name;
  mesh.renderOrder = 1;
  return mesh;
}

function buildRiver(): THREE.Mesh {
  return buildStream({
    line: RIVER,
    start: FALLS_S + 0.4,
    end: RIVER.length,
    halfWidth: (s) => riverHalfWidth(s) + 1.6 + riverOpen(s) * 2,
    level: (s) => riverLevel(s),
    deep: W.riverDeep,
    shallow: W.riverShallow,
    flow: 0.45,
    name: 'River',
  });
}

function buildCreek(): THREE.Mesh {
  return buildStream({
    line: CREEK,
    start: 0,
    end: CREEK.length,
    halfWidth: () => CREEK_HALF_WIDTH + 0.5,
    level: (s) => creekLevel(s),
    deep: W.riverDeep,
    shallow: W.riverShallow,
    flow: 0.6,
    name: 'Creek',
  });
}

function buildWaterfall(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Waterfall';
  const lip = RIVER.at(FALLS_S - 0.2);
  const t = RIVER.tangent(FALLS_S);
  const width = riverHalfWidth(FALLS_S - 0.5) * 2 + 0.6;
  const top = LAKE.level + 0.05;
  const bottom = riverLevel(FALLS_S + 1) - 0.2;
  group.add(fallSheet(lip, t, width, top, bottom));


  // Churning foam and mist at the plunge pool.
  const foamMaterial = new THREE.MeshStandardMaterial({ color: '#f4fbff', roughness: 0.6, transparent: true, opacity: 0.92 });
  const foamGeo = new THREE.IcosahedronGeometry(1, 1);
  const random = mulberry32(77);
  const base = RIVER.at(FALLS_S + 2.4);
  const foam = new THREE.InstancedMesh(foamGeo, foamMaterial, 26);
  const seeds: { x: number; z: number; r: number; p: number }[] = [];
  for (let i = 0; i < foam.count; i++) {
    const a = random() * Math.PI * 2;
    const rr = Math.sqrt(random()) * width * 0.75;
    seeds.push({ x: base.x + Math.cos(a) * rr, z: base.z + Math.sin(a) * rr, r: 0.45 + random() * 0.7, p: random() * 6 });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const v = new THREE.Vector3();
  foam.onBeforeRender = () => {
    const time = waterUniforms.uTime.value;
    seeds.forEach((sd, i) => {
      const pulse = 0.75 + 0.35 * Math.sin(time * 3 + sd.p);
      sc.setScalar(sd.r * pulse);
      sc.y *= 0.55;
      v.set(sd.x, poolLevel + 0.1, sd.z);
      foam.setMatrixAt(i, m.compose(v, q, sc));
    });
    foam.instanceMatrix.needsUpdate = true;
  };
  foam.frustumCulled = false;
  group.add(foam);
  group.add(buildMist(base, width));
  return group;
}

/** Soft spray drifting up from the plunge pool. */
/** A falling sheet of water leaving a lip in direction t, arcing out and plunging from top to bottom. */
export function fallSheet(lip: { x: number; z: number }, t: { x: number; z: number }, width: number, top: number, bottom: number): THREE.Mesh {
  const rows = 26;
  const cols = 12;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    // Water leaves the lip, arcs outward and plunges.
    const out = 0.3 + 2.2 * Math.pow(v, 1.6);
    const y = top - (top - bottom) * v;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const off = (u - 0.5) * width * (1 + v * 0.25);
      positions.push(lip.x + t.x * out - t.z * off, y, lip.z + t.z * out + t.x * off);
      uvs.push(u, v);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]) as Record<string, THREE.IUniform>,
    fog: true,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec2 vUv;
#include <fog_pars_fragment>
float hash(float n){ return fract(sin(n)*43758.5453); }
float n1(float x){ float i=floor(x); float f=fract(x); return mix(hash(i),hash(i+1.0),f*f*(3.0-2.0*f)); }
float vn(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f); float a=hash(i.x+i.y*57.0), b=hash(i.x+1.0+i.y*57.0), c=hash(i.x+(i.y+1.0)*57.0), d=hash(i.x+1.0+(i.y+1.0)*57.0); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
void main(){
  float streak = vn(vec2(vUv.x*18.0, vUv.y*3.0 - uTime*2.4));
  float fine = vn(vec2(vUv.x*42.0, vUv.y*7.0 - uTime*3.6));
  vec3 base = mix(vec3(0.45,0.78,0.92), vec3(0.97,1.0,1.0), smoothstep(0.25,0.8,streak*0.6+fine*0.4) + vUv.y*0.35);
  float edge = smoothstep(0.0,0.12,vUv.x)*smoothstep(1.0,0.88,vUv.x);
  float alpha = edge * (0.78 + 0.22*fine) * smoothstep(0.0,0.05,vUv.y);
  gl_FragColor = vec4(base, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  material.uniforms.uTime = waterUniforms.uTime;
  const sheet = new THREE.Mesh(geometry, material);
  sheet.renderOrder = 2;
  return sheet;
}

function buildMist(base: { x: number; z: number }, width: number): THREE.Points {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const count = 70;
  const random = mulberry32(313);
  const seeds = Array.from({ length: count }, () => ({
    a: random() * Math.PI * 2, r: Math.sqrt(random()) * width * 0.8, p: random(), speed: 0.25 + random() * 0.35,
  }));
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ map: texture, size: 3.2, transparent: true, opacity: 0.55, depthWrite: false, color: '#f4fbff' });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.onBeforeRender = () => {
    const time = waterUniforms.uTime.value;
    seeds.forEach((sd, i) => {
      const life = (time * sd.speed + sd.p) % 1;
      const r = sd.r * (0.6 + life * 0.8);
      positions[i * 3] = base.x + Math.cos(sd.a) * r;
      positions[i * 3 + 1] = poolLevel + 0.3 + life * 7;
      positions[i * 3 + 2] = base.z + Math.sin(sd.a) * r;
    });
    geometry.attributes.position.needsUpdate = true;
  };
  return points;
}

/** Distant sea beyond the northern coast; it fills the horizon like the concept art. */
function buildSea(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(2600, 1000, 200, 80);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const depth = new Float32Array(pos.count);
  const mask = new Float32Array(pos.count).fill(1);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i) - 680;
    pos.setXYZ(i, x, SEA_LEVEL, z);
    depth[i] = z > -320 && Math.abs(x - 20) < 260 ? SEA_LEVEL - heightAt(x, z) : 7;
  }
  geometry.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
  geometry.setAttribute('mask', new THREE.BufferAttribute(mask, 1));
  const mesh = new THREE.Mesh(geometry, bindTime(waterMaterial(W.seaDeep, W.seaShallow, 0.01)));
  mesh.name = 'Sea';
  return mesh;
}

/** Flat drifting ice floes for the glacier world. */
function buildIceFloes(): THREE.InstancedMesh {
  const random = mulberry32(4242);
  const items: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (x: number, y: number, z: number, size: number) => {
    q.setFromAxisAngle(up, random() * Math.PI);
    items.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(size * (0.7 + random() * 0.8), 0.5 + random() * 0.8, size * (0.6 + random() * 0.6))));
  };
  // Sea floes and a few bergs.
  for (let i = 0; i < 260; i++) {
    const x = -300 + random() * 640;
    const z = -230 - random() * 420;
    if (heightAt(x, z) > SEA_LEVEL - 0.5) continue;
    place(x, SEA_LEVEL, z, 2 + random() * (random() < 0.12 ? 14 : 5));
  }
  // River and lake floes.
  for (let s = FALLS_S + 8; s < RIVER.length - 10; s += 3.5) {
    if (random() < 0.45) continue;
    const p = RIVER.at(s);
    const t = RIVER.tangent(s);
    const off = (random() - 0.5) * riverHalfWidth(s) * 1.4;
    place(p.x - t.z * off, riverLevel(s), p.z + t.x * off, 0.8 + random() * 1.6);
  }
  for (let i = 0; i < 40; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * 0.85;
    place(LAKE.cx + Math.cos(a) * r * LAKE.rx, LAKE.level, LAKE.cz + Math.sin(a) * r * LAKE.rz, 1.5 + random() * 3);
  }
  const geo = new THREE.DodecahedronGeometry(1, 0);
  geo.scale(1, 0.35, 1);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#f4fbff', roughness: 0.35, flatShading: true }), items.length);
  items.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'IceFloes';
  return mesh;
}

export function buildWater(theme: TerrainTheme): THREE.Group {
  W = theme.water;
  const group = new THREE.Group();
  group.name = 'Water';
  group.add(buildLake());
  if (theme.flowingWater) group.add(buildRiver(), buildCreek(), buildWaterfall());
  if (theme.coast) group.add(buildSea());
  if (theme.id === 'glacier') group.add(buildIceFloes());
  return group;
}
