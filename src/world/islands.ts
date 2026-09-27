// Island-based worlds from 04_五種寬闊場景概念圖.png:
//   極地冰河  thick tabular ice slabs with sheer blue walls floating on a dark sea
//   雲海天空  floating islands (the decorative ones drift gently) over a soft sea of clouds
//   寧靜海島  hilly tropical islands with beaches, palms and reefs in a turquoise sea
// All keep the shared race path: islands sit along it and wooden bridges carry the path across the
// gaps, so the characters walk exactly as in the other worlds.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CASTLE, GOAL_S, PATH, PATH_HALF_WIDTH, setSurfaceOverrides, START_S } from './layout';
import { fbm, lerp, mulberry32, noise2, smoothstep } from './noise';
import { buildBridge, buildCastle, buildMountains, buildSigns } from './props';
import {
  broadleafGeometry, bushGeometry, colored, foliageMaterial, instanced, lumpy, pineGeometry, rockGeometry, type Placement,
} from './vegetation';
import { bindTime, fallSheet, waterMaterial, waterUniforms } from './water';

export type IslandKind = 'skyland' | 'islands' | 'glacier';

interface Island {
  x: number; z: number; r: number; top: number; seed: number; onPath: boolean;
  /** Height of hills rising away from the path (sea islands). */
  hill: number;
  /** Rocky island with steep cliffs instead of a beach. */
  rocky: boolean;
  /** Gentle drift for floating decorative islands: phase, amplitude. */
  bob: [number, number];
}

const SEA_Y = 0;
const SEA_PLATFORM_TOP = 4.2;
const SEA_BEACH_TOP = 1.4;
const BRIDGE_DECK = 0.35;
const pal = (list: string[]) => list.map((c) => new THREE.Color(c));
const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const time = waterUniforms.uTime;
/** Floating path islands all drift together so bridges and characters can ride along. */
const PATH_BOB_AMP = 1.8;
const pathBob = () => Math.sin(time.value * 0.45) * PATH_BOB_AMP;

// ---------------------------------------------------------------- layout

function makeIslands(kind: IslandKind): Island[] {
  const len = PATH.length;
  const random = mulberry32(kind === 'islands' ? 515 : kind === 'glacier' ? 919 : 717);
  const topAt = (s: number, i: number) => {
    if (kind === 'islands') return 2.0;
    if (kind === 'glacier') return 6 + (i % 3) * 2.4 + (s / len) * 5; // stepped ice shelves
    return 26 + 24 * (s / len) + (i % 2 ? 1.5 : -1.5);
  };
  const base = (x: number, z: number, r: number, top: number, onPath: boolean): Island => ({
    x, z, r, top, seed: random() * 100, onPath, hill: 0, rocky: false, bob: [random() * 6.28, 0],
  });
  // Arc length of each island centre on the path, and its radius. The second island holds the start queue.
  // The sea world uses a sandy start beach and a chain of rock platforms joined by short bridges.
  const spots: [number, number][] = kind === 'islands'
    ? [[76, 30], [138, 15], [182, 15], [226, 15], [270, 15], [314, 15]]
    : [[20, 18], [78, 31], [145, 20], [190, 18], [236, 20], [282, 19], [328, 20]];
  const list: Island[] = spots.map(([s, r], i) => {
    const p = PATH.at(s);
    const island = base(p.x, p.z, r, topAt(s, i), true);
    if (kind === 'skyland') island.bob = [0, PATH_BOB_AMP];
    island.hill = 0;
    if (kind === 'islands') island.top = i === 0 ? SEA_BEACH_TOP : SEA_PLATFORM_TOP;
    return island;
  });
  // Goal island holds both the end of the path and the castle / lighthouse.
  const end = PATH.at(GOAL_S - 2);
  const goal = base((end.x + CASTLE.x) / 2, (end.z + CASTLE.z) / 2, 28, topAt(len, 1), true);
  if (kind === 'islands') { goal.top = SEA_PLATFORM_TOP + 1; goal.r = 30; goal.rocky = true; }
  if (kind === 'skyland') goal.r = 46;
  if (kind === 'skyland') goal.bob = [0, PATH_BOB_AMP];
  list.push(goal);
  // Decorative islands away from the route.
  const target = kind === 'glacier' ? 75 : kind === 'islands' ? 15 : 40;
  let tries = 0;
  while (list.length < target && tries < 2000) {
    tries++;
    const x = -260 + random() * 540;
    const z = -320 + random() * 450;
    const r = kind === 'glacier' ? 6 + random() * 16 : kind === 'islands' ? 6 + random() * 9 : 5 + random() * 12;
    const clearance = kind === 'glacier' ? 12 : kind === 'islands' ? 16 : 22;
    if (PATH.nearest(x, z, 70).d < r + clearance) continue;
    if (kind === 'islands' && z > 40) continue; // keep the camera's foreground open
    const gap = kind === 'glacier' ? 4 : 8;
    if (list.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + gap)) continue;
    let top: number;
    if (kind === 'islands') top = 2.5 + random() * 3;
    else if (kind === 'glacier') top = 2.5 + random() * 10;
    else top = 8 + random() * 70;
    const island = base(x, z, r, top, false);
    if (kind === 'islands') {
      island.rocky = true;
      island.hill = random() < 0.5 ? 3 + random() * 6 : 0.5;
    }
    if (kind === 'skyland') island.bob = [random() * 6.28, 2.8 + random() * 3.2];
    list.push(island);
  }
  return list;
}

const pathMask = (x: number, z: number) => smoothstep(PATH_HALF_WIDTH + 6, PATH_HALF_WIDTH + 1.5, PATH.nearest(x, z, 16).d);

/** Walking/ground height of an island top at (x, z). Paths across islands are flattened. */
function surfaceAt(island: Island, x: number, z: number, kind: IslandKind): number {
  const d = Math.hypot(x - island.x, z - island.z);
  const k = Math.min(1, d / island.r);
  let h = island.top;
  if (kind === 'skyland') {
    h += 0.45 * (1 - k * k);
  } else if (kind === 'glacier') {
    h += 0.3 * noise2(x / 7 + island.seed, z / 7) + 0.25 * (1 - k * k);
  } else {
    // Flat sandy top; decorative rock islets may carry a low mossy knoll.
    h += island.hill * Math.pow(Math.max(0, 1 - k * 1.5), 1.4) * (0.7 + 0.3 * noise2(x / 6 + island.seed, z / 6)) + 0.25 * (1 - k * k);
  }
  if (island.onPath) {
    const flat = island.top + (kind === 'skyland' ? 0.45 : 0.3);
    h = lerp(h, flat, pathMask(x, z));
  }
  return h;
}

// ---------------------------------------------------------------- island meshes

function islandMesh(island: Island, kind: IslandKind): THREE.BufferGeometry {
  const beach = kind === 'islands' && island.top < SEA_PLATFORM_TOP - 1;
  const seg = kind === 'glacier' ? 22 : kind === 'islands' ? 30 : 56;
  const rings = kind === 'islands' ? 8 : 10;
  const positions: number[] = [];
  const colors: number[] = [];
  const bobs: number[] = [];
  const c = new THREE.Color();
  const C = (h: string) => new THREE.Color(h);
  const grass = C(kind === 'islands' ? '#6cc449' : '#7cc84e');
  const grassDark = C(kind === 'islands' ? '#3f9a3a' : '#58a63f');
  const sand = C('#f4e0a8');
  const wetSand = C('#d9c08a');
  const rockLight = C(kind === 'islands' ? '#b3a18a' : '#a99a86');
  const rockDark = C(kind === 'islands' ? '#6e5f52' : '#6d6070');
  const snow = C('#f7fbff');
  const snowShade = C('#dce9f4');
  const iceTop = C('#e6f6ff');
  const iceMid = C('#8fd0f0');
  const iceDeep = C('#3f8fc8');
  // Outline: organic for islands and sky, faceted for ice slabs.
  const wobble = (a: number) => {
    if (kind === 'glacier') {
      return 1 + 0.18 * noise2(Math.cos(a) * 0.9 + island.seed, Math.sin(a) * 0.9 - island.seed);
    }
    return 1 + 0.13 * noise2(Math.cos(a) * 1.3 + island.seed, Math.sin(a) * 1.3 - island.seed) + 0.05 * noise2(Math.cos(a) * 4 + island.seed, Math.sin(a) * 4);
  };
  type Row = { rad: number; y: (x: number, z: number, a: number) => number; col: (x: number, z: number, y: number, a: number, f: number) => THREE.Color };
  const rows: Row[] = [];
  for (let k = 0; k <= rings; k++) {
    const f = k / rings;
    rows.push({
      rad: f,
      y: (x, z) => surfaceAt(island, x, z, kind),
      col: (x, z, _y, a) => {
        if (kind === 'glacier') return c.copy(snow).lerp(snowShade, 0.5 + 0.5 * noise2(x / 5, z / 5)).clone();
        c.copy(grass).lerp(grassDark, 0.5 + 0.5 * noise2(x / 8 + 9, z / 8 + island.seed));
        if (kind === 'islands') {
          // Sandy top with a few grassy patches; the knoll of a rock islet stays green.
          const patch = smoothstep(0.1, 0.35, noise2(x / 9 + island.seed, z / 9)) * (1 - smoothstep(0.55, 0.85, f));
          c.copy(sand).lerp(C('#ead08f'), 0.5 + 0.5 * noise2(x / 4, z / 4));
          c.lerp(grass.clone().lerp(grassDark, 0.5 + 0.5 * noise2(x / 5, z / 5 + 3)), island.onPath ? patch * 0.8 : Math.max(patch, 1 - f * 1.4));
          if (island.onPath) c.lerp(C('#e2c287'), pathMask(x, z) * smoothstep(PATH_HALF_WIDTH + 1, PATH_HALF_WIDTH - 1, PATH.nearest(x, z, 10).d));
        }
        void a;
        return c.clone();
      },
    });
  }
  if (kind === 'islands' && beach) {
    // Start beach slopes gently into the water.
    for (const [rad, y] of [[1.08, 0.6], [1.2, -0.3], [1.35, -1.4], [1.5, -3.6]] as [number, number][]) {
      rows.push({ rad, y: (x, z) => y + 0.15 * noise2(x / 4, z / 4), col: (_x, _z, yy) => (yy > 0 ? sand.clone() : wetSand.clone()) });
    }
  } else if (kind === 'islands') {
    // Thick rock platform: a rim of sand, then stepped, bulging low-poly rock walls into the sea.
    const t = island.top;
    const wall: [number, number][] = [[1.0, t - 0.25], [1.04, t - 1.1], [1.02, t * 0.62], [1.07, t * 0.3], [1.05, SEA_Y + 0.2], [1.1, SEA_Y - 1.2], [1.25, SEA_Y - 4]];
    wall.forEach(([rad, y], j) => {
      rows.push({
        rad: rad + 0.05 * noise2(island.seed + j * 3.1, j),
        y: (x, z) => y + (j > 0 && j < 5 ? 0.35 * noise2(x / 2.5 + j, z / 2.5) : 0),
        col: (x, _z, yy) => {
          if (j === 0) return sand.clone().multiplyScalar(0.92);
          const band = 0.5 + 0.5 * Math.sin(yy * 1.9 + noise2(x / 6, island.seed) * 1.5);
          const col = rockDark.clone().lerp(rockLight, 0.25 + band * 0.6);
          if (yy < SEA_Y + 0.6) col.lerp(C('#4e5d58'), 0.5); // wet, algae-dark waterline
          return col;
        },
      });
    });
  } else if (kind === 'glacier') {
    // Sheer ice walls: a snow lip, then an almost vertical face down into the water.
    const t = island.top;
    const wall: [number, number][] = [[1.0, t - 0.4], [1.012, t - 1.4], [1.022, t * 0.45], [1.03, SEA_Y - 1.5], [1.1, SEA_Y - 7]];
    for (const [rad, y] of wall) {
      rows.push({
        rad,
        y: (x, z) => y + (y < t - 1 ? 0.3 * noise2(x / 3, z / 3) : 0),
        col: (_x, _z, yy, a) => {
          const streak = 0.5 + 0.5 * noise2(a * 9 + island.seed, yy * 0.25);
          const h = THREE.MathUtils.clamp((yy - SEA_Y) / Math.max(1, t), 0, 1);
          const base = yy > t - 0.6 ? snow.clone() : iceDeep.clone().lerp(iceMid, smoothstep(0, 0.55, h)).lerp(iceTop, smoothstep(0.5, 1, h));
          return base.multiplyScalar(0.9 + streak * 0.15);
        },
      });
    }
  } else {
    // Rocky underside tapering to a point, with sediment bands.
    const depth = island.r * 1.35;
    const under = 7;
    for (let j = 1; j <= under; j++) {
      const f = j / under;
      rows.push({
        rad: 1.02 * Math.pow(1 - f, 0.75) + (j === under ? 0 : 0.02),
        y: (x, z) => island.top - 0.4 - depth * Math.pow(f, 1.25) + 1.5 * noise2(x / 5 + island.seed + j, z / 5),
        col: (_x, _z, yy) => {
          const band = 0.5 + 0.5 * Math.sin(yy * 1.3 + island.seed);
          return rockDark.clone().lerp(rockLight, band * (1 - f * 0.6));
        },
      });
    }
  }
  rows.forEach((row, ri) => {
    const f = Math.min(1, ri / rings);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rad = row.rad * island.r * wobble(a);
      const x = island.x + Math.cos(a) * rad;
      const z = island.z + Math.sin(a) * rad;
      const y = row.y(x, z, a);
      positions.push(x, y, z);
      const col = row.col(x, z, y, a, f);
      colors.push(col.r, col.g, col.b);
      bobs.push(island.bob[0], island.bob[1]);
    }
  });
  const index: number[] = [];
  for (let k = 0; k < rows.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * (seg + 1) + i;
      const b = a + seg + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('bob', new THREE.Float32BufferAttribute(bobs, 2));
  g.setIndex(index);
  if (kind === 'glacier' || kind === 'islands') g = g.toNonIndexed(); // faceted ice / low-poly stone
  g.computeVertexNormals();
  return g;
}

/** Patch a material so vertices with a `bob` attribute (phase, amplitude) drift up and down. */
function withBob<T extends THREE.Material>(material: T, instancedAttr = false): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nattribute vec2 bob;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed.y += sin(uTime * 0.45 + bob.x) * bob.y${instancedAttr ? ' / max(0.001, length(instanceMatrix[1].xyz))' : ''};`);
  };
  material.customProgramCacheKey = () => (instancedAttr ? 'bob-inst' : 'bob');
  return material;
}

// ---------------------------------------------------------------- props

function palmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunkColor = new THREE.Color('#9a6f45');
  let x = 0;
  let y = 0;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.CylinderGeometry(0.22 - i * 0.013, 0.27 - i * 0.013, 1.15, 6);
    seg.rotateZ(-0.06 - i * 0.035);
    seg.translate(x, y + 0.57, 0);
    parts.push(colored(seg, i % 2 ? trunkColor : trunkColor.clone().multiplyScalar(0.85)));
    x += 0.1 + i * 0.05;
    y += 1.1;
  }
  for (let f = 0; f < 8; f++) {
    const a = (f / 8) * Math.PI * 2;
    const leaf = new THREE.ConeGeometry(0.85, 3.6, 5, 3);
    leaf.scale(1, 1, 0.32);
    // Droop the frond tip.
    const p = leaf.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.pow(Math.max(0, p.getY(i) + 1.9) / 3.8, 2) * 0.9);
    leaf.rotateZ(Math.PI / 2 + 0.35);
    leaf.rotateY(a);
    leaf.translate(x + Math.cos(a) * 1.4, y - 0.45, -Math.sin(a) * 1.4);
    parts.push(colored(leaf, new THREE.Color('#ffffff')));
  }
  const nuts = new THREE.IcosahedronGeometry(0.28, 0);
  for (let n = 0; n < 3; n++) {
    const g = nuts.clone();
    g.translate(x + Math.cos(n * 2.1) * 0.3, y - 0.5, Math.sin(n * 2.1) * 0.3);
    parts.push(colored(g, new THREE.Color('#6b4a2a')));
  }
  return mergeGeometries(parts)!;
}

function lighthouse(groundY: number): THREE.Group {
  const g = new THREE.Group();
  const white = std('#f7f4ee');
  const red = std('#d8423a');
  const rock = new THREE.Mesh(lumpy(new THREE.DodecahedronGeometry(7, 1), 0.2, 3), std('#8e8378', { flatShading: true }));
  rock.scale.set(1.2, 0.5, 1.1);
  rock.position.y = -0.5;
  g.add(rock);
  for (let i = 0; i < 6; i++) {
    const r0 = 3.2 - i * 0.28;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r0 - 0.28, r0, 3.4, 20), i % 2 ? red : white);
    seg.position.y = 2.2 + i * 3.4;
    g.add(seg);
  }
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.5, 20), std('#4a4e63'));
  deck.position.y = 21.1;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.4, 16), new THREE.MeshStandardMaterial({ color: '#fff6c8', emissive: '#ffd966', emissiveIntensity: 1.6 }));
  lamp.position.y = 22.5;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.6, 16), red);
  roof.position.y = 25;
  const house = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 5), white);
  house.position.set(7, 2, 2);
  const houseRoof = new THREE.Mesh(new THREE.ConeGeometry(5, 3, 4), red);
  houseRoof.rotation.y = Math.PI / 4;
  houseRoof.position.set(7, 5.5, 2);
  g.add(deck, lamp, roof, house, houseRoof);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(CASTLE.x, groundY, CASTLE.z);
  g.scale.setScalar(2.1);
  return g;
}

function sailboats(islands: Island[]): THREE.Group {
  const g = new THREE.Group();
  const random = mulberry32(31);
  const hullMat = std('#8a5a36');
  const sailMat = std('#fbf6ea', { side: THREE.DoubleSide });
  let placed = 0;
  for (let t = 0; t < 400 && placed < 3; t++) {
    const x = -220 + random() * 460;
    const z = -300 + random() * 380;
    if (PATH.nearest(x, z, 40).d < 40 || islands.some((i) => Math.hypot(i.x - x, i.z - z) < i.r * 1.5 + 6)) continue;
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.5, 5, 8, 1, false, 0, Math.PI), hullMat);
    hull.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    hull.position.y = 0.4;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), hullMat);
    mast.position.y = 2.8;
    const sail = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 0.8, 2.6)]), sailMat);
    sail.geometry.computeVertexNormals();
    boat.add(hull, mast, sail);
    boat.position.set(x, SEA_Y, z);
    boat.rotation.y = random() * Math.PI * 2;
    boat.scale.setScalar(1.6);
    boat.userData.phase = random() * 6;
    g.add(boat);
    placed++;
  }
  return g;
}

/** Tall rocky islands on the horizon, green on top (sea world) or jagged ice peaks (glacier). */
function farPeaks(kind: IslandKind): THREE.Mesh {
  const random = mulberry32(kind === 'glacier' ? 1717 : 1616);
  const parts: THREE.BufferGeometry[] = [];
  // Sea world: a big mountain island back-left and a few steep rocky islets, like the concept art.
  const seaPeaks: [number, number, number, number][] = [[-230, -330, 95, 90], [-120, -380, 55, 40], [70, -420, 70, 38], [160, -370, 45, 28], [260, -300, 60, 45], [-300, -230, 40, 35]];
  const count = kind === 'glacier' ? 16 : seaPeaks.length;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI * 0.95 + random() * Math.PI * 0.9;
    const r = 420 + random() * 280;
    const sp = seaPeaks[i];
    const x = kind === 'glacier' ? 20 + Math.cos(a) * r * 1.2 : sp[0] * 1.9;
    const z = kind === 'glacier' ? -120 + Math.sin(a) * r : sp[1] * 1.8;
    const h = kind === 'glacier' ? 40 + random() * 70 : sp[2];
    const w = kind === 'glacier' ? 18 + random() * 22 : sp[3];
    let g: THREE.BufferGeometry = lumpy(new THREE.ConeGeometry(w, h, kind === 'glacier' ? 6 : 9, 4), kind === 'glacier' ? 0.14 : 0.2, i);
    g = g.index ? g.toNonIndexed() : g;
    g.translate(x, h / 2 - 3, z);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const f = (pos.getY(v) + 3) / h;
      if (kind === 'glacier') c.set('#6fa9d6').lerp(new THREE.Color('#f4fbff'), smoothstep(0.25, 0.7, f));
      else c.set('#8a8074').lerp(new THREE.Color('#5fae4a'), smoothstep(0.3, 0.75, f)).lerp(new THREE.Color('#e9d6a0'), smoothstep(0.08, 0.0, f));
      colors.set([c.r, c.g, c.b], v * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  }
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  mesh.name = 'FarPeaks';
  return mesh;
}

// ---------------------------------------------------------------- clouds

function cloudTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const random = mulberry32(12);
  // A lumpy puff made of many soft blobs, flatter at the bottom like a cumulus.
  for (let i = 0; i < 26; i++) {
    const x = size * (0.22 + random() * 0.56);
    const y = size * (0.35 + random() * 0.35);
    const r = size * (0.12 + random() * 0.16) * (1 - Math.abs(x / size - 0.5));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft billboard cloud puffs: lit white tops, lavender undersides, gently drifting. */
function cloudPuffs(items: { x: number; y: number; z: number; s: number; drift?: number }[]): THREE.Mesh {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const offset = new Float32Array(items.length * 3);
  const scale = new Float32Array(items.length);
  const seed = new Float32Array(items.length);
  const drift = new Float32Array(items.length);
  items.forEach((it, i) => {
    offset.set([it.x, it.y, it.z], i * 3);
    scale[i] = it.s;
    seed[i] = (i * 0.618) % 1;
    drift[i] = it.drift ?? 1;
  });
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 3));
  geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  geo.setAttribute('aDrift', new THREE.InstancedBufferAttribute(drift, 1));
  geo.instanceCount = items.length;
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null } }]) as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
attribute vec3 aOffset;
attribute float aScale;
attribute float aSeed;
attribute float aDrift;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  // Wind carries every cloud slowly along +x (each at its own pace) and wraps it round to the far side,
  // while it gently rises, sinks and billows like a real cumulus.
  float speed = 2.2 + aSeed * 2.6;
  float span = 1800.0;
  // aDrift 0 = stays put (clouds near the islands must never drift over the route), just sways.
  float x = mix(aOffset.x + sin(uTime * 0.03 + aSeed * 6.28) * 6.0, mod(aOffset.x + 900.0 + uTime * speed, span) - 900.0, aDrift);
  float z = aOffset.z + sin(uTime * 0.05 + aSeed * 9.0) * 5.0;
  float y = aOffset.y + sin(uTime * 0.22 + aSeed * 12.0) * 1.2;
  vec3 centre = vec3(x, y, z);
  vec4 mvPosition = viewMatrix * vec4(centre, 1.0);
  float a = aSeed * 6.28 + sin(uTime * 0.04 + aSeed * 5.0) * 0.6;
  float billow = 1.0 + 0.08 * sin(uTime * 0.3 + aSeed * 20.0);
  vec2 corner = position.xy * vec2(1.6, 1.0) * aScale * billow;
  mvPosition.xy += vec2(corner.x * cos(a * 0.1) - corner.y * sin(a * 0.1), corner.x * sin(a * 0.1) + corner.y * cos(a * 0.1));
  vUv = uv;
  vSeed = aSeed;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vSeed;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(uMap, vec2(mix(vUv.x, 1.0 - vUv.x, step(0.5, vSeed)), vUv.y));
  if (tex.a < 0.02) discard;
  vec3 shadow = vec3(0.64, 0.66, 0.86);
  vec3 lit = vec3(1.0, 0.995, 0.985);
  vec3 col = mix(shadow, lit, smoothstep(0.15, 0.7, vUv.y));
  gl_FragColor = vec4(col, tex.a * 0.96);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
  material.uniforms.uTime = time;
  material.uniforms.uMap.value = cloudTexture();
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'CloudPuffs';
  return mesh;
}

function cloudSea(): THREE.Group {
  const group = new THREE.Group();
  // Soft base below the puffs so no gaps show through.
  const base = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color: '#c9cdef', fog: true }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -22;
  group.add(base);
  const random = mulberry32(88);
  const items: { x: number; y: number; z: number; s: number; drift?: number }[] = [];
  // Dense rolling layer of cumulus tops.
  for (let i = 0; i < 1500; i++) {
    const x = -900 + random() * 1800;
    const z = -1100 + random() * 1350;
    items.push({ x, y: -14 + random() * 6 + fbm(x / 120, z / 120, 2) * 10, z, s: 22 + random() * 50 });
  }
  // A few drifting clouds between the islands, never over the route.
  for (let i = 0; i < 90; i++) {
    const x = -420 + random() * 840;
    const z = -520 + random() * 620;
    if (PATH.nearest(x, z, 70).d < 70) continue;
    items.push({ x, y: 20 + random() * 60, z, s: 18 + random() * 26, drift: 0 });
  }
  group.add(cloudPuffs(items));
  return group;
}

/** Animated white surf ring hugging every island's waterline. */
function surfRings(islands: Island[]): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  let base = 0;
  for (const island of islands) {
    const seg = 48;
    const inner = island.r * (island.top < SEA_PLATFORM_TOP - 1 ? 1.32 : 1.02);
    const outer = inner + 2.2 + island.r * 0.08;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const w = 1 + 0.06 * noise2(Math.cos(a) * 2 + island.seed, Math.sin(a) * 2);
      for (const [rad, v] of [[inner * w, 0], [outer * w, 1]] as [number, number][]) {
        positions.push(island.x + Math.cos(a) * rad, SEA_Y + 0.08, island.z + Math.sin(a) * rad);
        uvs.push((i / seg) * Math.max(4, Math.round(island.r / 2)), v);
      }
      if (i < seg) {
        const k = base + i * 2;
        index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    base += (seg + 1) * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: time },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main(){
  // Surf pulses outward and breaks into lacy bits away from the rocks.
  float wave = fract(vUv.y * 1.2 - uTime * 0.25);
  float n = vn(vec2(vUv.x * 6.0, vUv.y * 3.0 - uTime * 0.4));
  float edge = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.25, 1.0, vUv.y));
  float lace = smoothstep(0.35, 0.7, n + (1.0 - vUv.y) * 0.5 - wave * 0.3);
  float a = edge * lace;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(1.0), a * 0.95);
}`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.name = 'Surf';
  return mesh;
}

/** Glowing coloured pads marking each platform, as in the concept art. */
function platformPads(platforms: Island[]): THREE.Group {
  const g = new THREE.Group();
  const colors = ['#4fb7ff', '#b6e33f', '#ff9a3c', '#ff7fb6', '#b48cff', '#5fe3c8'];
  platforms.forEach((island, i) => {
    const p = PATH.nearest(island.x, island.z, 30);
    const at = PATH.at(p.s);
    const y = surfaceAt(island, at.x, at.z, 'islands') + 0.08;
    const color = colors[i % colors.length];
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.35, 40), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.4 }));
    pad.position.set(at.x, y, at.z);
    const glow = new THREE.Mesh(new THREE.RingGeometry(3.8, 5.4, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(at.x, y + 0.02, at.z);
    pad.receiveShadow = true;
    g.add(pad, glow);
  });
  return g;
}

/** Jagged low-poly rock islands on the horizon, grey-brown with green on the ledges. */
function seaPeaks(): THREE.Group {
  const group = new THREE.Group();
  const random = mulberry32(2323);
  const parts: THREE.BufferGeometry[] = [];
  const rings: Island[] = [];
  const spots: [number, number, number, number][] = [[-520, -620, 70, 95], [-360, -700, 45, 60], [-80, -760, 38, 55], [180, -700, 55, 75], [420, -640, 40, 50], [600, -560, 30, 40]];
  for (const [x, z, w, h] of spots) {
    const pieces = 4 + Math.floor(random() * 3);
    for (let k = 0; k < pieces; k++) {
      const px = x + (random() - 0.5) * w * 0.9;
      const pz = z + (random() - 0.5) * w * 0.6;
      const ph = h * (k === 0 ? 1 : 0.35 + random() * 0.5);
      const pw = w * (k === 0 ? 0.45 : 0.25 + random() * 0.25);
      let g: THREE.BufferGeometry = lumpy(new THREE.ConeGeometry(pw, ph, 7, 3), 0.22, px + pz);
      g = g.index ? g.toNonIndexed() : g;
      g.translate(px, ph / 2 - 2, pz);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let v = 0; v < pos.count; v++) {
        const f = (pos.getY(v) + 2) / h;
        c.set('#8b7f72').lerp(new THREE.Color('#6d6358'), 0.5 + 0.5 * noise2(pos.getX(v) / 8, pos.getY(v) / 5));
        c.lerp(new THREE.Color('#6f9a55'), smoothstep(0.3, 0.5, f) * (1 - smoothstep(0.62, 0.8, f)) * 0.45 * (0.5 + 0.5 * noise2(pos.getX(v) / 5, pos.getZ(v) / 5)));
        colors.set([c.r, c.g, c.b], v * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.deleteAttribute('uv');
      parts.push(g);
    }
    rings.push({ x, z, r: w * 0.55, top: 3, seed: x, onPath: false, hill: 0, rocky: true, bob: [0, 0] });
  }
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  group.add(new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true })));
  group.add(surfRings(rings));
  group.name = 'SeaPeaks';
  return group;
}

/** Overview for the sea world: steep three-quarter view along the route, start bottom-left, lighthouse top-right. */
function seaCamera(): { target: THREE.Vector3; position: THREE.Vector3; fov: number } {
  const a = PATH.at(START_S - 10);
  const b = PATH.at(GOAL_S);
  const target = new THREE.Vector3(a.x + (b.x - a.x) * 0.5, 2, a.z + (b.z - a.z) * 0.5);
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const dir = new THREE.Vector3(0.18, 0, 1).normalize();
  const pitch = THREE.MathUtils.degToRad(16.5);
  const dist = span * 1.02;
  const position = target.clone().add(dir.multiplyScalar(Math.cos(pitch) * dist)).add(new THREE.Vector3(0, Math.sin(pitch) * dist, 0));
  return { target, position, fov: 42 };
}

// ---------------------------------------------------------------- world

export interface IslandWorld {
  group: THREE.Group;
  camera?: { target: THREE.Vector3; position: THREE.Vector3; fov: number };
  update(elapsed: number): void;
}

export function buildIslandWorld(kind: IslandKind, cameraHint: THREE.Vector3): IslandWorld {
  const group = new THREE.Group();
  /** Everything that rides on the path islands (bridges, path, castle, signs, falls). */
  const riders = new THREE.Group();
  group.add(riders);
  const islands = makeIslands(kind);
  const pathIslands = islands.filter((i) => i.onPath);

  // ---- Walking surface: island tops, bridges in between ----
  const coverAt = (x: number, z: number, onPathOnly = false) => {
    let best: Island | null = null;
    let bestD = Infinity;
    for (const island of onPathOnly ? pathIslands : islands) {
      const d = Math.hypot(x - island.x, z - island.z);
      if (d < island.r - 1.2 && d < bestD) { best = island; bestD = d; }
    }
    return best;
  };
  const step = 0.5;
  const n = Math.ceil(PATH.length / step) + 1;
  const onIsland = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const p = PATH.at(i * step);
    const hit = coverAt(p.x, p.z, true);
    onIsland[i] = hit ? islands.indexOf(hit) : -1;
  }
  const bridgeRanges: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (onIsland[i] >= 0) continue;
    let j = i;
    while (j < n && onIsland[j] < 0) j++;
    if (i > 0) bridgeRanges.push([Math.max(0, (i - 1) * step), Math.min(PATH.length, j * step)]);
    i = j;
  }
  const islandHeightAt = (s: number) => {
    const p = PATH.at(s);
    const hit = coverAt(p.x, p.z, true);
    return hit ? surfaceAt(hit, p.x, p.z, kind) : null;
  };
  const bobNow = () => (kind === 'skyland' ? pathBob() : 0);
  const walk = (s: number) => walkStatic(s) + bobNow();
  const walkStatic = (s: number) => {
    const onLand = islandHeightAt(s);
    if (onLand !== null) return onLand;
    const range = bridgeRanges.find(([a, b]) => s >= a && s <= b);
    if (!range) return pathIslands[0].top;
    const [a, b] = range;
    const ha = islandHeightAt(a) ?? pathIslands[0].top;
    const hb = islandHeightAt(b) ?? ha;
    const t = (s - a) / Math.max(1, b - a);
    const curve = Math.sin(t * Math.PI) * (kind === 'skyland' ? -0.5 : 0.9);
    return lerp(ha, hb, t) + curve + BRIDGE_DECK;
  };
  const bridge = (s: number) => {
    const range = bridgeRanges.find(([a, b]) => s > a - 3 && s < b + 3);
    if (!range) return 0;
    return smoothstep(range[0] - 3, range[0] + 1, s) * smoothstep(range[1] + 3, range[1] - 1, s);
  };
  const ground = (x: number, z: number) => {
    const hit = coverAt(x, z);
    if (hit) return surfaceAt(hit, x, z, kind);
    return kind === 'skyland' ? -60 : SEA_Y;
  };
  setSurfaceOverrides({ walk, bridge, ground });

  // ---- Islands ----
  const islandMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: kind === 'glacier' ? 0.45 : 0.95, metalness: 0 });
  const islandMeshes = new THREE.Mesh(mergeGeometries(islands.map((island) => islandMesh(island, kind)))!, kind === 'skyland' ? withBob(islandMaterial) : islandMaterial);
  islandMeshes.castShadow = true;
  islandMeshes.receiveShadow = true;
  islandMeshes.name = 'Islands';
  group.add(islandMeshes);

  // Dirt path ribbon on sky islands and snow-packed trail on ice (sea islands paint it into the mesh).
  if (kind !== 'islands') {
    const ribbon: number[] = [];
    const ribbonIdx: number[] = [];
    let rows = 0;
    for (let s = 0; s <= PATH.length; s += 1) {
      const p = PATH.at(s);
      const t = PATH.tangent(s);
      const hit = coverAt(p.x, p.z, true);
      for (const side of [-1, 1]) {
        const lat = side * (PATH_HALF_WIDTH - 0.6);
        const x = p.x - t.z * lat;
        const z = p.z + t.x * lat;
        ribbon.push(x, hit ? surfaceAt(hit, x, z, kind) + 0.06 : -999, z);
      }
      if (rows > 0) {
        const a = (rows - 1) * 2;
        ribbonIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      rows++;
    }
    const keep: number[] = [];
    for (let i = 0; i < ribbonIdx.length; i += 3) {
      if ([0, 1, 2].every((k) => ribbon[ribbonIdx[i + k] * 3 + 1] > -100)) keep.push(ribbonIdx[i], ribbonIdx[i + 1], ribbonIdx[i + 2]);
    }
    const ribbonGeo = new THREE.BufferGeometry();
    ribbonGeo.setAttribute('position', new THREE.Float32BufferAttribute(ribbon, 3));
    ribbonGeo.setIndex(keep);
    ribbonGeo.computeVertexNormals();
    const color = kind === 'glacier' ? '#c9dceb' : '#dcc08a';
    const path = new THREE.Mesh(ribbonGeo, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    path.receiveShadow = true;
    riders.add(path);
  }

  // Bridges across the gaps.
  riders.add(buildBridge(bridgeRanges, { halfWidth: 3.4, legsTo: kind === 'skyland' ? null : () => SEA_Y - 3 }));

  // ---- Vegetation on the islands ----
  const random = mulberry32(kind === 'islands' ? 1201 : kind === 'glacier' ? 1401 : 1301);
  const scatterOn = (count: number, margin: number, pick: (island: Island, k: number) => boolean = () => true) => {
    const out: (Placement & { bob: [number, number] })[] = [];
    const weights = islands.map((i) => i.r * i.r);
    const total = weights.reduce((a, b) => a + b, 0);
    let tries = 0;
    while (out.length < count && tries < count * 40) {
      tries++;
      let pickW = random() * total;
      let idx = 0;
      while (pickW > weights[idx]) { pickW -= weights[idx]; idx++; }
      const island = islands[idx];
      const a = random() * Math.PI * 2;
      const k = Math.sqrt(random()) * (kind === 'islands' ? 0.9 : 0.8);
      if (!pick(island, k)) continue;
      const x = island.x + Math.cos(a) * k * island.r;
      const z = island.z + Math.sin(a) * k * island.r;
      if (PATH.nearest(x, z, 20).d < PATH_HALF_WIDTH + margin) continue;
      if (Math.hypot(x - CASTLE.x, z - CASTLE.z) < 16) continue;
      out.push({ x, y: surfaceAt(island, x, z, kind), z, s: 0.75 + random() * 0.55, rot: random() * Math.PI * 2, tint: random(), bob: island.bob });
    }
    return out;
  };
  const material = foliageMaterial();
  const addPlants = (geometry: THREE.BufferGeometry, items: (Placement & { bob: [number, number] })[], palette: THREE.Color[], size: number, shadows = true) => {
    const mesh = instanced(geometry, material, items, palette, size, shadows);
    if (kind === 'skyland') {
      const bob = new Float32Array(items.length * 2);
      items.forEach((it, i) => bob.set(it.bob, i * 2));
      mesh.geometry.setAttribute('bob', new THREE.InstancedBufferAttribute(bob, 2));
      mesh.material = withBob(foliageMaterial(), true);
    }
    group.add(mesh);
  };
  if (kind === 'islands') {
    // Few, well-placed plants: 1–4 round palms per island, plus bushes and pebbles.
    const perIsland = (min: number, max: number, k0: number, k1: number, margin: number) => {
      const out: (Placement & { bob: [number, number] })[] = [];
      for (const island of islands) {
        const want = min + Math.floor(random() * (max - min + 1)) + (island.r > 25 ? 2 : 0);
        for (let t = 0, n = 0; n < want && t < 60; t++) {
          const a = random() * Math.PI * 2;
          const k = k0 + random() * (k1 - k0);
          const x = island.x + Math.cos(a) * k * island.r;
          const z = island.z + Math.sin(a) * k * island.r;
          if (PATH.nearest(x, z, 20).d < PATH_HALF_WIDTH + margin || Math.hypot(x - CASTLE.x, z - CASTLE.z) < 14) continue;
          out.push({ x, y: surfaceAt(island, x, z, kind), z, s: 0.85 + random() * 0.35, rot: random() * 6.28, tint: random(), bob: island.bob });
          n++;
        }
      }
      return out;
    };
    addPlants(palmGeometry(), perIsland(1, 4, 0.35, 0.8, 4), pal(['#5ccf4a', '#6fdc55', '#4fc244']), 1.5);
    addPlants(bushGeometry(), perIsland(2, 5, 0.3, 0.85, 2), pal(['#5cc446', '#72d052', '#4fb03f']), 1.1);
    addPlants(rockGeometry(), perIsland(1, 3, 0.7, 0.95, 1.5), pal(['#b9ada0', '#9d9186', '#8a8076']), 1.3);
  } else if (kind === 'glacier') {
    const snowRock = pal(['#e9f4fb', '#d3e6f3', '#bcd6ea']);
    addPlants(rockGeometry(), scatterOn(220, 1.5), snowRock, 1.6);
    addPlants(pineGeometry(), scatterOn(70, 3, (i) => i.top > 5), pal(['#dfeee8', '#cfe3dc']), 1.1);
    addPlants(bushGeometry(), scatterOn(260, 1.5), pal(['#ffffff', '#f0f7fc']), 1.3, false);
  } else {
    const leaf = pal(['#5aa83a', '#6fbb45', '#83c64e', '#4a9936']);
    addPlants(broadleafGeometry(), scatterOn(240, 3), leaf, 1.1);
    addPlants(pineGeometry(), scatterOn(130, 3), pal(['#2f7340', '#3a8445']), 1.2);
    addPlants(bushGeometry(), scatterOn(320, 1.5), pal(['#6cbc45', '#88c84f', '#5aa83a']), 0.85);
    addPlants(rockGeometry(), scatterOn(80, 1.5), pal(['#b0a6a0', '#9a90a0']), 1.1);
  }
  // Flowers (sea and sky) or glittering snow crystals (ice).
  const flowers = scatterOn(kind === 'glacier' ? 900 : kind === 'islands' ? 500 : 2200, 0.6, (i, k) => kind !== 'islands' || !i.rocky || k < 0.6);
  const flowerMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(kind === 'glacier' ? 0.1 : 0.14, 0), new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: kind === 'glacier' ? '#5aa9d8' : '#222', emissiveIntensity: kind === 'glacier' ? 0.6 : 1 }), flowers.length);
  const fpal = pal(kind === 'glacier' ? ['#dff6ff', '#bfeaff'] : ['#ffffff', '#ffe46b', '#ffb3c7', '#fff3a8', '#ff8fa3']);
  const m = new THREE.Matrix4();
  flowers.forEach((p, i) => { flowerMesh.setMatrixAt(i, m.makeTranslation(p.x, p.y + 0.14, p.z)); flowerMesh.setColorAt(i, fpal[i % fpal.length]); });
  if (kind !== 'skyland') group.add(flowerMesh);

  // ---- Goal landmark ----
  const goal = islands.find((i) => i.onPath && Math.hypot(i.x - CASTLE.x, i.z - CASTLE.z) < 30)!;
  const goalY = surfaceAt(goal, CASTLE.x, CASTLE.z, kind);
  if (kind === 'islands') {
    group.add(lighthouse(goalY));
    group.add(platformPads(pathIslands.slice(1, -1)));
  }
  else if (kind === 'glacier') group.add(buildCastle({ wall: '#d8f1ff', shade: '#a9dcf5', roof: '#6cc6ef', dark: '#3a6fa6', stone: '#bcd8ea', flag: '#9ff0ff', emissive: '#3aa8e0' }, goalY));
  else riders.add(buildCastle({ wall: '#f3f1ff', shade: '#d8d6f0', roof: '#7f95f0', dark: '#4a4e7a', stone: '#b8b0c8', flag: '#ffd6f0', emissive: '#6c7bd8' }, goalY));

  // ---- Water / clouds and the horizon ----
  let boats: THREE.Group | null = null;
  if (kind === 'skyland') {
    group.add(cloudSea());
    for (const island of [pathIslands[2], pathIslands[4], pathIslands[6]].filter(Boolean)) {
      const a = noise2(island.seed, 3) * Math.PI;
      const dir = { x: Math.cos(a), z: Math.sin(a) };
      const lip = { x: island.x + dir.x * island.r * 0.98, z: island.z + dir.z * island.r * 0.98 };
      if (PATH.nearest(lip.x, lip.z, 20).d < 8) continue;
      riders.add(fallSheet(lip, dir, 4 + island.r * 0.15, island.top - 0.1, Math.max(0, island.top - 45)));
    }
  } else {
    const size = 2800;
    const geometry = new THREE.PlaneGeometry(size, size, 280, 280);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const depth = new Float32Array(pos.count);
    const mask = new Float32Array(pos.count).fill(1);
    const shelf = kind === 'islands' ? 1.25 : 1.05;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + 20;
      const z = pos.getZ(i) - 80;
      pos.setXYZ(i, x, SEA_Y, z);
      let edge = Infinity;
      for (const island of islands) edge = Math.min(edge, Math.hypot(x - island.x, z - island.z) - island.r * shelf);
      const bars = kind === 'islands' ? fbm(x / 40, z / 40, 2) * 0.22 : 0;
      depth[i] = THREE.MathUtils.clamp((kind === 'islands' ? 0.15 : 0.8) + edge * (kind === 'islands' ? 0.05 : 0.25) + bars, 0.05, 8);
    }
    geometry.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
    geometry.setAttribute('mask', new THREE.BufferAttribute(mask, 1));
    const water = kind === 'islands'
      ? waterMaterial('#0b5fa8', '#3fd6e0', 0.02, '#8fd4ff')
      : waterMaterial('#0b2c63', '#3f8ec4', 0.015, '#9fc8ea');
    const sea = new THREE.Mesh(geometry, bindTime(water));
    sea.name = 'Sea';
    group.add(sea);
    if (kind === 'glacier') group.add(farPeaks(kind));
    else {
      group.add(seaPeaks(), surfRings(islands));
      // A few fluffy fair-weather clouds low over the horizon.
      const cr = mulberry32(4545);
      const clouds: { x: number; y: number; z: number; s: number }[] = [];
      for (let i = 0; i < 26; i++) clouds.push({ x: -900 + cr() * 1800, y: 70 + cr() * 90, z: -900 - cr() * 500, s: 40 + cr() * 60 });
      group.add(cloudPuffs(clouds));
    }
    if (kind === 'glacier') group.add(buildMountains(['#dcecf8', '#c7dff2', '#e9f3fb']));
    if (kind === 'islands') {
      boats = sailboats(islands);
      boats.children.slice(2).forEach((b) => { b.visible = false; });
      group.add(boats);
      // Reefs and rocks breaking the surface near the shores.
      const reef = scatterOn(120, 2, (_i, k) => k > 0.85).map((p) => {
        const island = coverAt(p.x, p.z) ?? islands[0];
        const a = Math.atan2(p.z - island.z, p.x - island.x);
        const r = island.r * (1.15 + random() * 0.25);
        return { ...p, x: island.x + Math.cos(a) * r, z: island.z + Math.sin(a) * r, y: -0.3 };
      });
      addPlants(rockGeometry(), reef, pal(['#8f8579', '#a39a8f']), 1.5);
    } else {
      // Small ice chunks drifting in the channels.
      const chunks: (Placement & { bob: [number, number] })[] = [];
      for (let t = 0; chunks.length < 260 && t < 3000; t++) {
        const x = -260 + random() * 540;
        const z = -340 + random() * 480;
        if (coverAt(x, z) || PATH.nearest(x, z, 8).d < PATH_HALF_WIDTH + 2) continue;
        chunks.push({ x, y: SEA_Y - 0.2, z, s: 0.8 + random() * 2.2, rot: random() * 6, tint: random(), bob: [0, 0] });
      }
      const chunkGeo = new THREE.DodecahedronGeometry(1, 0);
      chunkGeo.scale(1.4, 0.5, 1.1);
      addPlants(colored(chunkGeo, new THREE.Color('#ffffff')), chunks, pal(['#f4fbff', '#dff1fb', '#c9e7f7']), 1.4);
      // Frozen falls pouring off a couple of the tall slabs.
      for (const island of islands.filter((i) => !i.onPath && i.top > 8).slice(0, 3)) {
        const a = noise2(island.seed, 5) * Math.PI;
        const dir = { x: Math.cos(a), z: Math.sin(a) };
        const lip = { x: island.x + dir.x * island.r, z: island.z + dir.z * island.r };
        group.add(fallSheet(lip, dir, 3 + island.r * 0.2, island.top - 0.3, SEA_Y - 0.3));
      }
    }
  }
  riders.add(buildSigns(cameraHint));

  return {
    group,
    camera: kind === 'islands' ? seaCamera() : undefined,
    update(elapsed: number) {
      if (kind === 'skyland') riders.position.y = pathBob();
      boats?.children.forEach((b) => {
        b.position.y = SEA_Y + Math.sin(elapsed * 1.2 + b.userData.phase) * 0.25;
        b.rotation.z = Math.sin(elapsed * 0.9 + b.userData.phase) * 0.06;
      });
    },
  };
}
