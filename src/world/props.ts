import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRIDGE, CASTLE, GOAL_S, groundHeight, heightAt, PATH, PATH_HALF_WIDTH, START_S, walkHeight } from './layout';
import type { TerrainTheme } from './palette';

export type CastleColors = TerrainTheme['castle'];
import { mulberry32, noise2 } from './noise';

const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

// ---------------- Castle ----------------

export function buildCastle(colors: CastleColors, groundY?: number): THREE.Group {
  const castle = new THREE.Group();
  castle.name = 'Castle';
  const wall: THREE.BufferGeometry[] = [];
  const shade: THREE.BufferGeometry[] = [];
  const roof: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const stone: THREE.BufferGeometry[] = [];
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

  // Rocky plinth that seats the castle into the hilltop.
  stone.push(at(new THREE.CylinderGeometry(10.5, 12.5, 3, 18), 0, -1.2, 0));
  // Curtain walls with crenellations.
  const W = 15;
  const D = 12;
  const H = 5;
  wall.push(at(new THREE.BoxGeometry(W, H, 1.1), 0, H / 2, D / 2));
  wall.push(at(new THREE.BoxGeometry(W, H, 1.1), 0, H / 2, -D / 2));
  wall.push(at(new THREE.BoxGeometry(1.1, H, D), W / 2, H / 2, 0));
  wall.push(at(new THREE.BoxGeometry(1.1, H, D), -W / 2, H / 2, 0));
  for (let i = -7; i <= 7; i += 1.4) {
    shade.push(at(new THREE.BoxGeometry(0.7, 0.7, 1.2), i, H + 0.35, D / 2));
    shade.push(at(new THREE.BoxGeometry(0.7, 0.7, 1.2), i, H + 0.35, -D / 2));
  }
  for (let i = -5.6; i <= 5.6; i += 1.4) {
    shade.push(at(new THREE.BoxGeometry(1.2, 0.7, 0.7), W / 2, H + 0.35, i));
    shade.push(at(new THREE.BoxGeometry(1.2, 0.7, 0.7), -W / 2, H + 0.35, i));
  }
  // Gate.
  dark.push(at(new THREE.BoxGeometry(2.6, 3.2, 0.4), 0, 1.6, D / 2 + 0.5));
  dark.push(at(new THREE.CylinderGeometry(1.3, 1.3, 0.4, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), 0, 3.2, D / 2 + 0.5));
  // Corner towers.
  const tower = (x: number, z: number, r: number, h: number, roofH: number) => {
    wall.push(at(new THREE.CylinderGeometry(r, r * 1.08, h, 20), x, h / 2, z));
    shade.push(at(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.6, 20), x, h + 0.1, z));
    roof.push(at(new THREE.ConeGeometry(r * 1.35, roofH, 20), x, h + 0.4 + roofH / 2, z));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.6;
      dark.push(at(new THREE.BoxGeometry(0.35, 0.8, 0.2).rotateY(-a), x + Math.sin(a) * r, h * 0.62, z + Math.cos(a) * r));
    }
  };
  tower(W / 2, D / 2, 1.7, 8, 3.8);
  tower(-W / 2, D / 2, 1.7, 8, 3.8);
  tower(W / 2, -D / 2, 1.7, 9, 4.2);
  tower(-W / 2, -D / 2, 1.7, 9, 4.2);
  // Keep and spires.
  wall.push(at(new THREE.BoxGeometry(6.5, 11, 6), 0, 5.5, -1.5));
  roof.push(at(new THREE.ConeGeometry(5.2, 4.5, 4).rotateY(Math.PI / 4), 0, 13.25, -1.5));
  for (let r = 0; r < 3; r++) {
    for (const x of [-1.8, 0, 1.8]) dark.push(at(new THREE.BoxGeometry(0.55, 1.0, 0.2), x, 4 + r * 2.4, 1.55));
  }
  tower(-3.2, -3.8, 1.1, 14, 5);
  tower(3.4, -4.2, 0.9, 12.5, 4.2);
  tower(0.6, 1.2, 0.75, 15.5, 4.6);

  const glow = colors.emissive ? { emissive: colors.emissive, emissiveIntensity: 0.25 } : {};
  const mat = {
    wall: std(colors.wall, glow),
    shade: std(colors.shade, glow),
    roof: std(colors.roof, { roughness: 0.6, ...glow }),
    dark: std(colors.dark),
    stone: std(colors.stone, { flatShading: true }),
  };
  castle.add(
    new THREE.Mesh(mergeGeometries(wall)!, mat.wall),
    new THREE.Mesh(mergeGeometries(shade)!, mat.shade),
    new THREE.Mesh(mergeGeometries(roof)!, mat.roof),
    new THREE.Mesh(mergeGeometries(dark)!, mat.dark),
    new THREE.Mesh(mergeGeometries(stone)!, mat.stone),
  );
  // Flags on the tallest roofs.
  const flagMat = std(colors.flag, { side: THREE.DoubleSide });
  const poleMat = std('#6d6258');
  const flags: [number, number, number][] = [[0.6, 15.5 + 4.6 + 0.4, 1.2], [-3.2, 14 + 5 + 0.4, -3.8], [W / 2, 8 + 3.8 + 0.4, D / 2], [-W / 2, 8 + 3.8 + 0.4, D / 2]];
  for (const [x, y, z] of flags) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), poleMat);
    pole.position.set(x, y + 0.8, z);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), flagMat);
    flag.position.set(x + 0.55, y + 1.4, z);
    flag.name = 'Flag';
    castle.add(pole, flag);
  }
  const end = PATH.at(PATH.length);
  const yaw = Math.atan2(end.x - CASTLE.x, end.z - CASTLE.z);
  castle.rotation.y = yaw;
  castle.position.set(CASTLE.x, (groundY ?? heightAt(CASTLE.x, CASTLE.z)) + 0.2, CASTLE.z);
  castle.scale.setScalar(1.7);
  return shadowed(castle);
}

// ---------------- Bridge ----------------

/**
 * Wooden bridge(s) along the path. By default one bridge spans the river gorge; island worlds pass
 * their own ranges. `legsTo` gives the height trestle legs reach down to (null = no legs, rope rails only).
 */
export function buildBridge(
  ranges: [number, number][] = [[BRIDGE.s0, BRIDGE.s1]],
  opts: { halfWidth?: number; legsTo?: ((x: number, z: number) => number) | null } = {},
): THREE.Group {
  const bridge = new THREE.Group();
  bridge.name = 'Bridge';
  const plank: THREE.BufferGeometry[] = [];
  const beam: THREE.BufferGeometry[] = [];
  const random = mulberry32(5);
  const halfWidth = opts.halfWidth ?? PATH_HALF_WIDTH + 0.15;
  const legsTo = opts.legsTo === undefined ? heightAt : opts.legsTo;
  for (const [s0, s1] of ranges) {
  const place = (g: THREE.BufferGeometry, s: number, lateral: number, dy: number, list: THREE.BufferGeometry[]) => {
    const p = PATH.at(s);
    const t = PATH.tangent(s);
    const yaw = Math.atan2(t.x, t.z);
    g.rotateY(yaw);
    g.translate(p.x - t.z * lateral, walkHeight(s) + dy, p.z + t.x * lateral);
    list.push(g);
  };
  for (let s = s0; s <= s1; s += 0.55) {
    place(new THREE.BoxGeometry(halfWidth * 2, 0.2, 0.48).rotateZ((random() - 0.5) * 0.03), s, 0, -0.12, plank);
  }
  // Stringers under the deck.
  for (let s = s0; s < s1; s += 1) {
    for (const lat of [-halfWidth + 0.3, halfWidth - 0.3]) place(new THREE.BoxGeometry(0.28, 0.35, 1.05), s + 0.5, lat, -0.4, beam);
  }
  // Rails and posts.
  const postStep = 1.9;
  for (let s = s0; s <= s1 + 0.01; s += postStep) {
    for (const lat of [-halfWidth, halfWidth]) {
      place(new THREE.BoxGeometry(0.22, 1.3, 0.22), s, lat, 0.55, beam);
      if (s + postStep <= s1 + 0.01) {
        place(new THREE.BoxGeometry(0.14, 0.14, postStep), s + postStep / 2, lat, 1.1, beam);
        place(new THREE.BoxGeometry(0.1, 0.1, postStep), s + postStep / 2, lat, 0.6, beam);
      }
    }
  }
  // Trestle legs down to the gorge floor (or the sea bed).
  for (let s = s0 + 2; legsTo && s < s1 - 1; s += 3.6) {
    for (const lat of [-halfWidth + 0.4, halfWidth - 0.4]) {
      const p = PATH.at(s);
      const t = PATH.tangent(s);
      const gx = p.x - t.z * lat;
      const gz = p.z + t.x * lat;
      const top = walkHeight(s) - 0.5;
      const ground = legsTo(gx, gz) - 0.5;
      const len = top - ground;
      if (len < 0.5) continue;
      const leg = new THREE.CylinderGeometry(0.2, 0.25, len, 6);
      leg.translate(gx, ground + len / 2, gz);
      beam.push(leg);
    }
    place(new THREE.BoxGeometry(halfWidth * 2 - 0.6, 0.22, 0.22), s, 0, -0.9, beam);
  }
  }
  bridge.add(new THREE.Mesh(mergeGeometries(plank)!, std('#c89a62')));
  bridge.add(new THREE.Mesh(mergeGeometries(beam)!, std('#8d6340')));
  return shadowed(bridge);
}

// ---------------- Signs ----------------

function signTexture(text: string, width = 512, height = 192): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#a8703f');
  grad.addColorStop(1, '#7e4f2a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(60,35,15,0.35)';
  ctx.lineWidth = 3;
  for (let y = 24; y < height; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(y) * 3);
    ctx.bezierCurveTo(width * 0.3, y - 6, width * 0.7, y + 6, width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#5b381c';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, width - 14, height - 14);
  ctx.font = `900 ${Math.floor(height * 0.52)}px "Arial Black", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#4a2c14';
  ctx.strokeText(text, width / 2, height / 2 + 4);
  ctx.fillStyle = '#fff8e6';
  ctx.fillText(text, width / 2, height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function signBoard(text: string): THREE.Group {
  const g = new THREE.Group();
  const wood = std('#8a5a33');
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.35, 0.22), [
    wood, wood, wood, wood,
    new THREE.MeshStandardMaterial({ map: signTexture(text), roughness: 0.8 }),
    wood,
  ]);
  board.position.y = 2.3;
  board.rotation.z = -0.05;
  g.add(board);
  for (const x of [-1.25, 1.25]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 3.0, 8), wood);
    post.position.set(x, 1.3, -0.15);
    g.add(post);
  }
  return shadowed(g);
}

export function buildSigns(cameraHint: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Signs';
  const place = (text: string, s: number, side: number) => {
    const sign = signBoard(text);
    sign.scale.setScalar(1.6);
    const p = PATH.at(s);
    const t = PATH.tangent(s);
    const lat = (PATH_HALF_WIDTH + 3.6) * side;
    const x = p.x - t.z * lat;
    const z = p.z + t.x * lat;
    sign.position.set(x, groundHeight(x, z) - 0.1, z);
    // Face the classroom camera so the words stay readable.
    sign.rotation.y = Math.atan2(cameraHint.x - x, cameraHint.z - z);
    group.add(sign);
  };
  place('START', START_S + 2, 1);
  place('GOAL', GOAL_S - 1, 1);
  return group;
}

// ---------------- Distant mountains ----------------

export function buildMountains(colors: string[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Mountains';
  const random = mulberry32(99);
  const materials = colors.map((c) => std(c, { flatShading: true }));
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI * 0.95 + (i / 25) * Math.PI * 0.9 + (random() - 0.5) * 0.1;
    const r = 820 + random() * 260;
    const radius = 80 + random() * 90;
    const height = 28 + random() * 42;
    const geometry = new THREE.ConeGeometry(radius, height, 9, 4);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      const z = pos.getZ(k);
      const n = noise2(x * 0.03 + i * 7, z * 0.03 + y * 0.02);
      pos.setXYZ(k, x * (1 + n * 0.25), y + n * 5, z * (1 + n * 0.25));
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials[i % materials.length]);
    mesh.position.set(20 + Math.cos(a) * r, height / 2 - 14, -150 + Math.sin(a) * r);
    group.add(mesh);
  }
  return group;
}
