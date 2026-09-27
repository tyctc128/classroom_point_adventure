import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { groundHeight } from './world/layout';
import type { TeamCharacter } from './characters';

export interface CameraPose { target: THREE.Vector3; position: THREE.Vector3; fov: number }

export const OVERVIEW = {
  target: new THREE.Vector3(-5, 4, -30),
  position: new THREE.Vector3(40, 95, 190),
};
const BIRD = { target: new THREE.Vector3(10, 6, -25), position: new THREE.Vector3(0, 400, 150) };

/** Orbit camera with smooth fly-to, event focus that follows a walking character, and a UI-safe view offset. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  followEnabled = true;
  private followed?: TeamCharacter;
  private followDistance = 16;
  private fly?: { fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; t: number; duration: number };
  /** Pixels on the right covered by the teacher panel; the 3D view centres in the remaining area. */
  private overview: CameraPose = { target: OVERVIEW.target.clone(), position: OVERVIEW.position.clone(), fov: 50 };
  private rightInset = 0;
  private bottomInset = 0;

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3200);
    this.camera.position.copy(OVERVIEW.position);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.target.copy(OVERVIEW.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 520;
    this.controls.maxPolarAngle = 1.36;
    this.controls.screenSpacePanning = false;
    this.controls.zoomSpeed = 0.9;
    this.controls.addEventListener('start', () => {
      this.followed = undefined;
      this.fly = undefined;
    });
  }

  setInsets(right: number, bottom: number): void {
    this.rightInset = right;
    this.bottomInset = bottom;
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    // Shift the optical centre into the visible area left of the panel and above the cards.
    const fullW = width + this.rightInset;
    const fullH = height + this.bottomInset;
    this.camera.setViewOffset(fullW, fullH, this.rightInset, this.bottomInset, width, height);
    this.camera.updateProjectionMatrix();
  }

  flyTo(target: THREE.Vector3, position: THREE.Vector3, duration = 1.2): void {
    this.followed = undefined;
    this.fly = { fromT: this.controls.target.clone(), toT: target.clone(), fromP: this.camera.position.clone(), toP: position.clone(), t: 0, duration };
  }

  /** Each world may choose its own overview framing; R / 重設視角 returns to it. */
  setOverview(pose?: CameraPose): void {
    this.overview = pose ?? { target: OVERVIEW.target.clone(), position: OVERVIEW.position.clone(), fov: 50 };
    this.camera.fov = this.overview.fov;
    this.camera.updateProjectionMatrix();
  }

  resetView(): void { this.flyTo(this.overview.target, this.overview.position); }
  birdView(): void { this.flyTo(BIRD.target, BIRD.position); }

  zoom(factor: number): void {
    this.followed = undefined;
    this.fly = undefined;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(this.controls.target, this.controls.target.clone().add(offset.setLength(len)), 0.45);
  }

  focus(character: TeamCharacter): void {
    this.fly = undefined;
    this.followed = character;
    this.followDistance = Math.max(36, character.height * 4.2);
  }

  setAutoFocus(enabled: boolean): void {
    this.followEnabled = enabled;
    if (!enabled) this.followed = undefined;
  }

  update(dt: number): void {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.duration);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      this.controls.target.lerpVectors(f.fromT, f.toT, e);
      this.camera.position.lerpVectors(f.fromP, f.toP, e);
      if (f.t >= 1) this.fly = undefined;
    } else if (this.followed) {
      const c = this.followed;
      const goal = c.root.position.clone().add(new THREE.Vector3(0, c.height * 0.55 * c.displayScale, 0));
      const k = 1 - Math.exp(-dt * 4);
      const before = this.controls.target.clone();
      this.controls.target.lerp(goal, k);
      // Keep the current viewing direction but ease toward a pleasant close-up distance and pitch.
      const offset = this.camera.position.clone().sub(before);
      const sph = new THREE.Spherical().setFromVector3(offset);
      sph.radius += (this.followDistance - sph.radius) * k;
      sph.phi += (1.05 - sph.phi) * k;
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sph));
    }
    this.controls.update();
    // Never dip under the hills.
    const ground = groundHeight(this.camera.position.x, this.camera.position.z) + 2;
    if (this.camera.position.y < ground) this.camera.position.y = ground;
  }
}
