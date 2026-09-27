import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CASTLE, CREEK_HALF_WIDTH, FALLS_S, gorgeWall, heightAt, PATH, PATH_HALF_WIDTH, RIVER, riverHalfWidth, riverOpen, RIVER_BRIDGE_S, sampleTerrain, SEA_LEVEL, START_S } from './layout';
import { fbm, mulberry32, noise2, smoothstep } from './noise';
import type { TerrainTheme } from './palette';

export type Placement = { x: number; y: number; z: number; s: number; rot: number; tint: number };

export function lumpy(geometry: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise2(v.x * 1.7 + seed, v.z * 1.7 + v.y * 1.3 - seed);
    v.multiplyScalar(1 + n * amount);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function colored(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Soft, rounded broadleaf tree: three lumpy blobs over a short trunk. */
export function broadleafGeometry(): THREE.BufferGeometry {
  const leaf = new THREE.Color('#ffffff');
  const trunkColor = new THREE.Color('#8a5a36');
  const parts: THREE.BufferGeometry[] = [];
  const blob = (r: number, x: number, y: number, z: number, seed: number) => {
    const g = lumpy(new THREE.IcosahedronGeometry(r, 1), 0.1, seed);
    g.translate(x, y, z);
    return colored(g, leaf);
  };
  parts.push(blob(1.35, 0, 2.9, 0, 1), blob(0.95, 0.85, 2.45, 0.35, 4), blob(0.9, -0.7, 2.55, -0.4, 8), blob(0.8, 0.1, 3.75, 0.2, 12));
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 2.0, 7);
  trunk.translate(0, 1.0, 0);
  // Trunk colour is marked with a negative-ish channel so instance tint does not affect it.
  parts.push(colored(trunk, trunkColor));
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  return merged;
}

export function pineGeometry(): THREE.BufferGeometry {
  const leaf = new THREE.Color('#ffffff');
  const parts: THREE.BufferGeometry[] = [];
  const tiers = [
    [1.45, 1.9, 1.5],
    [1.15, 1.7, 2.55],
    [0.8, 1.5, 3.5],
  ];
  tiers.forEach(([r, h, y], i) => {
    const cone = lumpy(new THREE.ConeGeometry(r, h, 8, 1), 0.05, i * 3);
    cone.translate(0, y, 0);
    parts.push(colored(cone, leaf));
  });
  const trunk = new THREE.CylinderGeometry(0.13, 0.2, 1.2, 6);
  trunk.translate(0, 0.6, 0);
  parts.push(colored(trunk, new THREE.Color('#7a4f30')));
  return mergeGeometries(parts)!;
}

export function bushGeometry(): THREE.BufferGeometry {
  const leaf = new THREE.Color('#ffffff');
  const a = lumpy(new THREE.IcosahedronGeometry(0.7, 1), 0.12, 3);
  a.translate(0, 0.45, 0);
  const b = lumpy(new THREE.IcosahedronGeometry(0.5, 1), 0.12, 9);
  b.translate(0.55, 0.35, 0.1);
  return mergeGeometries([colored(a, leaf), colored(b, leaf)])!;
}

export function tuftGeometry(): THREE.BufferGeometry {
  const leaf = new THREE.Color('#ffffff');
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const blade = new THREE.ConeGeometry(0.07, 0.75 + (i % 3) * 0.2, 3, 1);
    const a = (i / 6) * Math.PI * 2;
    blade.rotateZ(Math.cos(a) * 0.35);
    blade.rotateX(Math.sin(a) * 0.35);
    blade.translate(Math.cos(a) * 0.12, 0.35, Math.sin(a) * 0.12);
    parts.push(colored(blade, leaf));
  }
  return mergeGeometries(parts)!;
}

export function rockGeometry(): THREE.BufferGeometry {
  const g = lumpy(new THREE.DodecahedronGeometry(0.7, 1), 0.22, 5);
  g.scale(1.2, 0.7, 1);
  g.translate(0, 0.2, 0);
  return colored(g, new THREE.Color('#ffffff'));
}

/** Material whose white vertex areas take the per-instance colour; coloured areas (trunks) keep theirs. */
export function foliageMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: false });
  return material;
}

function isOpen(x: number, z: number, margin: number): { ok: boolean; y: number; s: number } {
  const t = sampleTerrain(x, z);
  if (t.dPath < PATH_HALF_WIDTH + margin) return { ok: false, y: 0, s: 0 };
  if (t.gorge > 0.02 || t.dRiver < 7.5) return { ok: false, y: 0, s: 0 };
  if (t.lake < 1.25) return { ok: false, y: 0, s: 0 };
  if (t.dCreek < CREEK_HALF_WIDTH + 2.2) return { ok: false, y: 0, s: 0 };
  if (t.dTrail < 2.2) return { ok: false, y: 0, s: 0 };
  if (t.h < SEA_LEVEL + 1.4) return { ok: false, y: 0, s: 0 };
  if (Math.hypot(x - CASTLE.x, z - CASTLE.z) < 12) return { ok: false, y: 0, s: 0 };
  // Keep the start area and the bridge approaches readable.
  const start = PATH.at(START_S);
  if (Math.hypot(x - start.x, z - start.z) < 9) return { ok: false, y: 0, s: 0 };
  const e = 0.6;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const slope = Math.hypot(hx, hz) / (2 * e);
  if (slope > 0.75) return { ok: false, y: 0, s: 0 };
  return { ok: true, y: t.h, s: slope };
}

function scatter(count: number, seed: number, area: { x0: number; x1: number; z0: number; z1: number }, accept: (x: number, z: number, r: () => number) => boolean, margin: number): Placement[] {
  const random = mulberry32(seed);
  const out: Placement[] = [];
  let tries = 0;
  while (out.length < count && tries < count * 40) {
    tries++;
    const x = area.x0 + random() * (area.x1 - area.x0);
    const z = area.z0 + random() * (area.z1 - area.z0);
    if (!accept(x, z, random)) continue;
    const o = isOpen(x, z, margin);
    if (!o.ok) continue;
    out.push({ x, y: o.y, z, s: 0.75 + random() * 0.55, rot: random() * Math.PI * 2, tint: random() });
  }
  return out;
}

export function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, items: Placement[], palette: THREE.Color[], sizeScale: number, shadows = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  items.forEach((p, i) => {
    q.setFromAxisAngle(up, p.rot);
    const s = p.s * sizeScale;
    m.compose(new THREE.Vector3(p.x, p.y - 0.15, p.z), q, new THREE.Vector3(s, s * (0.9 + p.tint * 0.25), s));
    mesh.setMatrixAt(i, m);
    const a = palette[Math.floor(p.tint * palette.length) % palette.length];
    const b = palette[(Math.floor(p.tint * palette.length) + 1) % palette.length];
    color.copy(a).lerp(b, (p.tint * palette.length) % 1);
    mesh.setColorAt(i, color);
  });
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  return mesh;
}

const pal = (list: string[]) => list.map((c) => new THREE.Color(c));

export function buildVegetation(theme: TerrainTheme): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Vegetation';
  const material = foliageMaterial();
  const inner = { x0: -190, x1: 225, z0: -230, z1: 190 };
  const near = { x0: -175, x1: 140, z0: -10, z1: 195 };
  const forest = (x: number, z: number) => fbm(x / 38 + 5, z / 38 - 3, 3);
  const rimArea = { x0: -420, x1: 460, z0: -330, z1: 260 };
  const rimAccept = (x: number, z: number) => Math.max(Math.abs(x - 18), Math.abs(z + 22)) > 200 && forest(x, z) > -0.1 && heightAt(x, z) > SEA_LEVEL + 2;
  const rockPalette = pal([theme.rock.light, theme.rock.mid, theme.pebble, theme.rock.dark]);
  const bigRocks = () => scatter(18, 83, { x0: -150, x1: 150, z0: -80, z1: 185 }, (_x, _z, r) => r() < 0.5, 3);

  if (theme.id === 'glacier') {
    // Snow-laden pines in small stands, ice crystals, snow drifts.
    const pines = scatter(420, 23, inner, (x, z, r) => (forest(x, z) > 0.28 && r() < 0.75) || r() < 0.015, 5);
    group.add(instanced(snowPineGeometry(), material, pines, pal(['#ffffff', '#eef6fb', '#e3eef5']), 1.35));
    const crystals = scatter(160, 29, inner, (x, z, r) => forest(x, z) < -0.2 && r() < 0.5, 4);
    group.add(instanced(crystalGeometry(), crystalMaterial(), crystals, pal(['#bff0ff', '#9fe4ff', '#d9f7ff']), 1.6));
    const drifts = scatter(700, 31, inner, (_x, _z, r) => r() < 0.4, 1.4);
    group.add(instanced(bushGeometry(), material, drifts, pal(['#ffffff', '#f2f8fc', '#e6f0f7']), 1.1, false));
    group.add(instanced(rockGeometry(), material, scatter(300, 41, inner, (_x, _z, r) => r() < 0.5, 1.0), rockPalette, 1.0));
    group.add(instanced(snowPineGeometry(), material, scatter(600, 53, rimArea, rimAccept, 2), pal(['#ffffff', '#eef6fb']), 1.8, false));
    group.add(instanced(rockGeometry(), material, bigRocks(), rockPalette, 4.2));
  } else if (theme.id === 'desert') {
    // Cacti, dry scrub and tall red mesas and arches.
    const cacti = scatter(420, 23, inner, (x, z, r) => forest(x, z) > 0.1 || r() < 0.05, 4);
    group.add(instanced(cactusGeometry(), material, cacti, pal(['#4f8a3c', '#5e9a46', '#447a35']), 1.4));
    const scrub = scatter(800, 31, inner, (_x, _z, r) => r() < 0.45, 1.4);
    group.add(instanced(bushGeometry(), material, scrub, pal(['#9c9a4a', '#8a7a3e', '#b0a45a', '#7d6f3a']), 0.7));
    group.add(instanced(rockGeometry(), material, scatter(420, 41, inner, (_x, _z, r) => r() < 0.6, 1.0), rockPalette, 1.1));
    group.add(buildMesas(theme));
    const tufts = scatter(4000, 71, near, (_x, _z, r) => r() < 0.6, 0.8);
    group.add(instanced(tuftGeometry(), material, tufts, pal(['#d9b560', '#c9a24e', '#e6c679']), 0.9, false));
    group.add(instanced(rockGeometry(), material, bigRocks(), rockPalette, 4.6));
  } else {
    // Groves with open meadow between them; lone trees here and there. Keep clear of the path so characters stay visible.
    const broadleaf = scatter(520, 11, inner, (x, z, r) => forest(x, z) > 0.3 || r() < 0.02, 4.5);
    const pines = scatter(380, 23, inner, (x, z, r) => (forest(x, z) > 0.36 && r() < 0.7) || r() < 0.012, 5);
    const bushes = scatter(900, 31, inner, (x, z, r) => forest(x, z) > 0.05 || r() < 0.25, 1.4);
    const rocks = scatter(380, 41, inner, (_x, _z, r) => r() < 0.5, 1.0);
    // Hillside trees beyond the island so the horizon reads as woodland.
    const rim = scatter(700, 53, rimArea, rimAccept, 2);
    const leafPalette = pal(['#4f9d36', '#62b03c', '#78bf45', '#3f8a32', '#8cc84b']);
    group.add(instanced(broadleafGeometry(), material, broadleaf, leafPalette, 1.15));
    group.add(instanced(pineGeometry(), material, pines, pal(['#2f7340', '#3a8445', '#28653a', '#4a9150']), 1.3));
    group.add(instanced(bushGeometry(), material, bushes, pal(['#5aa83a', '#6fb843', '#4c9535', '#86c24c']), 0.85));
    group.add(instanced(rockGeometry(), material, rocks, rockPalette, 0.9));
    group.add(instanced(broadleafGeometry(), material, rim, leafPalette, 1.6, false));
    // Grass tufts near the camera give the foreground fine texture.
    const tufts = scatter(7000, 71, near, (_x, _z, r) => r() < 0.8, 0.8);
    group.add(instanced(tuftGeometry(), material, tufts, pal(['#78b93f', '#8fca48', '#5ea536', '#a3d152']), 1.0, false));
    // A few big mossy boulders in the meadow, like the rock in the concept art's foreground.
    group.add(instanced(rockGeometry(), material, bigRocks(), rockPalette, 4.2));
  }

  group.add(buildCliffRocks(rockPalette));

  // Wildflowers / sparkles: tiny bright dots on the ground.
  const flowerItems = scatter(theme.id === 'grassland' ? 9000 : 2500, 61, { x0: -170, x1: 200, z0: -120, z1: 185 }, (_x, _z, r) => r() < 0.7, 0.4);
  const flower = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.11, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.8, emissive: '#222', vertexColors: false }),
    flowerItems.length,
  );
  const fpal = pal(theme.flowers);
  const m = new THREE.Matrix4();
  flowerItems.forEach((p, i) => {
    m.makeTranslation(p.x, p.y + 0.12, p.z);
    flower.setMatrixAt(i, m);
    flower.setColorAt(i, fpal[i % fpal.length]);
  });
  group.add(flower);
  return group;
}

/** Pine with white snow caps on each tier (instance tint stays near white). */
function snowPineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers = [[1.45, 1.9, 1.5], [1.15, 1.7, 2.55], [0.8, 1.5, 3.5]];
  tiers.forEach(([r, h, y], i) => {
    const cone = lumpy(new THREE.ConeGeometry(r, h, 8, 1), 0.05, i * 3);
    cone.translate(0, y, 0);
    parts.push(colored(cone, new THREE.Color('#2d5f49')));
    const cap = lumpy(new THREE.ConeGeometry(r * 0.82, h * 0.55, 8, 1), 0.06, i * 5 + 1);
    cap.translate(0, y + h * 0.26, 0);
    parts.push(colored(cap, new THREE.Color('#ffffff')));
  });
  const trunk = new THREE.CylinderGeometry(0.13, 0.2, 1.2, 6);
  trunk.translate(0, 0.6, 0);
  parts.push(colored(trunk, new THREE.Color('#6b4a33')));
  return mergeGeometries(parts)!;
}

function crystalGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const spikes = [[0, 1.6, 0, 0], [0.6, 1.1, 0.3, 0.35], [-0.5, 1.2, -0.2, -0.3], [0.1, 0.9, -0.6, 0.2]];
  for (const [x, h, z, tilt] of spikes) {
    const g = new THREE.OctahedronGeometry(0.45, 0);
    g.scale(1, h * 2.2, 1);
    g.rotateZ(tilt);
    g.translate(x, h, z);
    parts.push(colored(g, new THREE.Color('#ffffff')));
  }
  return mergeGeometries(parts)!;
}

function crystalMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1, flatShading: true, emissive: '#2a7fb0', emissiveIntensity: 0.35, transparent: true, opacity: 0.9 });
}

function cactusGeometry(): THREE.BufferGeometry {
  const green = new THREE.Color('#ffffff');
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.42, 0.5, 3.6, 8);
  trunk.translate(0, 1.8, 0);
  parts.push(colored(trunk, green));
  const top = new THREE.SphereGeometry(0.42, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  top.translate(0, 3.6, 0);
  parts.push(colored(top, green));
  for (const [side, y, h] of [[1, 1.6, 1.3], [-1, 2.2, 1.0]]) {
    const out = new THREE.CylinderGeometry(0.28, 0.28, 0.9, 7);
    out.rotateZ(Math.PI / 2);
    out.translate(side * 0.8, y, 0);
    parts.push(colored(out, green));
    const up = new THREE.CylinderGeometry(0.27, 0.3, h, 7);
    up.translate(side * 1.2, y + h / 2, 0);
    parts.push(colored(up, green));
    const cap = new THREE.SphereGeometry(0.27, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.translate(side * 1.2, y + h, 0);
    parts.push(colored(cap, green));
  }
  return mergeGeometries(parts)!;
}

/** Vertex colours: sandstone bands by world height, darker toward the foot. */
function sandstone(g: THREE.BufferGeometry, theme: TerrainTheme, baseY: number, seed: number): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const light = new THREE.Color(theme.rock.light);
  const mid = new THREE.Color(theme.rock.mid);
  const dark = new THREE.Color(theme.rock.dark);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - baseY;
    const band = 0.5 + 0.5 * Math.sin(y * 0.85 + noise2(pos.getX(i) / 12 + seed, pos.getZ(i) / 12) * 1.4);
    c.copy(mid).lerp(light, band * 0.75).lerp(dark, smoothstep(4, 0, y) * 0.45);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * An eroded butte: a stack of irregular rock layers that step inward as they rise, each outline
 * wobbling like weathered sandstone, with a flat cap on top.
 */
function butteGeometry(x: number, z: number, ground: number, r: number, h: number, seed: number): THREE.BufferGeometry {
  const layers = 3 + Math.floor(h / 9);
  const parts: THREE.BufferGeometry[] = [];
  let y = ground - 1.5;
  let radius = r;
  let cx = x;
  let cz = z;
  for (let i = 0; i < layers; i++) {
    const lh = (h / layers) * (0.75 + 0.5 * noise2(seed + i, 3.3) * 0.5 + 0.25);
    const top = radius * (0.82 + 0.1 * noise2(seed, i));
    let g: THREE.BufferGeometry = new THREE.CylinderGeometry(top, radius, lh, 16, 3);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v);
      const pz = pos.getZ(v);
      const py = pos.getY(v);
      const a = Math.atan2(pz, px);
      const d = Math.hypot(px, pz);
      if (d < 0.01) continue;
      // Irregular outline: large lobes plus small crumbling notches, varying with height.
      const lobe = 1 + 0.22 * noise2(Math.cos(a) * 1.4 + seed + i * 0.7, Math.sin(a) * 1.4 + py * 0.05)
        + 0.08 * noise2(Math.cos(a) * 5 + seed, Math.sin(a) * 5 + py * 0.3);
      pos.setXYZ(v, px * lobe, py + 0.4 * noise2(px * 0.3 + seed, pz * 0.3), pz * lobe);
    }
    g = g.toNonIndexed();
    g.translate(cx, y + lh / 2, cz);
    parts.push(g);
    y += lh * 0.97;
    radius = top * (0.72 + 0.12 * noise2(seed * 2, i));
    cx += noise2(seed, i * 3) * radius * 0.15;
    cz += noise2(i * 3, seed) * radius * 0.15;
    if (radius < 2.5) break;
  }
  parts.forEach((p) => p.deleteAttribute('uv'));
  return sandstone(mergeGeometries(parts)!, currentTheme!, ground, seed);
}

/** A thin hoodoo: rounded boulders balanced on top of each other. */
function hoodooGeometry(x: number, z: number, ground: number, h: number, seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let y = ground - 0.5;
  const count = 3 + Math.floor(h / 6);
  for (let i = 0; i < count; i++) {
    const r = (2.6 - i * 0.25) * (0.8 + 0.4 * (0.5 + 0.5 * noise2(seed, i)));
    let g: THREE.BufferGeometry = lumpy(new THREE.IcosahedronGeometry(r, 1), 0.18, seed + i);
    g.scale(1, (h / count) / (r * 1.6), 1);
    g = g.index ? g.toNonIndexed() : g;
    g.translate(x + noise2(seed, i) * 0.8, y + h / count / 2, z + noise2(i, seed) * 0.8);
    parts.push(g);
    y += (h / count) * 0.9;
  }
  const cap = lumpy(new THREE.IcosahedronGeometry(2.4, 1), 0.2, seed + 99);
  cap.scale(1.3, 0.6, 1.2);
  cap.translate(x, y + 0.8, z);
  parts.push(cap);
  parts.forEach((p) => p.deleteAttribute('uv'));
  return sandstone(mergeGeometries(parts)!, currentTheme!, ground, seed);
}

/** A natural arch built from overlapping weathered boulders along a curve. */
function archGeometry(x: number, z: number, ground: number, span: number, rot: number, seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = Math.PI * t;
    const px = Math.cos(a) * span;
    const py = Math.sin(a) * span * 0.9;
    const thick = span * (0.26 + 0.12 * Math.abs(Math.cos(a))) * (0.85 + 0.3 * (0.5 + 0.5 * noise2(seed, i)));
    let g: THREE.BufferGeometry = lumpy(new THREE.IcosahedronGeometry(thick, 1), 0.2, seed + i);
    g.scale(1, 0.85, 0.75);
    g = g.index ? g.toNonIndexed() : g;
    g.translate(px, py + thick * 0.4, 0);
    g.rotateY(rot);
    g.translate(x, ground - 1, z);
    parts.push(g);
  }
  parts.forEach((p) => p.deleteAttribute('uv'));
  return sandstone(mergeGeometries(parts)!, currentTheme!, ground, seed);
}

let currentTheme: TerrainTheme | null = null;

/** Eroded buttes, hoodoos and natural arches, kept clear of the route and the camera's foreground. */
function buildMesas(theme: TerrainTheme): THREE.Group {
  currentTheme = theme;
  const group = new THREE.Group();
  const random = mulberry32(606);
  const parts: THREE.BufferGeometry[] = [];
  const talus: Placement[] = [];
  let buttes = 0;
  let hoodoos = 0;
  for (let tries = 0; tries < 1400 && (buttes < 24 || hoodoos < 22); tries++) {
    const x = -280 + random() * 590;
    const z = -280 + random() * 440;
    const t = sampleTerrain(x, z);
    if (t.dRiver < 20 || t.lake < 2 || Math.hypot(x - CASTLE.x, z - CASTLE.z) < 40) continue;
    const wantButte = buttes < 24 && random() < 0.55;
    const clear = wantButte ? 34 : 16;
    if (t.dPath < clear) continue;
    // Keep the camera's foreground clear so rock never hides the route.
    if (z > -70 && t.dPath < (wantButte ? 80 : 40)) continue;
    const seed = random() * 50;
    if (wantButte) {
      const r = 11 + random() * 14;
      const h = 18 + random() * 30;
      parts.push(butteGeometry(x, z, t.h, r, h, seed));
      buttes++;
      for (let k = 0; k < 8; k++) {
        const a = random() * Math.PI * 2;
        const d = r * (1.05 + random() * 0.5);
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        talus.push({ x: px, y: heightAt(px, pz), z: pz, s: 0.8 + random() * 1.4, rot: random() * 6, tint: random() });
      }
    } else if (hoodoos < 22) {
      parts.push(hoodooGeometry(x, z, t.h, 8 + random() * 12, seed));
      hoodoos++;
    }
  }
  const arches: [number, number, number, number][] = [[-120, -40, 13, 0.4], [150, 40, 10, -0.8], [-60, -150, 15, 1.2], [70, -120, 11, 0.2]];
  arches.forEach(([x, z, span, rot], i) => {
    const t = sampleTerrain(x, z);
    if (t.dPath > 20) parts.push(archGeometry(x, z, t.h, span, rot, i * 13.7));
  });
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Buttes';
  group.add(mesh);
  const rockPalette = [theme.rock.light, theme.rock.mid, theme.rock.dark].map((c) => new THREE.Color(c));
  group.add(instanced(rockGeometry(), foliageMaterial(), talus, rockPalette, 1.3));
  return group;
}

/** Chunky boulders embedded along the gorge walls and waterfall so the canyon reads as rock, not a slope. */
function buildCliffRocks(palette: THREE.Color[]): THREE.InstancedMesh {
  const random = mulberry32(808);
  const items: { x: number; y: number; z: number; s: THREE.Vector3; rot: THREE.Euler; tint: number }[] = [];
  for (let s = FALLS_S - 1; s < RIVER.length - 8; s += 0.9) {
    const p = RIVER.at(s);
    const t = RIVER.tangent(s);
    const half = riverHalfWidth(s);
    for (const side of [-1, 1]) {
      if (random() < 0.7) continue;
      const d = half + 0.6 + random() * gorgeWall(s) * 0.8;
      const x = p.x - t.z * d * side + (random() - 0.5) * 0.6;
      const z = p.z + t.x * d * side + (random() - 0.5) * 0.6;
      const size = 0.6 + random() * 1.0;
      items.push({
        x, y: heightAt(x, z) - size * 0.45, z,
        s: new THREE.Vector3(size * (0.9 + random() * 0.5), size * (0.8 + random() * 0.9), size * (0.9 + random() * 0.5)),
        rot: new THREE.Euler(random() * 0.6, random() * Math.PI * 2, random() * 0.6),
        tint: random(),
      });
    }
  }
  // Boulders in the open river: the water foams around them.
  for (let s = RIVER_BRIDGE_S + 20; s < RIVER.length - 10; s += 1.3) {
    if (random() > riverOpen(s) * 0.8) continue;
    const p = RIVER.at(s);
    const t = RIVER.tangent(s);
    const off = (random() - 0.5) * 2 * riverHalfWidth(s) * 0.85;
    const x = p.x - t.z * off;
    const z = p.z + t.x * off;
    const size = 0.5 + random() * 0.9;
    items.push({ x, y: heightAt(x, z) + size * 0.1, z, s: new THREE.Vector3(size * 1.3, size * 0.8, size), rot: new THREE.Euler(0, random() * 6, 0), tint: random() });
  }
  // A crown of rocks around the waterfall lip.
  const lip = RIVER.at(FALLS_S);
  for (let i = 0; i < 26; i++) {
    const a = random() * Math.PI * 2;
    const r = 3.5 + random() * 5;
    const x = lip.x + Math.cos(a) * r;
    const z = lip.z + Math.sin(a) * r;
    const size = 1 + random() * 1.8;
    items.push({ x, y: heightAt(x, z) - size * 0.3, z, s: new THREE.Vector3(size, size * 1.2, size), rot: new THREE.Euler(0, random() * 6, 0), tint: random() });
  }
  const geometry = lumpy(new THREE.DodecahedronGeometry(0.8, 0), 0.18, 21);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  items.forEach((it, i) => {
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q.setFromEuler(it.rot), it.s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, palette[Math.floor(it.tint * palette.length)]);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'CliffRocks';
  return mesh;
}
