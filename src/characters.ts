import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CASTLE, GOAL_S, onBridge, PATH, START_S, walkHeight } from './world/layout';
import { IDLE, REACTIONS, Team, TEAMS } from './teams';

/** Standing height (world units) of a normal-sized character. Large enough to read on a projector. */
export const CHARACTER_HEIGHT = 9.2;
const ROW_GAP = 8.8;
const LANE_GAP = 6.2;
const CLUSTER_GAP = 7;
const START_SPACING = 7.2;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * A walk along the path with a trapezoid speed profile (ease in, cruise, ease out). Distances are in
 * world units along the path, so the gait animation can be synced to the real ground speed.
 */
interface Anim { from: number; to: number; start: number; duration: number; cruise: number; ramp: number; dist: number; backward: boolean }

/** Longest time a single score change may take to walk; bigger jumps make the character hurry. */
const MAX_WALK_SECONDS = 7;
const RAMP_SECONDS = 0.45;
/** The supplied clips take short cartoon steps; walk a little brisker than that (steps play faster to match). */
const BRISK = 2.1;
/** Fastest the gait clip may be played before feet start to slide instead. */
const MAX_STEP_RATE = 3.4;

export class TeamCharacter {
  readonly root = new THREE.Group(); // positioned on the path, carries the disc
  readonly heading = new THREE.Group(); // yaw toward travel / camera
  readonly idleRoot = new THREE.Group();
  readonly reactionRoot = new THREE.Group();
  readonly height: number;
  mixer?: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current?: THREE.AnimationAction;
  progress = 0; // displayed 0..1
  score = 0;
  goal = 30;
  offset = new THREE.Vector2(); // x lateral, y longitudinal (smoothed)
  targetOffset = new THREE.Vector2();
  private move?: Anim;
  /** Ground speed (world units per second at displayScale 1) that matches the move clip at timeScale 1. */
  private gaitSpeed = 0;
  private lastOffset = new THREE.Vector2();
  private reaction?: { kind: 'positive' | 'negative'; start: number; duration: number };
  private idleTime: number;
  private idleWeight = 0;
  private restYaw = 0;
  private yaw = 0;
  loaded = false;
  /** Extra scale applied for readability at distance (1 = true size). */
  displayScale = 1;

  constructor(readonly team: Team, readonly lane: number) {
    this.height = CHARACTER_HEIGHT * (team.visualScale ?? 1);
    this.idleTime = lane * 1.73;
    this.root.name = team.id;
    this.root.add(this.heading);
    this.heading.add(this.idleRoot);
    this.idleRoot.add(this.reactionRoot);
    this.root.add(this.buildDisc());
  }

  private buildDisc(): THREE.Group {
    const disc = new THREE.Group();
    const r = THREE.MathUtils.clamp(this.height * 0.27, 2.2, 2.9);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 1.05, 0.26, 48),
      new THREE.MeshStandardMaterial({ color: '#fbf7ee', roughness: 0.5 }),
    );
    rim.position.y = 0.13;
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.84, r * 0.84, 0.3, 48),
      new THREE.MeshStandardMaterial({ color: this.team.color, roughness: 0.45, emissive: this.team.color, emissiveIntensity: 0.25 }),
    );
    top.position.y = 0.16;
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(r * 1.05, r * 1.45, 48),
      new THREE.MeshBasicMaterial({ color: this.team.color, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    rim.castShadow = true;
    rim.receiveShadow = true;
    top.receiveShadow = true;
    disc.add(rim, top, glow);
    return disc;
  }

  async load(loader: GLTFLoader, base: string): Promise<void> {
    const gltf = await loader.loadAsync(`${base}assets/characters/${this.team.model}.glb`);
    const visual = gltf.scene;
    visual.scale.setScalar(this.height / this.team.height);
    visual.position.y = 0.3; // stand on the disc
    visual.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // skinned bounds are unreliable
      }
    });
    this.reactionRoot.add(visual);
    this.mixer = new THREE.AnimationMixer(visual);
    for (const clip of gltf.animations) {
      for (const key of ['Idle', this.team.move, this.team.celebrate]) {
        if (clip.name.includes(key) && !this.actions[key]) {
          const action = this.mixer.clipAction(clip);
          if (key === this.team.celebrate && key !== 'Idle') {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          }
          this.actions[key] = action;
        }
      }
    }
    this.mixer.addEventListener('finished', () => {
      if (!this.reaction && !this.isMoving()) this.play('Idle');
    });
    this.gaitSpeed = this.measureGait(visual);
    this.play('Idle');
    this.loaded = true;
  }

  /**
   * Work out how fast the feet (or tentacle tips) sweep backward during the move clip, so the character
   * travels exactly as fast as its steps and never skates. Falls back to a height-based guess.
   */
  private measureGait(visual: THREE.Object3D): number {
    const action = this.actions[this.team.move];
    const cycle = action ? action.getClip().duration : 1;
    // Hoppers bounce in place in the clip: each hop carries them about half a body height.
    if (this.team.move === 'Hop') return (this.height * 0.5) / cycle;
    const fallback = (this.height * 0.28) / cycle;
    if (!action || !this.mixer) return fallback;
    const feet: THREE.Object3D[] = [];
    visual.traverse((o) => { if ((o as THREE.Bone).isBone && /^Foot[LR]$|Foot$/.test(o.name)) feet.push(o); });
    if (feet.length === 0) visual.traverse((o) => { if ((o as THREE.Bone).isBone && /^Arm\d\d05$/.test(o.name)) feet.push(o); });
    if (feet.length === 0) return fallback;
    const clip = action.getClip();
    this.mixer.stopAllAction();
    action.reset().play();
    const lo = feet.map(() => Infinity);
    const hi = feet.map(() => -Infinity);
    const v = new THREE.Vector3();
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      this.mixer.setTime((clip.duration * i) / steps);
      this.reactionRoot.updateMatrixWorld(true);
      feet.forEach((f, k) => {
        f.getWorldPosition(v);
        this.reactionRoot.worldToLocal(v);
        lo[k] = Math.min(lo[k], v.z);
        hi[k] = Math.max(hi[k], v.z);
      });
    }
    action.stop();
    this.mixer.setTime(0);
    const stride = feet.reduce((sum, _f, k) => sum + (hi[k] - lo[k]), 0) / feet.length;
    // Each foot sweeps its stride backward while planted, about half of every cycle.
    const speed = (stride * 2) / clip.duration;
    return speed > this.height * 0.08 && speed < this.height * 3 ? speed : fallback;
  }

  /** Measured gait speed, for diagnostics. */
  get gait(): number { return this.gaitSpeed; }

  play(key: string, restart = false): void {
    const next = this.actions[key] ?? this.actions.Idle;
    if (!next) return;
    if (next === this.current && !restart && next.isRunning()) return;
    next.reset();
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, 0.2, false);
    this.current = next;
  }

  isMoving(): boolean {
    return !!this.move;
  }

  /** Arc length along PATH for a progress value. */
  static arc(progress: number): number {
    return START_S + Math.min(1, Math.max(0, progress)) * (GOAL_S - START_S);
  }

  /**
   * Resting characters face the goal: they look ahead along the path (at the end, toward the castle),
   * turned slightly toward the classroom camera so faces stay readable in a three-quarter view.
   */
  setRestYaw(camera: THREE.Vector3): void {
    const p = this.root.position;
    const s = TeamCharacter.arc(this.progress) + this.offset.y;
    const ahead = s + 14 < PATH.length ? PATH.at(s + 14) : CASTLE;
    const goalYaw = Math.atan2(ahead.x - p.x, ahead.z - p.z);
    const camYaw = Math.atan2(camera.x - p.x, camera.z - p.z);
    const toCam = Math.atan2(Math.sin(camYaw - goalYaw), Math.cos(camYaw - goalYaw));
    this.restYaw = goalYaw + THREE.MathUtils.clamp(toCam * 0.25, -0.6, 0.6);
  }

  setScore(score: number, goal: number, delta: number, animate: boolean, now: number): void {
    this.score = score;
    this.goal = goal;
    const destination = Math.min(1, score / goal);
    this.reaction = undefined;
    if (!animate) {
      this.progress = destination;
      this.move = undefined;
      this.play('Idle');
      return;
    }
    const from = this.progress;
    const dist = Math.abs(destination - from) * (GOAL_S - START_S);
    if (dist > 0.05) {
      const backward = destination < from;
      // Walk at the natural gait speed (slower when stepping back); hurry only for big jumps.
      const brisk = this.team.move === 'Hop' ? 1.15 : BRISK;
      const natural = this.gaitSpeed * this.displayScale * brisk * (backward ? 0.6 : 1);
      const ramp = Math.min(RAMP_SECONDS, dist / Math.max(natural, 0.01) / 2);
      let cruise = natural;
      let duration = dist / cruise + ramp;
      if (duration > MAX_WALK_SECONDS) {
        cruise = dist / (MAX_WALK_SECONDS - ramp);
        duration = MAX_WALK_SECONDS;
      }
      this.move = { from, to: destination, start: now, duration, cruise, ramp, dist, backward };
      this.play(this.team.move, true);
    } else {
      this.move = undefined;
      this.play(delta > 0 ? this.team.celebrate : 'Idle', true);
    }
    if (delta !== 0) {
      // Celebrate once arrived; a deduction droops the head while stepping back.
      const arrive = this.move && delta > 0 ? this.move.duration : 0;
      const duration = delta > 0 ? 1.65 : Math.max(2.15, (this.move?.duration ?? 0) + 0.6);
      this.reaction = { kind: delta > 0 ? 'positive' : 'negative', start: now + arrive, duration };
    }
  }

  update(dt: number, now: number): void {
    // Travel along the path.
    let travelling = false;
    let groundSpeed = 0;
    if (this.move) {
      const m = this.move;
      const t = Math.min(m.duration, Math.max(0, now - m.start));
      // Trapezoid profile: accelerate over `ramp`, cruise, decelerate over the last `ramp`.
      const a = m.cruise / Math.max(m.ramp, 1e-3);
      let covered: number;
      if (t < m.ramp) {
        covered = 0.5 * a * t * t;
        groundSpeed = a * t;
      } else if (t < m.duration - m.ramp) {
        covered = 0.5 * m.cruise * m.ramp + m.cruise * (t - m.ramp);
        groundSpeed = m.cruise;
      } else {
        const left = m.duration - t;
        covered = m.dist - 0.5 * a * left * left;
        groundSpeed = a * left;
      }
      this.progress = m.from + (m.to - m.from) * Math.min(1, covered / m.dist);
      travelling = t < m.duration;
      if (!travelling) {
        this.progress = m.to;
        const positive = m.to > m.from;
        this.move = undefined;
        groundSpeed = 0;
        this.play(positive ? this.team.celebrate : 'Idle', true);
      }
    }
    this.lastOffset.copy(this.offset);
    this.offset.lerp(this.targetOffset, 1 - Math.exp(-dt * 5));
    // Shuffling into formation also counts as walking, so nobody glides sideways.
    const shuffle = dt > 0 ? this.lastOffset.distanceTo(this.offset) / dt : 0;
    const s = TeamCharacter.arc(this.progress) + this.offset.y;
    const p = PATH.at(s);
    const tan = PATH.tangent(s);
    // Squeeze toward the middle on the narrow bridge.
    const lateral = this.offset.x * (1 - 0.72 * onBridge(s));
    const x = p.x - tan.z * lateral;
    const z = p.z + tan.x * lateral;
    this.root.position.set(x, walkHeight(s) + 0.02, z);

    // Face along the path while walking (stepping back keeps facing the goal and plays the gait in
    // reverse); face the goal, turned slightly to the class, when resting.
    const desiredYaw = travelling ? Math.atan2(tan.x, tan.z) : this.restYaw;
    const diff = Math.atan2(Math.sin(desiredYaw - this.yaw), Math.cos(desiredYaw - this.yaw));
    this.yaw += diff * (1 - Math.exp(-dt * (travelling ? 10 : 5)));
    this.heading.rotation.y = this.yaw;

    // Score reactions.
    const r = this.reactionRoot;
    r.position.set(0, 0, 0);
    r.rotation.set(0, 0, 0);
    r.scale.set(1, 1, 1);
    if (this.reaction && now >= this.reaction.start) {
      const t = (now - this.reaction.start) / this.reaction.duration;
      const prof = REACTIONS[this.team.id];
      if (t >= 1) {
        this.reaction = undefined;
        if (!this.move) this.play('Idle');
      } else if (this.reaction.kind === 'positive') {
        const bounce = Math.abs(Math.sin(t * Math.PI * prof.hops));
        const envelope = Math.sin(t * Math.PI);
        r.position.y = bounce * prof.jump * (this.height / 2);
        r.rotation.y = Math.PI * 2 * prof.turns * smooth(0, 1, t);
        r.rotation.z = Math.sin(t * Math.PI * 4) * prof.sway * envelope;
        const stretch = 0.06 * bounce;
        r.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);
      } else {
        const amount = smooth(0, 0.2, t) * (1 - smooth(0.72, 1, t));
        r.rotation.x = prof.slump * 1.6 * amount;
        r.rotation.z = Math.sin(t * Math.PI * 4) * 0.035 * amount;
        r.scale.set(1 + 0.025 * amount, 1 - 0.075 * amount, 1 + 0.025 * amount);
      }
    }

    // Breathing and swaying while waiting.
    const waiting = !this.reaction && !this.move;
    this.idleWeight += ((waiting ? 1 : 0) - this.idleWeight) * Math.min(1, dt * 6);
    this.idleTime += dt;
    const idle = IDLE[this.team.id];
    const cycle = (this.idleTime * Math.PI * 2) / idle.period;
    const breath = Math.sin(cycle) * 0.025 * this.idleWeight;
    this.idleRoot.scale.set(1 - breath * 0.3, 1 + breath, 1 - breath * 0.3);
    this.idleRoot.rotation.z = Math.sin(cycle * 0.67) * idle.sway * this.idleWeight;
    this.idleRoot.rotation.y = Math.sin(cycle * 0.43) * 0.12 * this.idleWeight;
    // Keep the gait clip in step with the real ground speed.
    const moveAction = this.actions[this.team.move];
    if (this.mixer && moveAction) {
      const base = Math.max(this.gaitSpeed * this.displayScale, 0.01);
      if (travelling) {
        moveAction.timeScale = this.move!.backward ? -1 : 1;
        this.mixer.timeScale = THREE.MathUtils.clamp(groundSpeed / base, 0.3, MAX_STEP_RATE);
      } else if (!this.reaction && shuffle > base * 0.35) {
        if (this.current !== moveAction) this.play(this.team.move);
        moveAction.timeScale = 1;
        this.mixer.timeScale = THREE.MathUtils.clamp(shuffle / base, 0.4, 2.2);
      } else {
        moveAction.timeScale = 1;
        if (this.current === moveAction && !this.reaction) this.play('Idle');
        this.mixer.timeScale = this.reaction && now >= this.reaction.start ? (this.reaction.kind === 'positive' ? 1.1 : 0.8) : 1;
      }
    }
    this.mixer?.update(dt);
  }

  labelAnchor(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.root.position).add(new THREE.Vector3(0, (this.height + 0.9 + this.reactionRoot.position.y) * this.displayScale, 0));
  }
}

export class Roster {
  readonly characters: TeamCharacter[];
  readonly group = new THREE.Group();

  constructor() {
    this.characters = TEAMS.map((team, i) => new TeamCharacter(team, i));
    this.characters.forEach((c) => this.group.add(c.root));
    this.group.name = 'Characters';
  }

  /** Load every character in parallel; `onEach` runs as soon as each one is ready so it can appear at once. */
  async load(onEach?: (c: TeamCharacter) => void): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder); // models are meshopt-compressed (scripts/optimize_glb.py + gltf-transform)
    const base = import.meta.env.BASE_URL;
    await Promise.all(this.characters.map((c) => c.load(loader, base).then(() => onEach?.(c))));
  }

  byId(id: string): TeamCharacter {
    return this.characters.find((c) => c.team.id === id)!;
  }

  /**
   * Characters that are close together along the path form a small formation
   * (up to three abreast, extra rows behind) so nobody overlaps — including at the start.
   */
  private formation(): void {
    const sorted = [...this.characters].sort((a, b) => TeamCharacter.arc(b.progress) - TeamCharacter.arc(a.progress) || a.lane - b.lane);
    const clusters: TeamCharacter[][] = [];
    for (const c of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && TeamCharacter.arc(last[last.length - 1].progress) - TeamCharacter.arc(c.progress) < CLUSTER_GAP) last.push(c);
      else clusters.push([c]);
    }
    for (const cluster of clusters) {
      if (cluster.every((c) => c.progress < 0.001)) {
        this.startLineup(cluster);
        continue;
      }
      // Two abreast, extra rows behind (rows spread sideways on screen, so fewer figures hide each other).
      const perRow = Math.min(2, cluster.length);
      cluster.forEach((c, k) => {
        const row = Math.floor(k / perRow);
        const inRow = Math.min(perRow, cluster.length - row * perRow);
        const col = k % perRow;
        const lateral = (col - (inRow - 1) / 2) * LANE_GAP;
        // Stagger alternate rows so the back row peeks between the front row.
        const stagger = row % 2 === 1 ? LANE_GAP * 0.25 : 0;
        c.targetOffset.set(lateral + stagger, -row * ROW_GAP);
      });
    }
  }

  /**
   * At 0 points everyone queues on the path behind the start line (group 1 in front), zig-zagging
   * left and right. The queue runs across the screen, so all six figures and tags stay visible,
   * and whoever scores steps out past the line.
   */
  private startLineup(cluster: TeamCharacter[]): void {
    const ordered = [...cluster].sort((a, b) => a.lane - b.lane);
    ordered.forEach((c, k) => {
      c.targetOffset.set(k % 2 === 0 ? -2.6 : 2.6, -(2 + k * START_SPACING));
    });
  }

  update(dt: number, now: number, camera?: THREE.Camera): void {
    this.formation();
    this.characters.forEach((c) => {
      c.update(dt, now);
      if (camera) {
        // Figures far down the path are enlarged a little so every team stays readable in the wide view.
        const d = camera.position.distanceTo(c.root.position);
        const k = THREE.MathUtils.clamp(Math.pow(d / 150, 0.7), 1, 2.0);
        c.displayScale += (k - c.displayScale) * Math.min(1, dt * 4);
        c.root.scale.setScalar(c.displayScale);
      }
    });
  }
}
