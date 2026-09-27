import * as THREE from 'three';
import { fbm, lerp, smoothstep } from './noise';
import { baseHeight, coastMask, CREEK_HALF_WIDTH, LAKE, PATH_HALF_WIDTH, TRAIL_HALF_WIDTH, riverLevel, sampleTerrain, SEA_LEVEL, TerrainSample } from './layout';
import { waterUniforms } from './water';
import type { TerrainTheme } from './palette';

const C = (hex: string) => new THREE.Color(hex);
let GRASS_SUN = C('#9fd34f');
let GRASS_MID = C('#6cb43d');
let GRASS_DEEP = C('#3f8c34');
let GRASS_DRY = C('#b9cf5a');
let ROCK_LIGHT = C('#d6c6a6');
let ROCK_MID = C('#a08d74');
let ROCK_DARK = C('#6f6353');
let PATH_CORE = C('#e3c083');
let PATH_EDGE = C('#c99f62');
let TRAIL = C('#d6b073');
let SAND = C('#d8c38e');
let BED = C('#8a8f6a');
let WET_SAND = C('#b7a57a');
let PEBBLE = C('#b9b09a');

function applyTheme(t: TerrainTheme): void {
  GRASS_SUN = C(t.ground.sun); GRASS_MID = C(t.ground.mid); GRASS_DEEP = C(t.ground.deep); GRASS_DRY = C(t.ground.dry);
  ROCK_LIGHT = C(t.rock.light); ROCK_MID = C(t.rock.mid); ROCK_DARK = C(t.rock.dark);
  PATH_CORE = C(t.path.core); PATH_EDGE = C(t.path.edge); TRAIL = C(t.trail);
  SAND = C(t.sand); BED = C(t.bed); WET_SAND = C(t.wetSand); PEBBLE = C(t.pebble);
}

/** Painterly detail on top of vertex colors: soft blotches and fine speckle in world space. */
function paintMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
uniform float uTime;
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float blot = vnoise(vWorldPos.xz*0.18)*0.6 + vnoise(vWorldPos.xz*0.55)*0.4;
  float speck = vnoise(vWorldPos.xz*3.1);
  diffuseColor.rgb *= 0.9 + 0.2*blot;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(1.08,1.1,0.9), smoothstep(0.72,0.95,speck)*0.6);
  // Slow cloud shadows drifting across the island add depth to the wide view.
  vec2 cp = vWorldPos.xz*0.011 + vec2(uTime*0.006, uTime*0.0025);
  float cloud = smoothstep(0.5, 0.78, vnoise(cp)*0.7 + vnoise(cp*2.3)*0.3);
  diffuseColor.rgb *= 1.0 - 0.2*cloud;
}`);
  };
  return material;
}

function colorFor(sample: TerrainSample, x: number, z: number, ny: number, out: THREE.Color): void {
  const h = sample.h;
  const slope = 1 - ny;
  const n1 = fbm(x / 16, z / 16, 3) * 0.5 + 0.5;
  const n2 = fbm(x / 5 + 11, z / 5, 2) * 0.5 + 0.5;
  // Meadow: sunny tops, deeper greens in hollows.
  out.copy(GRASS_MID).lerp(GRASS_SUN, smoothstep(0.35, 0.8, n1) * 0.85);
  out.lerp(GRASS_DEEP, smoothstep(0.55, 0.15, n1) * 0.55 + smoothstep(0.1, 0.35, slope) * 0.25);
  out.lerp(GRASS_DRY, smoothstep(0.78, 0.95, n2) * 0.25);
  // Sandy lake shore.
  if (sample.lake < 1.6) {
    const shore = smoothstep(0.7, 0.2, Math.abs(h - (LAKE.level + 0.15)));
    out.lerp(SAND, shore * 0.85);
  }
  // Beaches and shallows along the sea coast.
  if (sample.coast > 0.02) {
    out.lerp(SAND, smoothstep(1.6, 0.3, Math.abs(h - SEA_LEVEL - 0.4)) * 0.9);
    if (h < SEA_LEVEL) out.lerp(WET_SAND, smoothstep(SEA_LEVEL, SEA_LEVEL - 1.5, h));
  }
  // Pebbly creek banks.
  if (sample.dCreek < CREEK_HALF_WIDTH + 1.6) {
    out.lerp(PEBBLE, smoothstep(CREEK_HALF_WIDTH + 1.6, CREEK_HALF_WIDTH, sample.dCreek) * 0.65);
  }
  // Rock on steep faces and inside the gorge, banded like sediment layers.
  const rock = Math.max(smoothstep(0.34, 0.58, slope), smoothstep(0.25, 0.6, sample.gorge) * smoothstep(0.08, 0.3, slope));
  if (rock > 0) {
    // Sediment layers: broad light bands separated by thin dark seams, broken by vertical cracks.
    const layer = h * 1.9 + fbm(x / 9, z / 9, 2) * 1.6;
    const band = smoothstep(0.15, 0.55, Math.abs(Math.sin(layer)));
    const crack = smoothstep(0.55, 0.85, Math.abs(fbm(x * 0.9, z * 0.9, 2)));
    const rc = ROCK_MID.clone().lerp(ROCK_LIGHT, band * 0.85).lerp(ROCK_DARK, (1 - band) * 0.55 + crack * 0.35);
    out.lerp(rc, rock);
  }
  // River banks and bed.
  const level = riverLevel(sample.sRiver);
  if (sample.gorge > 0.3 && h < level + 1.0) {
    out.lerp(SAND, smoothstep(level + 1.0, level + 0.1, h) * 0.8);
    out.lerp(BED, smoothstep(level, level - 1.0, h));
  }
  // Side footpaths: lighter, narrower worn earth on flat ground only.
  if (sample.dTrail < TRAIL_HALF_WIDTH + 0.8 && slope < 0.3 && sample.gorge < 0.05 && sample.dCreek > CREEK_HALF_WIDTH + 1) {
    const edge = smoothstep(TRAIL_HALF_WIDTH + 0.8 + n2 * 0.5, TRAIL_HALF_WIDTH - 0.4, sample.dTrail);
    out.lerp(TRAIL, edge * 0.8);
  }
  // Soft dirt path, painted into the terrain so it follows every bump.
  if (sample.dPath < PATH_HALF_WIDTH + 0.9 && sample.gorge < 0.2) {
    const edge = smoothstep(PATH_HALF_WIDTH + 0.9 + n2 * 0.4, PATH_HALF_WIDTH - 0.3, sample.dPath);
    const pc = PATH_EDGE.clone().lerp(PATH_CORE, smoothstep(PATH_HALF_WIDTH, 0.4, sample.dPath));
    pc.multiplyScalar(0.94 + n2 * 0.1);
    out.lerp(pc, edge);
  }
}

/** Cheap sample for the far surround: the island features all lie inside the detailed grid. */
function sampleFar(x: number, z: number): TerrainSample {
  const h = baseHeight(x, z);
  return { h, dPath: Infinity, sPath: 0, dRiver: Infinity, sRiver: 0, dCreek: Infinity, dTrail: Infinity, gorge: 0, lake: 9, coast: coastMask(x, z) };
}

function buildGrid(size: number, segments: number, cx: number, cz: number, sink?: (x: number, z: number) => number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const samples: TerrainSample[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    const s = sink ? sampleFar(x, z) : sampleTerrain(x, z);
    samples.push(s);
    pos.setXYZ(i, x, s.h - (sink ? sink(x, z) : 0), z);
  }
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const row = segments + 1;
  const hAt = (ix: number, iz: number) => samples[Math.min(segments, Math.max(0, iz)) * row + Math.min(segments, Math.max(0, ix))].h;
  for (let i = 0; i < pos.count; i++) {
    colorFor(samples[i], pos.getX(i), pos.getZ(i), normals.getY(i), c);
    // Baked ambient occlusion: hollows and cliff feet darker, ridges and cliff lips a touch brighter.
    const ix = i % row;
    const iz = Math.floor(i / row);
    let avg = 0;
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2]]) avg += hAt(ix + dx, iz + dz);
    const concave = avg / 8 - samples[i].h;
    c.multiplyScalar(THREE.MathUtils.clamp(1 - concave * 0.16, 0.68, 1.1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildTerrain(theme: TerrainTheme): THREE.Group {
  applyTheme(theme);
  const group = new THREE.Group();
  group.name = 'Terrain';
  const material = paintMaterial();
  const INNER = 430;
  const CX = 18;
  const CZ = -22;
  const inner = new THREE.Mesh(buildGrid(INNER, 420, CX, CZ), material);
  inner.receiveShadow = true;
  inner.castShadow = true;
  inner.name = 'TerrainInner';
  group.add(inner);
  // Low-resolution surround for the horizon, tucked just under the detailed island.
  const outer = new THREE.Mesh(
    buildGrid(2000, 200, CX, CZ, (x, z) => {
      const inside = Math.max(Math.abs(x - CX), Math.abs(z - CZ));
      // A little under the seam, then far below so coarse triangles never poke through the gorge.
      return lerp(0.5, 40, smoothstep(INNER / 2 - 4, INNER / 2 - 16, inside));
    }),
    material,
  );
  outer.receiveShadow = true;
  outer.name = 'TerrainOuter';
  group.add(outer);
  return group;
}
