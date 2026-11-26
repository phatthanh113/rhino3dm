import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  CameraState,
  Measurement,
  ObjectRecord,
  ObjectsJson,
  SceneJson,
  SectionState,
  ViewDirection,
} from "../api/types";
import { ModelInstance, type PickResult } from "./ModelInstance";
import { SectionManager, type ClipAxis } from "./SectionManager";
import { MeasureManager, type MeasureMode } from "./MeasureManager";

const VIEW_DIRECTION = new THREE.Vector3(0.9, 0.65, 0.9).normalize();
const FIT_MARGIN = 1.15;
const ZOOM_SENSITIVITY = 0.0022;
const PINCH_ZOOM_SENSITIVITY = 0.004;
const ZOOM_DAMPING = 16;
const FLIGHT_DURATION = 520;
const CLICK_DRAG_LIMIT = 5;
const INTERACTION_IDLE_MS = 250;
const SLOW_FRAME_MS = 26;

export type ViewerStats = {
  visible_triangles: number;
  total_triangles: number;
  visible_layers: number;
  total_layers: number;
};

export type ViewerCallbacks = {
  on_load_progress?: (key: string, percent: number, message: string) => void;
  on_ready?: (key: string) => void;
  on_error?: (key: string, message: string) => void;
  on_selection?: (record: ObjectRecord | null) => void;
  on_measure?: (measurement: Measurement | null) => void;
  on_stats?: (stats: ViewerStats) => void;
  on_sections_changed?: (sections: SectionState) => void;
  on_active_changed?: (key: string) => void;
};

type Flight = {
  from_position: THREE.Vector3;
  to_position: THREE.Vector3;
  from_target: THREE.Vector3;
  to_target: THREE.Vector3;
  started: number;
  duration: number;
};

export class ViewerEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: ViewerCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly canvas: HTMLCanvasElement;
  private readonly instances = new Map<string, ModelInstance>();
  private readonly section_manager: SectionManager;
  private readonly measure_manager: MeasureManager;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resize_observer: ResizeObserver;

  private active_key: string | null = null;
  private hidden_layers = new Set<string>();
  private flight: Flight | null = null;
  private zoom_goal: number | null = null;
  private zoom_hit: THREE.Vector3 | null = null;
  private last_frame = 0;
  private pointer_down = false;
  private down_x = 0;
  private down_y = 0;
  private navigation_mode: "orbit" | "pan" = "orbit";
  private shift_pan = false;
  private base_pixel_ratio = 1;
  private pixel_ratio = 1;
  private frame_time = 16;
  private interacting = false;
  private last_interaction = 0;

  constructor(container: HTMLElement, callbacks: ViewerCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 1.5,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.localClippingEnabled = true;
    this.base_pixel_ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixel_ratio = this.base_pixel_ratio;
    this.renderer.setPixelRatio(this.base_pixel_ratio);
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 20000);
    this.camera.position.set(180, 140, 180);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xdde6f0, 1.2));
    const sun_light = new THREE.DirectionalLight(0xffffff, 2.1);
    sun_light.position.set(300, 500, 250);
    this.scene.add(sun_light);
    const fill_light = new THREE.DirectionalLight(0xbfd4ff, 0.7);
    fill_light.position.set(-350, 200, -250);
    this.scene.add(fill_light);
    const ground_light = new THREE.DirectionalLight(0xaecbff, 0.55);
    ground_light.position.set(-200, -500, 150);
    this.scene.add(ground_light);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI * 0.995;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 30000;
    this.controls.enableZoom = false;
    this.controls.screenSpacePanning = true;
    this.controls.panSpeed = 1.1;

    this.section_manager = new SectionManager(
      this.scene,
      this.camera,
      this.canvas,
      this.controls,
      () => this.all_materials(),
      (sections) => this.callbacks.on_sections_changed?.(sections),
    );
    this.measure_manager = new MeasureManager(
      this.scene,
      this.canvas,
      (event) => this.pick_at(event),
      (measurement) => this.callbacks.on_measure?.(measurement),
    );

    this.bind_events();
    this.resize_observer = new ResizeObserver(() => this.resize());
    this.resize_observer.observe(container);
    this.renderer.setAnimationLoop((now) => this.render_loop(now));
  }

  // SECTION: loading and versions

  async load_version(
    key: string,
    glb_url: string,
    scene_json: SceneJson,
    objects_json: ObjectsJson,
    activate = true,
  ): Promise<void> {
    if (this.instances.has(key)) {
      if (activate) {
        this.show_version(key);
      }
      return;
    }

    const instance = new ModelInstance(key, scene_json, objects_json);
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.load(
        glb_url,
        (gltf) => {
          instance.prepare(gltf);
          this.instances.set(key, instance);
          this.scene.add(instance.container);
          instance.container.visible = false;
          this.apply_hidden_to_instance(instance);
          this.section_manager.apply_clipping();
          if (activate || this.active_key === null) {
            this.show_version(key);
          }
          this.callbacks.on_ready?.(key);
          this.emit_stats();
          resolve();
        },
        (event) => {
          const percent = event.total
            ? Math.round((event.loaded / event.total) * 100)
            : 0;
          this.callbacks.on_load_progress?.(
            key,
            percent,
            event.total ? "Loading GLB" : "Loading GLB...",
          );
        },
        (error) => {
          const message =
            error instanceof Error ? error.message : "Could not load the GLB";
          this.callbacks.on_error?.(key, message);
          reject(error);
        },
      );
    });
  }

  has_version(key: string): boolean {
    return this.instances.has(key);
  }

  unload_version(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) {
      return;
    }
    instance.dispose();
    this.instances.delete(key);
    if (this.active_key === key) {
      this.active_key = null;
    }
  }

  show_version(key: string): void {
    const instance = this.instances.get(key);
    if (!instance) {
      return;
    }
    const was_empty = this.active_key === null;
    this.active_key = key;
    for (const other of this.instances.values()) {
      other.container.visible = other.key === key;
    }
    this.section_manager.set_bounds(instance.full_box);
    this.setup_camera_range(instance);
    this.measure_manager.clear();
    this.clear_selection();
    this.emit_stats();
    this.callbacks.on_active_changed?.(key);
    if (was_empty) {
      this.fit(true);
    }
  }

  private setup_camera_range(instance: ModelInstance): void {
    const size = instance.full_box.getSize(new THREE.Vector3());
    const diagonal = Math.max(size.length(), 1);
    this.camera.near = Math.max(diagonal * 0.001, 0.01);
    this.camera.far = Math.max(diagonal * 30, 100);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(diagonal * 0.001, 0.05);
    this.controls.maxDistance = Math.max(diagonal * 20, 100);
  }

  private active_instance(): ModelInstance | null {
    return this.active_key ? this.instances.get(this.active_key) ?? null : null;
  }

  private all_materials(): THREE.Material[] {
    const materials: THREE.Material[] = [];
    for (const instance of this.instances.values()) {
      materials.push(...instance.materials);
    }
    return materials;
  }

  private apply_hidden_to_instance(instance: ModelInstance): void {
    for (const layer of instance.scene_json.layers) {
      instance.set_layer_visible(
        layer.path,
        !this.hidden_layers.has(layer.path),
      );
    }
  }

  set_layer_visible(path: string, is_visible: boolean): void {
    if (is_visible) {
      this.hidden_layers.delete(path);
    } else {
      this.hidden_layers.add(path);
    }
    for (const instance of this.instances.values()) {
      instance.set_layer_visible(path, is_visible);
    }
    this.emit_stats();
  }

  set_layers_visible(paths: string[], is_visible: boolean): void {
    for (const path of paths) {
      if (is_visible) {
        this.hidden_layers.delete(path);
      } else {
        this.hidden_layers.add(path);
      }
      for (const instance of this.instances.values()) {
        instance.set_layer_visible(path, is_visible);
      }
    }
    this.emit_stats();
  }

  set_all_layers_visible(is_visible: boolean): void {
    const instance = this.active_instance();
    if (!instance) {
      return;
    }
    for (const layer of instance.scene_json.layers) {
      if (is_visible) {
        this.hidden_layers.delete(layer.path);
      } else {
        this.hidden_layers.add(layer.path);
      }
      for (const other of this.instances.values()) {
        other.set_layer_visible(layer.path, is_visible);
      }
    }
    this.emit_stats();
  }

  get_hidden_layers(): string[] {
    return [...this.hidden_layers];
  }

  emit_stats(): void {
    const instance = this.active_instance();
    if (!instance) {
      return;
    }
    this.callbacks.on_stats?.(instance.visible_stats());
  }

  // SECTION: navigation mode

  set_navigation_mode(mode: "orbit" | "pan"): void {
    this.navigation_mode = mode;
    this.shift_pan = false;
    this.apply_mouse_buttons();
    this.canvas.classList.toggle("pan-mode", mode === "pan");
  }

  private apply_mouse_buttons(): void {
    const left_is_pan = this.navigation_mode === "pan" || this.shift_pan;
    this.controls.mouseButtons.LEFT = left_is_pan
      ? THREE.MOUSE.PAN
      : THREE.MOUSE.ROTATE;
  }

  private mark_interaction(): void {
    this.interacting = true;
    this.last_interaction = performance.now();
  }

  // SECTION: picking and selection

  private pointer_ndc(event: { clientX: number; clientY: number }): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return this.pointer;
  }

  pick_at(event: PointerEvent): PickResult | null {
    const instance = this.active_instance();
    if (!instance) {
      return null;
    }
    this.raycaster.setFromCamera(this.pointer_ndc(event), this.camera);
    return instance.pick(this.raycaster);
  }

  select_at(event: PointerEvent): ObjectRecord | null {
    const hit = this.pick_at(event);
    if (!hit) {
      this.clear_selection();
      return null;
    }
    this.active_instance()?.highlight(hit.record);
    this.callbacks.on_selection?.(hit.record);
    return hit.record;
  }

  clear_selection(): void {
    for (const instance of this.instances.values()) {
      instance.clear_highlight();
    }
    this.callbacks.on_selection?.(null);
  }

  // SECTION: sections

  get_sections(): SectionState {
    return this.section_manager.get_state();
  }

  get_section_bounds(): Record<ClipAxis, { min: number; max: number }> {
    return this.section_manager.get_bounds();
  }

  set_sections(sections: SectionState, notify = true): void {
    this.section_manager.set_state(sections, notify);
  }

  set_section(axis: ClipAxis, partial: Partial<SectionState[ClipAxis]>): void {
    this.section_manager.set_section(axis, partial);
  }

  reset_sections(): void {
    this.section_manager.reset();
  }

  // SECTION: measure

  set_measure_enabled(enabled: boolean): void {
    this.measure_manager.set_enabled(enabled);
    if (enabled) {
      this.clear_selection();
    }
  }

  set_measure_mode(mode: MeasureMode): void {
    this.measure_manager.set_mode(mode);
  }

  get_measure_mode(): MeasureMode {
    return this.measure_manager.get_mode();
  }

  is_measure_enabled(): boolean {
    return this.measure_manager.enabled;
  }

  clear_measure(): void {
    this.measure_manager.clear();
  }

  // SECTION: camera

  get_camera(): CameraState {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
      up: this.camera.up.toArray() as [number, number, number],
    };
  }

  set_camera(camera: CameraState, instant = true): void {
    const position = new THREE.Vector3(...camera.position);
    const target = new THREE.Vector3(...camera.target);
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z) ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !Number.isFinite(target.z)
    ) {
      return;
    }
    if (camera.up) {
      this.camera.up.set(...camera.up);
    }
    if (instant) {
      this.flight = null;
      this.zoom_goal = null;
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
    } else {
      this.fly_to(position, target);
    }
  }

  fit(instant = false): void {
    const instance = this.active_instance();
    if (!instance) {
      return;
    }
    this.frame_box(instance.visible_box(), FIT_MARGIN, instant);
  }

  zoom_to_record(record: ObjectRecord): void {
    const instance = this.active_instance();
    const layer_object = instance?.layer_objects.get(record.node);
    if (!instance || !layer_object) {
      return;
    }
    const box = new THREE.Box3(
      new THREE.Vector3(...record.bbox_min),
      new THREE.Vector3(...record.bbox_max),
    ).applyMatrix4(layer_object.matrixWorld);
    this.frame_box(box, 2.2, false);
  }

  zoom_to_layer(path: string): void {
    const instance = this.active_instance();
    if (!instance) {
      return;
    }
    const layer = instance.layer_by_path.get(path);
    if (!layer) {
      return;
    }
    const box = instance.layer_boxes.get(layer.node);
    if (!box || box.isEmpty()) {
      return;
    }
    this.frame_box(box, 1.5, false);
  }

  private frame_box(box: THREE.Box3, margin: number, instant: boolean): void {
    if (box.isEmpty()) {
      return;
    }
    this.zoom_goal = null;
    this.zoom_hit = null;
    this.flight = null;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) {
      return;
    }
    const radius = Math.max(sphere.radius, 1);
    const half_fov = (this.camera.fov * Math.PI) / 360;
    const distance = (radius / Math.sin(half_fov)) * margin;

    const direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 1e-6) {
      direction.copy(VIEW_DIRECTION);
    }
    direction.normalize();

    if (instant) {
      this.camera.position
        .copy(sphere.center)
        .addScaledVector(direction, distance);
      this.controls.target.copy(sphere.center);
      this.controls.update();
      return;
    }
    this.fly_to(
      sphere.center.clone().addScaledVector(direction, distance),
      sphere.center.clone(),
    );
  }

  private fly_to(position: THREE.Vector3, target: THREE.Vector3): void {
    this.flight = {
      from_position: this.camera.position.clone(),
      to_position: position,
      from_target: this.controls.target.clone(),
      to_target: target,
      started: performance.now(),
      duration: FLIGHT_DURATION,
    };
  }

  set_view_direction(direction: ViewDirection): void {
    const instance = this.active_instance();
    if (!instance) {
      return;
    }
    const vectors: Record<ViewDirection, THREE.Vector3> = {
      top: new THREE.Vector3(0, 1, 0),
      bottom: new THREE.Vector3(0, -1, 0),
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
    };
    const is_top_down = direction === "top" || direction === "bottom";
    this.camera.up.set(0, is_top_down ? 0 : 1, is_top_down ? -1 : 0);

    const box = instance.visible_box();
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1);
    const half_fov = (this.camera.fov * Math.PI) / 360;
    const distance = (radius / Math.sin(half_fov)) * FIT_MARGIN;
    const position = center
      .clone()
      .addScaledVector(vectors[direction], distance);
    this.zoom_goal = null;
    this.zoom_hit = null;
    this.fly_to(position, center);
  }

  private zoom_point(event: MouseEvent): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer_ndc(event), this.camera);
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      this.controls.target,
    );
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  private on_wheel = (event: WheelEvent): void => {
    const instance = this.active_instance();
    if (!instance) {
      return;
    }
    event.preventDefault();
    this.mark_interaction();
    this.flight = null;

    let delta = event.deltaY;
    if (event.deltaMode === 1) {
      delta *= 16;
    } else if (event.deltaMode === 2) {
      delta *= 100;
    }
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    const sensitivity = event.ctrlKey
      ? PINCH_ZOOM_SENSITIVITY
      : ZOOM_SENSITIVITY;
    const distance = this.camera.position.distanceTo(this.controls.target);
    if (distance <= 1e-6) {
      return;
    }
    const base = this.zoom_goal === null ? distance : this.zoom_goal;
    const goal = THREE.MathUtils.clamp(
      base * Math.exp(delta * sensitivity),
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    if (Math.abs(goal - base) < base * 1e-6) {
      return;
    }
    this.zoom_goal = goal;
    this.zoom_hit = goal < distance ? this.zoom_point(event) : null;
  };

  private apply_zoom(now: number): void {
    if (this.zoom_goal === null) {
      return;
    }
    const elapsed = this.last_frame
      ? Math.min((now - this.last_frame) / 1000, 0.05)
      : 0.016;
    const distance = this.camera.position.distanceTo(this.controls.target);
    if (distance <= 1e-6) {
      this.zoom_goal = null;
      return;
    }
    const next_distance = THREE.MathUtils.damp(
      distance,
      this.zoom_goal,
      ZOOM_DAMPING,
      elapsed,
    );
    const ratio = 1 - next_distance / distance;
    if (this.zoom_hit && ratio > 0) {
      this.controls.target.lerp(this.zoom_hit, Math.min(ratio, 0.4));
    }
    const direction = this.camera.position.clone().sub(this.controls.target);
    direction.setLength(next_distance);
    this.camera.position.copy(this.controls.target).add(direction);
    if (Math.abs(next_distance - this.zoom_goal) <= this.zoom_goal * 0.0005) {
      this.zoom_goal = null;
      this.zoom_hit = null;
    }
  }

  private apply_flight(now: number): void {
    if (!this.flight) {
      return;
    }
    const progress = Math.min(
      1,
      (now - this.flight.started) / this.flight.duration,
    );
    const eased =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    this.camera.position.lerpVectors(
      this.flight.from_position,
      this.flight.to_position,
      eased,
    );
    this.controls.target.lerpVectors(
      this.flight.from_target,
      this.flight.to_target,
      eased,
    );
    if (progress >= 1) {
      this.flight = null;
    }
  }

  // SECTION: pointer events and render loop

  private bind_events(): void {
    this.canvas.addEventListener("wheel", this.on_wheel, { passive: false });
    this.canvas.addEventListener("pointerdown", this.on_pointer_down_capture, true);
    this.canvas.addEventListener("pointerdown", this.on_pointer_down);
    this.canvas.addEventListener("pointermove", this.on_pointer_move);
    window.addEventListener("pointerup", this.on_pointer_up);
    window.addEventListener("pointercancel", this.on_pointer_up);
  }

  private on_pointer_down_capture = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.shift_pan = event.shiftKey;
    this.apply_mouse_buttons();
  };

  private on_pointer_down = (event: PointerEvent): void => {
    this.mark_interaction();
    this.flight = null;
    this.zoom_goal = null;
    this.zoom_hit = null;
    if (event.button !== 0) {
      return;
    }
    this.pointer_down = true;
    this.down_x = event.clientX;
    this.down_y = event.clientY;
    if (this.navigation_mode === "pan" || event.shiftKey) {
      this.canvas.classList.add("pan-drag");
    }
    if (this.measure_manager.enabled) {
      return;
    }
    if (this.navigation_mode === "pan" || event.shiftKey) {
      return;
    }
    const axis = this.section_manager.hit_frame(event);
    if (axis) {
      this.section_manager.start_drag(event, axis);
    }
  };

  private on_pointer_move = (event: PointerEvent): void => {
    if (event.buttons !== 0) {
      this.mark_interaction();
      if (this.section_manager.has_pending()) {
        this.section_manager.move_drag(event);
      }
      return;
    }
    this.section_manager.move_drag(event);
  };

  private on_pointer_up = (event: PointerEvent): void => {
    this.canvas.classList.remove("pan-drag");
    if (this.shift_pan) {
      this.shift_pan = false;
      this.apply_mouse_buttons();
    }
    const was_dragging = this.section_manager.is_dragging();
    this.section_manager.finish_drag();
    if (was_dragging || !this.pointer_down) {
      this.pointer_down = false;
      return;
    }
    this.pointer_down = false;
    if (event.type === "pointerup" && event.button !== 0) {
      return;
    }
    const moved = Math.hypot(
      event.clientX - this.down_x,
      event.clientY - this.down_y,
    );
    if (moved > CLICK_DRAG_LIMIT) {
      return;
    }
    if (this.measure_manager.handle_click(event)) {
      return;
    }
    if (this.navigation_mode === "pan") {
      return;
    }
    this.select_at(event);
  };

  private render_loop(now: number): void {
    const frame_ms = this.last_frame ? now - this.last_frame : 16;
    const clamped = Math.min(Math.max(frame_ms, 1), 250);
    this.frame_time += (clamped - this.frame_time) * 0.12;
    if (this.interacting && now - this.last_interaction > INTERACTION_IDLE_MS) {
      this.interacting = false;
    }
    this.adapt_quality();
    this.apply_flight(now);
    this.apply_zoom(now);
    this.last_frame = now;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Drop the render resolution while dragging on a slow GPU. */
  private adapt_quality(): void {
    const is_slow = this.interacting && this.frame_time > SLOW_FRAME_MS;
    const target = is_slow ? 1 : this.base_pixel_ratio;
    if (Math.abs(target - this.pixel_ratio) < 0.01) {
      return;
    }
    this.pixel_ratio = target;
    this.renderer.setPixelRatio(target);
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resize_observer.disconnect();
    this.canvas.removeEventListener("wheel", this.on_wheel);
    this.canvas.removeEventListener(
      "pointerdown",
      this.on_pointer_down_capture,
      true,
    );
    this.canvas.removeEventListener("pointerdown", this.on_pointer_down);
    this.canvas.removeEventListener("pointermove", this.on_pointer_move);
    window.removeEventListener("pointerup", this.on_pointer_up);
    window.removeEventListener("pointercancel", this.on_pointer_up);
    this.section_manager.dispose();
    this.measure_manager.dispose();
    for (const instance of this.instances.values()) {
      instance.dispose();
    }
    this.instances.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
