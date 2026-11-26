import * as THREE from "three";
import type { Measurement } from "../api/types";
import type { PickResult } from "./ModelInstance";

const MEASURE_COLOR = 0x1f6fb2;
const MARKER_SCALE = 0.026;
const ARC_STEPS = 28;

export type MeasureMode = "distance" | "angle";

function make_marker_texture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    context.fillStyle = "#1f6fb2";
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = "#ffffff";
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function line_material(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: MEASURE_COLOR,
    depthTest: false,
    transparent: true,
    opacity: 1,
  });
}

/**
 * Distance with two clicks, angle with three clicks (the middle click is the
 * corner). Markers are screen-sized sprites, so they stay readable at any zoom.
 */
export class MeasureManager {
  enabled = false;

  private readonly scene: THREE.Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly pick: (event: PointerEvent) => PickResult | null;
  private readonly on_measure: (measurement: Measurement | null) => void;
  private readonly marker_material: THREE.SpriteMaterial;
  private mode: MeasureMode = "distance";
  private points: THREE.Vector3[] = [];
  private line: THREE.Line | null = null;
  private arc: THREE.Line | null = null;
  private markers: THREE.Sprite[] = [];

  constructor(
    scene: THREE.Scene,
    canvas: HTMLCanvasElement,
    pick: (event: PointerEvent) => PickResult | null,
    on_measure: (measurement: Measurement | null) => void,
  ) {
    this.scene = scene;
    this.canvas = canvas;
    this.pick = pick;
    this.on_measure = on_measure;
    this.marker_material = new THREE.SpriteMaterial({
      map: make_marker_texture(),
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
  }

  set_mode(mode: MeasureMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    this.clear();
  }

  get_mode(): MeasureMode {
    return this.mode;
  }

  set_enabled(enabled: boolean): void {
    this.enabled = enabled;
    this.canvas.classList.toggle("measure-mode", enabled);
    if (!enabled) {
      this.clear();
    }
  }

  handle_click(event: PointerEvent): boolean {
    if (!this.enabled) {
      return false;
    }
    const hit = this.pick(event);
    if (!hit) {
      return true;
    }

    const required = this.mode === "distance" ? 2 : 3;
    if (this.points.length >= required) {
      this.clear_geometry();
      this.points = [];
      this.on_measure(null);
    }

    this.points.push(hit.point.clone());
    this.add_marker(hit.point);
    this.update_preview();
    if (this.points.length === required) {
      this.emit_measurement();
    }
    return true;
  }

  clear(): void {
    this.clear_geometry();
    this.points = [];
    this.on_measure(null);
  }

  private emit_measurement(): void {
    const points = this.points.map(
      (point) => point.toArray() as [number, number, number],
    );
    if (this.mode === "distance") {
      const [start, end] = this.points;
      this.on_measure({
        kind: "distance",
        points,
        start: start.toArray() as [number, number, number],
        end: end.toArray() as [number, number, number],
        distance: start.distanceTo(end),
        angle: null,
      });
      return;
    }

    const [first, corner, last] = this.points;
    const arm1 = first.clone().sub(corner);
    const arm2 = last.clone().sub(corner);
    const has_arms = arm1.lengthSq() > 1e-12 && arm2.lengthSq() > 1e-12;
    const angle = has_arms ? THREE.MathUtils.radToDeg(arm1.angleTo(arm2)) : 0;
    if (has_arms) {
      this.add_arc(arm1, arm2, corner);
    }
    this.on_measure({
      kind: "angle",
      points,
      start: first.toArray() as [number, number, number],
      end: last.toArray() as [number, number, number],
      distance: null,
      angle,
    });
  }

  private update_preview(): void {
    this.clear_line();
    if (this.points.length < 2) {
      return;
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.points),
      line_material(),
    );
    line.renderOrder = 30;
    line.frustumCulled = false;
    this.scene.add(line);
    this.line = line;
  }

  private add_arc(
    arm1: THREE.Vector3,
    arm2: THREE.Vector3,
    corner: THREE.Vector3,
  ): void {
    const radius = Math.max(
      Math.min(arm1.length(), arm2.length()) * 0.22,
      0.05,
    );
    const normal = new THREE.Vector3().crossVectors(arm1, arm2);
    if (normal.lengthSq() < 1e-12) {
      return;
    }
    normal.normalize();
    const total = arm1.angleTo(arm2);
    const direction = arm1.clone().normalize();
    const points: THREE.Vector3[] = [];
    for (let index = 0; index <= ARC_STEPS; index += 1) {
      const rotation = new THREE.Quaternion().setFromAxisAngle(
        normal,
        (total * index) / ARC_STEPS,
      );
      points.push(
        direction
          .clone()
          .applyQuaternion(rotation)
          .multiplyScalar(radius)
          .add(corner),
      );
    }
    const arc = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      line_material(),
    );
    arc.renderOrder = 30;
    arc.frustumCulled = false;
    this.scene.add(arc);
    this.arc = arc;
  }

  private add_marker(point: THREE.Vector3): void {
    const marker = new THREE.Sprite(this.marker_material);
    marker.position.copy(point);
    marker.scale.set(MARKER_SCALE, MARKER_SCALE, 1);
    marker.renderOrder = 31;
    this.scene.add(marker);
    this.markers.push(marker);
  }

  private clear_line(): void {
    if (this.line) {
      this.line.removeFromParent();
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
      this.line = null;
    }
    if (this.arc) {
      this.arc.removeFromParent();
      this.arc.geometry.dispose();
      (this.arc.material as THREE.Material).dispose();
      this.arc = null;
    }
  }

  private clear_geometry(): void {
    this.clear_line();
    for (const marker of this.markers) {
      marker.removeFromParent();
    }
    this.markers = [];
  }

  dispose(): void {
    this.set_enabled(false);
    this.marker_material.map?.dispose();
    this.marker_material.dispose();
  }
}
