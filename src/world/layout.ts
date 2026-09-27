// Island layout: the race path, the river, the lake, the creek, the coast and the height field that
// ties them together. Everything visual (terrain, water, trees, bridge, characters) samples this module.
import { fbm, lerp, smoothstep } from './noise';

export interface PolyPoint { x: number; z: number; s: number }
export interface Nearest { d: number; s: number; side: number }

/** Dense arc-length polyline built from a Catmull-Rom curve through control points. */
export class Polyline {
  readonly points: PolyPoint[] = [];
  readonly length: number;
  private readonly cell = 6;
  private readonly buckets = new Map<number, number[]>();

  constructor(control: [number, number][], spacing = 0.4) {
    const raw: [number, number][] = [];
    for (let i = 0; i < control.length - 1; i++) {
      const p0 = control[Math.max(0, i - 1)];
      const p1 = control[i];
      const p2 = control[i + 1];
      const p3 = control[Math.min(control.length - 1, i + 2)];
      for (let k = 0; k < 40; k++) {
        const t = k / 40;
        const t2 = t * t;
        const t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) =>
          0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        raw.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    raw.push(control[control.length - 1]);
    // Resample at even arc-length spacing.
    let s = 0;
    this.points.push({ x: raw[0][0], z: raw[0][1], s: 0 });
    let carry = 0;
    for (let i = 1; i < raw.length; i++) {
      const [ax, az] = raw[i - 1];
      const [bx, bz] = raw[i];
      const seg = Math.hypot(bx - ax, bz - az);
      let pos = spacing - carry;
      while (pos <= seg) {
        const t = pos / seg;
        s += spacing;
        this.points.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s });
        pos += spacing;
      }
      carry = seg - (pos - spacing);
    }
    this.length = s;
    this.points.forEach((p, i) => {
      const key = this.key(Math.floor(p.x / this.cell), Math.floor(p.z / this.cell));
      if (!this.buckets.has(key)) this.buckets.set(key, []);
      this.buckets.get(key)!.push(i);
    });
  }

  private key(cx: number, cz: number): number {
    return (cx + 2048) * 4096 + (cz + 2048);
  }

  /** Nearest distance within maxDist (farther returns Infinity). */
  nearest(x: number, z: number, maxDist = 18): Nearest {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const r = Math.ceil(maxDist / this.cell);
    let best = Infinity;
    let bi = -1;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const list = this.buckets.get(this.key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const p = this.points[i];
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < best) { best = d; bi = i; }
        }
      }
    }
    if (bi < 0) return { d: Infinity, s: 0, side: 0 };
    const p = this.points[bi];
    // Refine against the neighbouring segment for a smooth distance field.
    const q = this.points[Math.min(this.points.length - 1, bi + 1)];
    const o = this.points[Math.max(0, bi - 1)];
    let d = Math.sqrt(best);
    for (const n of [o, q]) {
      const ex = n.x - p.x;
      const ez = n.z - p.z;
      const len2 = ex * ex + ez * ez;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / len2));
      d = Math.min(d, Math.hypot(x - (p.x + ex * t), z - (p.z + ez * t)));
    }
    return { d, s: p.s, side: 0 };
  }

  at(s: number): { x: number; z: number } {
    if (s < 0) {
      // Extrapolate straight back from the first segment.
      const a = this.points[0];
      const b = this.points[4];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: a.x + ((b.x - a.x) / l) * s, z: a.z + ((b.z - a.z) / l) * s };
    }
    const f = s / (this.points.length > 1 ? this.points[1].s : 1);
    const i = Math.min(this.points.length - 2, Math.floor(f));
    const a = this.points[i];
    const b = this.points[i + 1];
    const u = Math.min(1.5, f - i);
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
  }

  tangent(s: number): { x: number; z: number } {
    const a = this.at(Math.max(0, Math.min(this.length - 0.5, s) - 0.5));
    const b = this.at(Math.max(0.5, Math.min(this.length, s + 0.5)));
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  }
}

// ---- Authored layout (x right, z toward the default camera) ----
// Composition follows grass_3d.PNG: the path starts in the bottom-left foreground, winds across a
// bridge over the river gorge and climbs all the way to a castle far away on the top-right hill.
// A waterfall spills from a lake on the left plateau, the river runs out toward the bottom-right,
// and beyond the island the land falls away to the sea on the horizon.

export const PATH = new Polyline([
  [-118, 112], [-104, 110], [-88, 104], [-70, 96], [-52, 86], [-34, 76], [-17, 68], [0, 62],
  [15, 55], [28, 42], [34, 25], [30, 8], [24, -10], [28, -30], [42, -48], [60, -60],
  [78, -72], [92, -90], [102, -110], [110, -128], [116, -142],
]);
export const RIVER = new Polyline([
  [-78, -104], [-74, -96], [-69, -86], [-58, -70], [-54, -50], [-38, -32], [-36, -10], [-22, 8],
  [-20, 30], [-8, 46], [1, 64], [16, 80], [14, 102], [30, 124], [28, 150], [42, 176], [40, 205], [48, 240],
]);
/** A small meandering creek on the right meadow that joins the river. */
export const CREEK = new Polyline([
  [150, -40], [128, -28], [110, -12], [94, 4], [82, 22], [72, 44], [60, 66], [46, 86], [32, 100], [24, 108],
]);
/** Narrow footpaths that wander off the race route (painted only), like the side trails in the concept art. */
export const TRAILS = [
  new Polyline([[-74, 97], [-86, 76], [-100, 56], [-118, 40], [-136, 30]]),
  new Polyline([[30, 8], [52, 2], [74, -4], [98, -20], [124, -30]]),
  new Polyline([[42, -48], [22, -62], [2, -76], [-22, -84]]),
  new Polyline([[78, -72], [102, -56], [128, -52], [150, -62]]),
  new Polyline([[28, 42], [52, 40], [70, 30], [96, 28]]),
];
export const TRAIL_HALF_WIDTH = 1.3;

export const LAKE = { cx: -82, cz: -122, rx: 44, rz: 18, level: 22 };
export const SEA_LEVEL = 1.2;
export const START_S = 98;
export const GOAL_S = PATH.length - 7;
export const CASTLE = { x: 124, z: -156 };
export const PATH_HALF_WIDTH = 5.4;
/** Clearing at the start line where the six groups queue at 0 points. */
export const START_PLAZA = { s: START_S - 8, radius: 12 };

/** Arc length on RIVER where the lake spills over the cliff. */
export const FALLS_S = (() => {
  for (const p of RIVER.points) {
    const e = ((p.x - LAKE.cx) / LAKE.rx) ** 2 + ((p.z - LAKE.cz) / LAKE.rz) ** 2;
    if (e > 1) return p.s + 4;
  }
  return 10;
})();
/** Arc length on RIVER under the bridge. */
export const RIVER_BRIDGE_S = (() => {
  let best = Infinity;
  let bestS = 0;
  for (const p of PATH.points) {
    const n = RIVER.nearest(p.x, p.z);
    if (n.d < best) { best = n.d; bestS = n.s; }
  }
  return bestS;
})();

/** Water surface of the river: it steps down from the falls to the bridge, then runs out gently. */
export function riverLevel(s: number): number {
  const top = 9.5;
  const atBridge = 3.6;
  if (s <= RIVER_BRIDGE_S) return lerp(top, atBridge, Math.min(1, Math.max(0, (s - FALLS_S) / (RIVER_BRIDGE_S - FALLS_S))));
  return atBridge - Math.min(1.4, (s - RIVER_BRIDGE_S) * 0.012);
}
/** Kept for modules that only need a rough reference height of the river. */
export const RIVER_LEVEL = 3.6;

// ---- Per-world terrain style ----

export interface TerrainStyle { terraceStep: number; terraceAmount: number; coast: boolean }
let style: TerrainStyle = { terraceStep: 4.2, terraceAmount: 0.78, coast: true };

/** Switch the height-field style (terraces, coast) and rebuild the cached path/creek profiles. */
export function configureTerrain(next: TerrainStyle): void {
  style = next;
  pathProfile = computePathProfile();
  creekProfile = computeCreekProfile();
}

type HeightFn = (s: number) => number;
let walkOverride: HeightFn | null = null;
let bridgeOverride: HeightFn | null = null;
let groundOverride: ((x: number, z: number) => number) | null = null;

/** Island worlds replace the walking surface, the "on a bridge" squeeze and the ground height. */
export function setSurfaceOverrides(o: { walk?: HeightFn | null; bridge?: HeightFn | null; ground?: ((x: number, z: number) => number) | null }): void {
  walkOverride = o.walk ?? null;
  bridgeOverride = o.bridge ?? null;
  groundOverride = o.ground ?? null;
}

/** Height of whatever is underfoot at (x, z) in the active world (camera clamp, signs). */
export function groundHeight(x: number, z: number): number {
  return groundOverride ? groundOverride(x, z) : heightAt(x, z);
}

// ---- Height field ----

function lakeEllipse(x: number, z: number): number {
  const wobble = fbm(x / 20 + 3, z / 20, 2) * 0.12;
  return ((x - LAKE.cx) / LAKE.rx) ** 2 + ((z - LAKE.cz) / LAKE.rz) ** 2 + wobble;
}

/** 0 on land, 1 out at sea: a wobbly northern coastline beyond the castle and lake. */
export function coastMask(x: number, z: number): number {
  if (!style.coast) return 0;
  const wob = fbm(x / 40, 7.7, 2) * 14 + fbm(x / 13, 2.1, 2) * 4;
  // The castle headland and the far-left hills reach further out to sea.
  const reach = 22 * Math.exp(-((x - CASTLE.x) ** 2) / (2 * 30 ** 2)) + 30 * smoothstep(-90, -160, x) + 18 * smoothstep(170, 230, x);
  return smoothstep(-196 - reach, -236 - reach, z + wob);
}

/** Stepped meadows: flat plateaus separated by short cliffs, like the concept art. */
function terrace(h: number, step: number, amount: number): number {
  const q = h / step;
  const fl = Math.floor(q);
  const t = smoothstep(0.55, 0.95, q - fl);
  return lerp(h, (fl + t) * step, amount);
}

/** Terrain before the path, gorge and lake are cut in. */
export function baseHeight(x: number, z: number): number {
  let h = 7;
  h += smoothstep(120, -170, z) * 11; // the land climbs gently toward the far castle and lake
  h += fbm(x / 55, z / 55, 3) * 6;
  h += fbm(x / 18 + 40, z / 18, 2) * 0.35;
  h += 18 * Math.exp(-((x - CASTLE.x) ** 2 + (z - CASTLE.z) ** 2) / (2 * 20 ** 2));
  h += 16 * Math.exp(-((x + 130) ** 2 + (z + 70) ** 2) / (2 * 34 ** 2)); // wooded hill behind the falls
  h += 7 * Math.exp(-((x - 90) ** 2 + (z - 40) ** 2) / (2 * 26 ** 2));
  const coast = coastMask(x, z);
  // Hills frame the left and right edges of the island and sink toward the sea.
  const side = Math.max(smoothstep(-150, -230, x), smoothstep(190, 270, x));
  h += side * (20 + fbm(x / 60, z / 60, 3) * 14) * (1 - coast * 0.85);
  h -= smoothstep(110, 200, z) * 4; // lower the near foreground so the view opens up
  h = lerp(h, SEA_LEVEL - 6, coast);
  // Terraces only on dry land.
  return terrace(h, style.terraceStep, style.terraceAmount * smoothstep(SEA_LEVEL + 0.5, SEA_LEVEL + 4, h));
}

function smoothProfile(raw: Float32Array, radius: number): Float32Array {
  const n = raw.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let wsum = 0;
    for (let k = -radius * 2; k <= radius * 2; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      const w = Math.exp(-(k * k) / (2 * radius * radius));
      sum += raw[j] * w;
      wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}

function computePathProfile(): Float32Array {
  // Smoothed height of the base terrain along the path: walkable, gently climbing.
  const n = Math.ceil(PATH.length) + 1;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = PATH.at(i);
    raw[i] = baseHeight(p.x, p.z);
  }
  return smoothProfile(raw, 12);
}
let pathProfile = computePathProfile();

/** Arc length on RIVER where the creek joins. */
const CREEK_MOUTH_S = (() => {
  const end = CREEK.points[CREEK.points.length - 1];
  return RIVER.nearest(end.x, end.z).s;
})();

function computeCreekProfile(): Float32Array {
  // Water surface of the creek: follows the land but only ever flows downhill.
  const n = Math.ceil(CREEK.length) + 1;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = CREEK.at(i);
    raw[i] = baseHeight(p.x, p.z) - 0.8;
  }
  const smooth = smoothProfile(raw, 2);
  for (let i = 1; i < n; i++) smooth[i] = Math.min(smooth[i], smooth[i - 1] - 0.02);
  // Ease the final stretch down to the river.
  const mouth = riverLevel(CREEK_MOUTH_S) + 0.25;
  for (let i = 0; i < n; i++) smooth[i] = lerp(smooth[i], mouth, smoothstep(n - 16, n - 1, i));
  return smooth;
}
let creekProfile = computeCreekProfile();

function profileAt(profile: Float32Array, s: number): number {
  const f = Math.min(profile.length - 1.001, Math.max(0, s));
  const i = Math.floor(f);
  return lerp(profile[i], profile[i + 1], f - i);
}

export function pathHeight(s: number): number {
  return profileAt(pathProfile, s);
}

export function creekLevel(s: number): number {
  return profileAt(creekProfile, s);
}
export const CREEK_HALF_WIDTH = 1.5;

/** 0 in the deep gorge from the falls to the bridge, 1 where the river opens into a wide shallow valley. */
export function riverOpen(s: number): number {
  return smoothstep(RIVER_BRIDGE_S + 10, RIVER_BRIDGE_S + 45, s);
}

export function riverHalfWidth(s: number): number {
  if (s < FALLS_S) return 6;
  // Wide at the falls, narrower through the gorge, opening out again downstream.
  const falls = 2.2 * smoothstep(FALLS_S + 25, FALLS_S, s);
  return 4.0 + falls + 4.0 * riverOpen(s) + fbm(s / 11, 3.1, 2) * 0.8;
}
export const GORGE_WALL = 3.4;
export function gorgeWall(s: number): number {
  return lerp(GORGE_WALL, 9, riverOpen(s));
}

export interface TerrainSample {
  h: number;
  dPath: number;
  sPath: number;
  dRiver: number;
  sRiver: number;
  dCreek: number;
  dTrail: number;
  gorge: number; // 0..1 how much this point is inside the carved river channel
  lake: number; // ellipse value, <1 is lake
  coast: number;
}

export function sampleTerrain(x: number, z: number): TerrainSample {
  let h = baseHeight(x, z);
  const coast = coastMask(x, z);
  const e = lakeEllipse(x, z);
  // Keep a raised rim around the lake so it never spills, then scoop the basin.
  if (e < 2.6) h = lerp(h, Math.max(h, LAKE.level + 1.4), smoothstep(2.6, 1.5, e));
  const basin = LAKE.level - 0.6 - 4 * smoothstep(0.95, 0.25, e);
  h = lerp(h, basin, smoothstep(1.24, 0.93, e));

  const np = PATH.nearest(x, z, 13);
  if (np.d < PATH_HALF_WIDTH + 6) {
    const w = smoothstep(PATH_HALF_WIDTH + 5.5, PATH_HALF_WIDTH + 0.8, np.d);
    h = lerp(h, pathHeight(np.s) - 0.02, w);
  }
  const plaza = PATH.at(START_PLAZA.s);
  const dPlaza = Math.hypot(x - plaza.x, z - plaza.z);
  if (dPlaza < START_PLAZA.radius + 5) {
    h = lerp(h, pathHeight(START_PLAZA.s) - 0.02, smoothstep(START_PLAZA.radius + 5, START_PLAZA.radius + 0.5, dPlaza));
  }
  // The plaza counts as path for colouring and for keeping trees away.
  const dPath = Math.min(np.d, Math.max(0, dPlaza - (START_PLAZA.radius - PATH_HALF_WIDTH)));

  // Creek: a shallow channel stepping down the meadow terraces.
  const nc = CREEK.nearest(x, z, 6);
  if (nc.d < CREEK_HALF_WIDTH + 3.5) {
    const bed = creekLevel(nc.s) - 0.6;
    const t = smoothstep(CREEK_HALF_WIDTH + 3, CREEK_HALF_WIDTH - 0.3, nc.d);
    h = lerp(h, Math.min(h, bed), t);
  }

  const nr = RIVER.nearest(x, z, 21);
  let gorge = 0;
  if (nr.d < 20) {
    const half = riverHalfWidth(nr.s);
    if (nr.s < FALLS_S) {
      // Shallow outlet channel at lake level.
      const w = smoothstep(half + 2.4, half - 0.6, nr.d);
      h = lerp(h, Math.min(h, LAKE.level - 1.3), w);
    } else {
      const level = riverLevel(nr.s);
      const open = riverOpen(nr.s);
      const wall = gorgeWall(nr.s);
      // Downstream the valley widens: lower the banks toward the water but never below it.
      if (open > 0) {
        const bank = level + 1.6 + Math.max(0, nr.d - half) * 0.26;
        const target = Math.min(Math.max(h, level + 1.1), bank);
        h = lerp(h, target, open * smoothstep(half + wall + 10, half + wall, nr.d));
      }
      const head = smoothstep(FALLS_S - 0.6, FALLS_S + 0.8, nr.s);
      const t = smoothstep(half + wall, half - 0.2, nr.d) * head;
      if (t > 0) {
        // Uneven bed; the shallow bars in the open river make white rapids.
        const bars = open * (0.55 + 0.75 * fbm(x / 4, z / 4, 2));
        const bed = level - 1.9 - 0.6 * smoothstep(half, 0, nr.d) * (1 - open * 0.5) + bars;
        let carved = lerp(h, bed, t);
        // Terraced sandstone walls in the gorge.
        if (t > 0.02 && t < 0.98 && open < 0.6) {
          const step = 1.7;
          const q = carved / step;
          const fl = Math.floor(q);
          const terr = (fl + smoothstep(0.55, 0.95, q - fl)) * step;
          carved = lerp(carved, terr, 0.9 * Math.sin(t * Math.PI) * (1 - open));
        }
        h = carved;
        gorge = t;
      }
    }
  }
  // Plunge pool at the foot of the waterfall.
  const fp = RIVER.at(FALLS_S + 4);
  const dp = Math.hypot(x - fp.x, z - fp.z);
  if (dp < 10) {
    const t = smoothstep(9.5, 5, dp);
    h = lerp(h, Math.min(h, riverLevel(FALLS_S) - 2.3), t);
    gorge = Math.max(gorge, t);
  }
  let dTrail = Infinity;
  for (const trail of TRAILS) dTrail = Math.min(dTrail, trail.nearest(x, z, 3).d);
  return { h, dPath, sPath: np.s, dRiver: nr.d, sRiver: nr.s, dCreek: nc.d, dTrail, gorge, lake: e, coast };
}

export function heightAt(x: number, z: number): number {
  return sampleTerrain(x, z).h;
}

/** Height a walker stands at on the path centreline, including the bridge's gentle arch. */
export function walkHeight(s: number): number {
  if (walkOverride) return walkOverride(s);
  let h = pathHeight(s);
  if (s > BRIDGE.s0 && s < BRIDGE.s1) {
    const ramp = Math.min(1, s - BRIDGE.s0, BRIDGE.s1 - s);
    h += Math.sin(((s - BRIDGE.s0) / (BRIDGE.s1 - BRIDGE.s0)) * Math.PI) * BRIDGE_ARCH + 0.22 * ramp;
  }
  return h;
}
export const BRIDGE_ARCH = 1.1;

/** Arc-length range of PATH that spans the gorge (where the bridge goes). */
export const BRIDGE = (() => {
  let s0 = -1;
  let s1 = -1;
  for (let s = 0; s < PATH.length; s += 0.25) {
    const p = PATH.at(s);
    const nr = RIVER.nearest(p.x, p.z);
    const inside = nr.d < riverHalfWidth(nr.s) + gorgeWall(nr.s) + 0.4;
    if (inside && s0 < 0) s0 = s;
    if (inside) s1 = s;
  }
  return { s0: s0 - 1.2, s1: s1 + 1.2 };
})();

/** 0..1 how far onto the bridge a path position is (0 off the bridge). */
export function onBridge(s: number): number {
  if (bridgeOverride) return bridgeOverride(s);
  return smoothstep(BRIDGE.s0 - 2, BRIDGE.s0 + 1, s) * smoothstep(BRIDGE.s1 + 2, BRIDGE.s1 - 1, s);
}
