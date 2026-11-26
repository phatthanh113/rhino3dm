import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SectionAxisState, SectionState } from "../api/types";

const CLIP_AXES = ["y", "x", "z"] as const;
export type ClipAxis = (typeof CLIP_AXES)[number];

const AXIS_VECTORS: Record<ClipAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

const SECTION_COLORS: Record<ClipAxis, number> = {
  y: 0xff7a1a,
  x: 0x16a34a,
  z: 0x7c3aed,
};

const SECTION_GRAB_PIXELS = 10;

type SectionFrame = {
  group: THREE.Group;
  fill: THREE.Mesh;
  line: THREE.Line;
  handle: THREE.Mesh;
  points?: THREE.Vector3[];
};

function empty_sections(): SectionState {
  return {
    x: { enabled: false, value: 0, flipped: false },
    y: { enabled: false, value: 0, flipped: false },
    z: { enabled: false, value: 0, flipped: false },
  };
}

/**
 * GPU clipping planes plus a frame the user can drag on the model.
 * The planes are shared by every loaded version, so switching A/B keeps the
 * same cut.
 */
export class SectionManager {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly controls: OrbitControls;
  private readonly get_materials: () => THREE.Material[];
  private readonly on_change: (sections: SectionState) => void;
  private readonly bounds = new THREE.Box3();
  private readonly planes: Record<ClipAxis, THREE.Plane>;
  private readonly frames: Record<ClipAxis, SectionFrame>;
  private state: SectionState = empty_sections();
  private active_count = 0;
  private drag_pending: { axis: ClipAxis; x: number; y: number } | null = null;
  private dragging_axis: ClipAxis | null = null;
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    controls: OrbitControls,
    get_materials: () => THREE.Material[],
    on_change: (sections: SectionState) => void,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.controls = controls;
    this.get_materials = get_materials;
    this.on_change = on_change;
    this.planes = {
      x: new THREE.Plane(AXIS_VECTORS.x.clone(), 0),
      y: new THREE.Plane(AXIS_VECTORS.y.clone(), 0),
      z: new THREE.Plane(AXIS_VECTORS.z.clone(), 0),
    };
    this.frames = {
      x: this.create_frame("x"),
      y: this.create_frame("y"),
      z: this.create_frame("z"),
    };
  }

  private create_frame(axis: ClipAxis): SectionFrame {
    const color = SECTION_COLORS[axis];
    const group = new THREE.Group();
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    fill.renderOrder = 8;

    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    );
    line.renderOrder = 10;
    line.frustumCulled = false;

    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      }),
    );
    handle.renderOrder = 11;

    group.add(fill, line, handle);
    group.visible = false;
    this.scene.add(group);
    return { group, fill, line, handle };
  }

  get_state(): SectionState {
    return {
      x: { ...this.state.x },
      y: { ...this.state.y },
      z: { ...this.state.z },
    };
  }

  get_bounds(): Record<ClipAxis, { min: number; max: number }> {
    return {
      x: { min: this.bounds.min.x, max: this.bounds.max.x },
      y: { min: this.bounds.min.y, max: this.bounds.max.y },
      z: { min: this.bounds.min.z, max: this.bounds.max.z },
    };
  }

  set_bounds(box: THREE.Box3): void {
    this.bounds.copy(box);
    for (const axis of CLIP_AXES) {
      const state = this.state[axis];
      const min = this.bounds.min[axis];
      const max = this.bounds.max[axis];
      if (!Number.isFinite(state.value) || state.value < min || state.value > max) {
        state.value = (min + max) / 2;
      }
      this.update_plane(axis);
    }
    this.apply_clipping();
  }

  set_state(sections: SectionState, notify = true): void {
    const next = empty_sections();
    for (const axis of CLIP_AXES) {
      const incoming = sections?.[axis];
      if (!incoming) {
        continue;
      }
      next[axis] = {
        enabled: Boolean(incoming.enabled),
        value: Number(incoming.value) || 0,
        flipped: Boolean(incoming.flipped),
      };
    }
    this.state = next;
    for (const axis of CLIP_AXES) {
      const min = this.bounds.min[axis];
      const max = this.bounds.max[axis];
      if (Number.isFinite(min) && Number.isFinite(max)) {
        this.state[axis].value = THREE.MathUtils.clamp(
          this.state[axis].value,
          min,
          max,
        );
      }
      this.update_plane(axis);
    }
    this.apply_clipping();
    if (notify) {
      this.on_change(this.get_state());
    }
  }

  set_section(axis: ClipAxis, partial: Partial<SectionAxisState>): void {
    this.state[axis] = { ...this.state[axis], ...partial };
    const min = this.bounds.min[axis];
    const max = this.bounds.max[axis];
    if (Number.isFinite(min) && Number.isFinite(max)) {
      this.state[axis].value = THREE.MathUtils.clamp(
        this.state[axis].value,
        min,
        max,
      );
    }
    this.update_plane(axis);
    this.apply_clipping();
    this.on_change(this.get_state());
  }

  reset(): void {
    for (const axis of CLIP_AXES) {
      const min = this.bounds.min[axis];
      const max = this.bounds.max[axis];
      this.state[axis] = {
        enabled: false,
        value: (min + max) / 2,
        flipped: false,
      };
      this.update_plane(axis);
    }
    this.apply_clipping();
    this.on_change(this.get_state());
  }

  private section_axis_value(axis: ClipAxis): number {
    const plane = this.planes[axis];
    return this.state[axis].flipped ? plane.constant : -plane.constant;
  }

  private update_plane(axis: ClipAxis): void {
    const state = this.state[axis];
    const direction = state.flipped ? -1 : 1;
    const plane = this.planes[axis];
    plane.normal.copy(AXIS_VECTORS[axis]).multiplyScalar(direction);
    plane.constant = -direction * state.value;
    this.update_frame(axis);
  }

  private frame_points(
    axis: ClipAxis,
    position: number,
    center: THREE.Vector3,
    size: THREE.Vector3,
    inset: number,
  ): THREE.Vector3[] {
    const half_x = (size.x / 2) * inset;
    const half_y = (size.y / 2) * inset;
    const half_z = (size.z / 2) * inset;
    if (axis === "y") {
      return [
        new THREE.Vector3(center.x - half_x, position, center.z - half_z),
        new THREE.Vector3(center.x + half_x, position, center.z - half_z),
        new THREE.Vector3(center.x + half_x, position, center.z + half_z),
        new THREE.Vector3(center.x - half_x, position, center.z + half_z),
      ];
    }
    if (axis === "x") {
      return [
        new THREE.Vector3(position, center.y - half_y, center.z - half_z),
        new THREE.Vector3(position, center.y + half_y, center.z - half_z),
        new THREE.Vector3(position, center.y + half_y, center.z + half_z),
        new THREE.Vector3(position, center.y - half_y, center.z + half_z),
      ];
    }
    return [
      new THREE.Vector3(center.x - half_x, center.y - half_y, position),
      new THREE.Vector3(center.x + half_x, center.y - half_y, position),
      new THREE.Vector3(center.x + half_x, center.y + half_y, position),
      new THREE.Vector3(center.x - half_x, center.y + half_y, position),
    ];
  }

  private update_frame(axis: ClipAxis): void {
    const frame = this.frames[axis];
    if (this.bounds.isEmpty()) {
      return;
    }
    const position = this.section_axis_value(axis);
    const center = this.bounds.getCenter(new THREE.Vector3());
    const size = this.bounds.getSize(new THREE.Vector3());
    const inset = 0.985;
    const points = this.frame_points(axis, position, center, size, inset);

    const fill = frame.fill;
    if (axis === "y") {
      fill.rotation.set(-Math.PI / 2, 0, 0);
      fill.scale.set(size.x * inset, size.z * inset, 1);
      fill.position.set(center.x, position, center.z);
    } else if (axis === "x") {
      fill.rotation.set(0, Math.PI / 2, 0);
      fill.scale.set(size.z * inset, size.y * inset, 1);
      fill.position.set(position, center.y, center.z);
    } else {
      fill.rotation.set(0, 0, 0);
      fill.scale.set(size.x * inset, size.y * inset, 1);
      fill.position.set(center.x, center.y, position);
    }

    frame.line.geometry.dispose();
    frame.line.geometry = new THREE.BufferGeometry().setFromPoints([
      ...points,
      points[0].clone(),
    ]);
    frame.points = points;
    frame.handle.position.copy(fill.position);
    frame.handle.scale.setScalar(Math.max(size.length() * 0.004, 0.3));
    frame.group.visible = this.state[axis].enabled;
  }

  apply_clipping(): void {
    const active_planes: THREE.Plane[] = [];
    for (const axis of CLIP_AXES) {
      if (this.state[axis].enabled) {
        active_planes.push(this.planes[axis]);
      }
    }
    const length_changed = active_planes.length !== this.active_count;
    for (const material of this.get_materials()) {
      material.clippingPlanes = active_planes;
      if (length_changed) {
        material.needsUpdate = true;
      }
    }
    this.active_count = active_planes.length;
    for (const axis of CLIP_AXES) {
      this.update_frame(axis);
    }
  }

  hit_frame(event: PointerEvent): ClipAxis | null {
    this.camera.updateMatrixWorld();
    let best_axis: ClipAxis | null = null;
    let best_distance = SECTION_GRAB_PIXELS;
    for (const axis of CLIP_AXES) {
      if (!this.state[axis].enabled) {
        continue;
      }
      const distance = this.grab_distance(axis, event.clientX, event.clientY);
      if (distance <= best_distance) {
        best_distance = distance;
        best_axis = axis;
      }
    }
    return best_axis;
  }

  private grab_distance(axis: ClipAxis, client_x: number, client_y: number): number {
    const frame = this.frames[axis];
    if (!frame?.points) {
      return Infinity;
    }
    const screen_points = frame.points.map((point) =>
      this.project_to_screen(point),
    );
    let distance = Infinity;
    for (let index = 0; index < screen_points.length; index += 1) {
      const start = screen_points[index];
      const end = screen_points[(index + 1) % screen_points.length];
      distance = Math.min(
        distance,
        this.point_segment_distance(
          client_x,
          client_y,
          start.x,
          start.y,
          end.x,
          end.y,
        ),
      );
    }
    const handle = this.project_to_screen(frame.handle.position);
    return Math.min(
      distance,
      Math.hypot(client_x - handle.x, client_y - handle.y),
    );
  }

  private point_segment_distance(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): number {
    const dx = bx - ax;
    const dy = by - ay;
    const length_sq = dx * dx + dy * dy;
    if (length_sq < 1e-9) {
      return Math.hypot(px - ax, py - ay);
    }
    const ratio = Math.max(
      0,
      Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length_sq),
    );
    return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
  }

  private project_to_screen(point: THREE.Vector3): { x: number; y: number } {
    const projected = point.clone().project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  start_drag(event: PointerEvent, axis: ClipAxis): void {
    this.drag_pending = { axis, x: event.clientX, y: event.clientY };
  }

  has_pending(): boolean {
    return this.drag_pending !== null;
  }

  is_dragging(): boolean {
    return this.dragging_axis !== null;
  }

  move_drag(event: PointerEvent): void {
    if (this.drag_pending) {
      const moved = Math.hypot(
        event.clientX - this.drag_pending.x,
        event.clientY - this.drag_pending.y,
      );
      if (!this.dragging_axis && moved < 3) {
        return;
      }
      if (!this.dragging_axis) {
        this.dragging_axis = this.drag_pending.axis;
        this.controls.enabled = false;
        this.canvas.classList.add("section-drag");
      }
      this.move_from_pointer(this.dragging_axis, event);
      return;
    }
    if (event.target !== this.canvas) {
      this.canvas.classList.remove("section-grab");
      return;
    }
    this.canvas.classList.toggle("section-grab", Boolean(this.hit_frame(event)));
  }

  finish_drag(): void {
    this.drag_pending = null;
    this.dragging_axis = null;
    this.controls.enabled = true;
    this.canvas.classList.remove("section-drag");
  }

  private move_from_pointer(axis: ClipAxis, event: PointerEvent): void {
    const hit = this.pointer_hit(event, this.drag_plane(axis));
    if (!hit) {
      return;
    }
    const min = this.bounds.min[axis];
    const max = this.bounds.max[axis];
    const next = THREE.MathUtils.clamp(hit[axis], min, max);
    if (Math.abs(next - this.state[axis].value) < 1e-4) {
      return;
    }
    this.state[axis].value = next;
    this.update_plane(axis);
    this.on_change(this.get_state());
  }

  private drag_plane(axis: ClipAxis): THREE.Plane {
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    normal[axis] = 0;
    if (normal.lengthSq() < 1e-6) {
      normal.set(0, 1, 0);
    }
    normal.normalize();
    const center = this.bounds.getCenter(new THREE.Vector3());
    center[axis] = this.state[axis].value;
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
  }

  private pointer_hit(
    event: PointerEvent,
    plane: THREE.Plane,
  ): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  dispose(): void {
    for (const axis of CLIP_AXES) {
      const frame = this.frames[axis];
      frame.group.removeFromParent();
      frame.fill.geometry.dispose();
      (frame.fill.material as THREE.Material).dispose();
      frame.line.geometry.dispose();
      (frame.line.material as THREE.Material).dispose();
      frame.handle.geometry.dispose();
      (frame.handle.material as THREE.Material).dispose();
    }
  }
}
