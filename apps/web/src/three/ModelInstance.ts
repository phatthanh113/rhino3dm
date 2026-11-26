import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  LayerInfo,
  ObjectRecord,
  ObjectsJson,
  SceneJson,
} from "../api/types";

const UP_AXIS_ROTATION = -Math.PI / 2;

export type PickResult = {
  record: ObjectRecord;
  point: THREE.Vector3;
  distance: number;
};

type ObjectEntry = {
  record: ObjectRecord;
  box: THREE.Box3;
};

/**
 * One loaded version. The GLB has one mesh per Rhino layer, so visibility is
 * per layer; objects.json carries the object boxes and triangle ranges used
 * for click inspection and measuring.
 */
export class ModelInstance {
  readonly key: string;
  readonly scene_json: SceneJson;
  readonly objects_json: ObjectsJson;
  readonly container = new THREE.Group();
  readonly layer_objects = new Map<string, THREE.Object3D>();
  readonly layer_by_path = new Map<string, LayerInfo>();
  readonly layer_boxes = new Map<string, THREE.Box3>();
  readonly materials: THREE.Material[] = [];
  readonly object_records = new Map<number, ObjectRecord>();
  readonly objects_by_node = new Map<string, ObjectEntry[]>();
  readonly full_box = new THREE.Box3();

  root: THREE.Group | null = null;
  grid: THREE.GridHelper | null = null;
  highlight_mesh: THREE.Mesh | null = null;

  private readonly box_hit_point = new THREE.Vector3();
  private readonly triangle_a = new THREE.Vector3();
  private readonly triangle_b = new THREE.Vector3();
  private readonly triangle_c = new THREE.Vector3();
  private readonly triangle_hit_point = new THREE.Vector3();

  constructor(key: string, scene_json: SceneJson, objects_json: ObjectsJson) {
    this.key = key;
    this.scene_json = scene_json;
    this.objects_json = objects_json;
    this.container.name = `version_${key}`;
  }

  prepare(gltf: GLTF): void {
    this.root = gltf.scene as THREE.Group;
    this.root.rotation.x = UP_AXIS_ROTATION;
    this.container.add(this.root);

    // Positions only: flat shading avoids uploading a normal buffer for
    // millions of triangles.
    this.root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || mesh.geometry.attributes.normal) {
        return;
      }
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        standard.flatShading = true;
        standard.needsUpdate = true;
      }
    });

    this.root.updateMatrixWorld(true);
    for (const layer of this.scene_json.layers) {
      const layer_object = this.root.getObjectByName(layer.node);
      if (!layer_object) {
        continue;
      }
      this.layer_objects.set(layer.node, layer_object);
      this.layer_by_path.set(layer.path, layer);
      layer_object.visible = Boolean(layer.visible);
      this.layer_boxes.set(
        layer.node,
        new THREE.Box3().setFromObject(layer_object),
      );
    }
    this.full_box.setFromObject(this.root);
    this.collect_materials();
    this.index_objects();
    this.create_grid();
  }

  private collect_materials(): void {
    const found = new Set<THREE.Material>();
    this.root?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        found.add(material);
      }
    });
    this.materials.splice(0, this.materials.length, ...found);
  }

  private index_objects(): void {
    this.object_records.clear();
    this.objects_by_node.clear();
    for (const record of this.objects_json.objects) {
      this.object_records.set(record.id, record);
      if (!this.objects_by_node.has(record.node)) {
        this.objects_by_node.set(record.node, []);
      }
      this.objects_by_node.get(record.node)!.push({
        record,
        box: new THREE.Box3(
          new THREE.Vector3(...record.bbox_min),
          new THREE.Vector3(...record.bbox_max),
        ),
      });
    }
  }

  private create_grid(): void {
    const size = this.full_box.getSize(new THREE.Vector3());
    const grid_size = Math.max(size.x, size.z) * 1.4;
    if (grid_size <= 0) {
      return;
    }
    const grid = new THREE.GridHelper(grid_size, 40, 0xa9bacd, 0xd3dce7);
    grid.position.y = this.full_box.min.y;
    grid.material.transparent = true;
    grid.material.opacity = 0.9;
    grid.material.depthWrite = false;
    this.container.add(grid);
    this.grid = grid;
  }

  set_layer_visible(path: string, is_visible: boolean): void {
    const layer = this.layer_by_path.get(path);
    if (!layer) {
      return;
    }
    const layer_object = this.layer_objects.get(layer.node);
    if (layer_object) {
      layer_object.visible = is_visible;
    }
    layer.visible = is_visible;
  }

  set_all_layers_visible(is_visible: boolean): void {
    for (const layer of this.scene_json.layers) {
      this.set_layer_visible(layer.path, is_visible);
    }
  }

  visible_stats(): {
    visible_triangles: number;
    total_triangles: number;
    visible_layers: number;
    total_layers: number;
  } {
    let visible_triangles = 0;
    let visible_layers = 0;
    for (const layer of this.scene_json.layers) {
      if (layer.visible) {
        visible_triangles += layer.triangle_count;
        visible_layers += 1;
      }
    }
    return {
      visible_triangles,
      total_triangles: this.scene_json.totals.triangles,
      visible_layers,
      total_layers: this.scene_json.layers.length,
    };
  }

  visible_box(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const [node, layer_box] of this.layer_boxes) {
      const layer_object = this.layer_objects.get(node);
      if (layer_object && layer_object.visible) {
        box.union(layer_box);
      }
    }
    if (box.isEmpty()) {
      box.copy(this.full_box);
    }
    return box;
  }

  pick(raycaster: THREE.Raycaster): PickResult | null {
    const inverse_matrix = new THREE.Matrix4();
    const candidates: {
      record: ObjectRecord;
      ray: THREE.Ray;
      distance: number;
    }[] = [];

    for (const [node, records] of this.objects_by_node) {
      const layer_object = this.layer_objects.get(node);
      if (!layer_object || !layer_object.visible) {
        continue;
      }
      inverse_matrix.copy(layer_object.matrixWorld).invert();
      const local_ray = raycaster.ray.clone().applyMatrix4(inverse_matrix);
      for (const entry of records) {
        if (local_ray.intersectBox(entry.box, this.box_hit_point) === null) {
          continue;
        }
        candidates.push({
          record: entry.record,
          ray: local_ray,
          distance: local_ray.origin.distanceTo(this.box_hit_point),
        });
      }
    }

    candidates.sort((left, right) => left.distance - right.distance);
    let best: PickResult | null = null;
    for (const candidate of candidates) {
      if (best && candidate.distance > best.distance) {
        break;
      }
      const layer_object = this.layer_objects.get(candidate.record.node);
      const hit = this.intersect_record(candidate.record, candidate.ray);
      if (!hit || !layer_object) {
        continue;
      }
      const world_point = hit.point.clone().applyMatrix4(layer_object.matrixWorld);
      if (!best || hit.distance < best.distance) {
        best = {
          record: candidate.record,
          point: world_point,
          distance: hit.distance,
        };
      }
    }
    return best;
  }

  private intersect_record(
    record: ObjectRecord,
    ray: THREE.Ray,
  ): { distance: number; point: THREE.Vector3 } | null {
    const layer_object = this.layer_objects.get(record.node);
    if (!layer_object) {
      return null;
    }
    const geometry = (layer_object as THREE.Mesh).geometry;
    const position = geometry?.attributes.position;
    const index = geometry?.index;
    if (!position || !index) {
      return null;
    }
    let best_distance = Infinity;
    let best_point: THREE.Vector3 | null = null;
    const index_start = record.triangle_start * 3;
    const index_end = index_start + record.triangle_count * 3;
    for (let cursor = index_start; cursor < index_end; cursor += 3) {
      this.triangle_a.fromBufferAttribute(position, index.getX(cursor));
      this.triangle_b.fromBufferAttribute(position, index.getX(cursor + 1));
      this.triangle_c.fromBufferAttribute(position, index.getX(cursor + 2));
      const hit = ray.intersectTriangle(
        this.triangle_a,
        this.triangle_b,
        this.triangle_c,
        false,
        this.triangle_hit_point,
      );
      if (hit === null) {
        continue;
      }
      const distance = ray.origin.distanceTo(hit);
      if (distance < best_distance) {
        best_distance = distance;
        best_point = hit.clone();
      }
    }
    return best_point ? { distance: best_distance, point: best_point } : null;
  }

  highlight(record: ObjectRecord): void {
    this.clear_highlight();
    const layer_object = this.layer_objects.get(record.node) as
      | THREE.Mesh
      | undefined;
    const geometry = layer_object?.geometry;
    const position = geometry?.attributes.position;
    const index = geometry?.index;
    if (!layer_object || !position || !index) {
      return;
    }
    const source_start = record.vertex_start * 3;
    const positions = new Float32Array(record.vertex_count * 3);
    positions.set(
      (position.array as Float32Array).subarray(
        source_start,
        source_start + positions.length,
      ),
    );

    const triangle_indices = new Uint32Array(record.triangle_count * 3);
    const index_start = record.triangle_start * 3;
    for (let cursor = 0; cursor < triangle_indices.length; cursor++) {
      triangle_indices[cursor] =
        index.getX(index_start + cursor) - record.vertex_start;
    }

    const highlight_geometry = new THREE.BufferGeometry();
    highlight_geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    highlight_geometry.setIndex(
      new THREE.BufferAttribute(triangle_indices, 1),
    );
    const material = new THREE.MeshBasicMaterial({
      color: 0xffc857,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(highlight_geometry, material);
    mesh.renderOrder = 20;
    layer_object.add(mesh);
    this.highlight_mesh = mesh;
  }

  clear_highlight(): void {
    if (!this.highlight_mesh) {
      return;
    }
    this.highlight_mesh.removeFromParent();
    this.highlight_mesh.geometry.dispose();
    (this.highlight_mesh.material as THREE.Material).dispose();
    this.highlight_mesh = null;
  }

  dispose(): void {
    this.clear_highlight();
    this.container.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const material of materials) {
          material.dispose();
        }
      }
    });
    this.container.removeFromParent();
  }
}
