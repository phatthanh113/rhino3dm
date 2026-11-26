export type Project = {
  id: number;
  slug: string;
  name: string;
  created_at: string;
};

export type Version = {
  id: number;
  label: string;
  status: "pending" | "converting" | "ready" | "error";
  progress: number;
  message: string | null;
  source_size: number | null;
  has_source: boolean;
  triangle_count: number | null;
  object_count: number | null;
  layer_count: number | null;
  glb_bytes: number | null;
  created_at: string;
  converted_at: string | null;
};

export type VersionDetail = Version & {
  source_name: string | null;
  glb_url: string | null;
  scene_url: string | null;
  objects_url: string | null;
};

export type SavedView = {
  id: number;
  name: string;
  hidden_layers: string[];
  hidden_materials: string[];
  sections: SectionState;
  camera: CameraState;
  created_on_version: string | null;
  created_at: string;
  updated_at: string;
};

export type SavedViewInput = {
  name: string;
  hidden_layers: string[];
  hidden_materials: string[];
  sections: SectionState;
  camera: CameraState;
  created_on_version: string | null;
};

export type ScanResult = {
  projects: number;
  versions: number;
  queued: number;
  message: string;
  deletable_sources: { label: string; bytes: number }[];
  deletable_bytes: number;
};

export type DeleteSourceResult = {
  label: string;
  freed_bytes: number;
  message: string;
};

export type SectionAxisState = {
  enabled: boolean;
  value: number;
  flipped: boolean;
};

export type SectionState = Record<"x" | "y" | "z", SectionAxisState>;

export type CameraState = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
};

export type LayerInfo = {
  index: number;
  path: string;
  name: string;
  depth: number;
  color: string;
  visible: boolean;
  object_count: number;
  triangle_count: number;
  node: string;
};

export type SceneTotals = {
  layers_with_mesh: number;
  objects: number;
  object_records: number;
  objects_json_bytes: number;
  instances_expanded: number;
  triangles: number;
  glb_bytes: number;
  glb_triangles_verified: number | null;
};

export type SceneJson = {
  source_file: string;
  source_size_bytes: number;
  source_units: string;
  scale_to_meters: number;
  up_axis: string;
  center_mm: [number, number, number];
  bounds_m: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  totals: SceneTotals;
  skipped: {
    by_type: Record<string, number>;
    missing_definitions: number;
  };
  layers: LayerInfo[];
};

export type ObjectRecord = {
  id: number;
  type: string;
  name: string;
  block: string | null;
  vertex_count: number;
  triangle_count: number;
  vertex_start: number;
  triangle_start: number;
  layer: number;
  layer_path: string;
  node: string;
  bbox_min: [number, number, number];
  bbox_max: [number, number, number];
};

export type ObjectsJson = {
  total: number;
  objects: ObjectRecord[];
};

export type Measurement = {
  kind: "distance" | "angle";
  points: [number, number, number][];
  start: [number, number, number];
  end: [number, number, number];
  distance: number | null;
  angle: number | null;
};

export type ViewDirection =
  | "top"
  | "bottom"
  | "front"
  | "back"
  | "left"
  | "right";
