import { useEffect, useRef, useState } from "react";
import type {
  Measurement,
  ObjectRecord,
  ObjectsJson,
  SceneJson,
  SectionState,
  VersionDetail,
  ViewDirection,
} from "../../api/types";
import { fetch_objects, fetch_scene } from "../../api/client";
import { Icon } from "../../components/Icon";
import {
  ViewerEngine,
  type ViewerStats,
} from "../../three/ViewerEngine";
import type { MeasureMode } from "../../three/MeasureManager";
import {
  format_coordinates,
  format_length,
  format_meters,
  format_number,
  LENGTH_UNITS,
  type LengthUnit,
} from "./format";

export type ToolName = "select" | "pan" | "layers" | "section";

export type StageCallbacks = {
  on_engine: (engine: ViewerEngine | null) => void;
  on_scene_loaded: (label: string, scene: SceneJson) => void;
  on_stats: (stats: ViewerStats) => void;
  on_selection: (record: ObjectRecord | null) => void;
  on_measure: (measurement: Measurement | null) => void;
  on_sections: (sections: SectionState) => void;
  on_display_label: (label: string) => void;
  on_error: (message: string) => void;
};

function object_size(record: ObjectRecord): string {
  const size = [
    record.bbox_max[0] - record.bbox_min[0],
    record.bbox_max[1] - record.bbox_min[1],
    record.bbox_max[2] - record.bbox_min[2],
  ];
  return size.map((value) => format_meters(value)).join(" × ");
}

function ObjectCard({
  record,
  on_zoom,
  on_close,
}: {
  record: ObjectRecord;
  on_zoom: () => void;
  on_close: () => void;
}) {
  return (
    <div className="object-card">
      <div className="object-card-head">
        <strong>{record.name || `${record.type} #${record.id}`}</strong>
        <button
          className="icon-button"
          type="button"
          title="Close"
          aria-label="Close object details"
          onClick={on_close}
        >
          <Icon name="x" />
        </button>
      </div>
      <dl className="object-rows">
        <dt>Type</dt>
        <dd>{record.type}</dd>
        <dt>Layer</dt>
        <dd>{record.layer_path}</dd>
        <dt>Size</dt>
        <dd>{object_size(record)}</dd>
        <dt>Triangles</dt>
        <dd>{format_number(record.triangle_count)}</dd>
      </dl>
      <button className="button" type="button" onClick={on_zoom}>
        Zoom to object
      </button>
    </div>
  );
}

function MeasurePanel({
  measurement,
  mode,
  unit,
  on_mode,
  on_unit,
  on_clear,
}: {
  measurement: Measurement | null;
  mode: MeasureMode;
  unit: LengthUnit;
  on_mode: (mode: MeasureMode) => void;
  on_unit: (unit: LengthUnit) => void;
  on_clear: () => void;
}) {
  const is_angle = mode === "angle";
  const arm_length = (
    from: [number, number, number],
    to: [number, number, number],
  ) => Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);

  return (
    <div className="measure-panel">
      <div className="measure-panel-head">
        <strong>Measure</strong>
        <button type="button" onClick={on_clear} disabled={!measurement}>
          Clear
        </button>
      </div>

      <div className="measure-modes" role="group" aria-label="Measure mode">
        <button
          className={!is_angle ? "active" : ""}
          type="button"
          onClick={() => on_mode("distance")}
        >
          Distance · 2 points
        </button>
        <button
          className={is_angle ? "active" : ""}
          type="button"
          onClick={() => on_mode("angle")}
        >
          Angle · 3 points
        </button>
      </div>

      <label className="measure-unit">
        <span>Unit</span>
        <select
          value={unit}
          onChange={(event) => on_unit(event.target.value as LengthUnit)}
        >
          {LENGTH_UNITS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      {measurement?.kind === "distance" && measurement.distance !== null && (
        <>
          <div className="measure-distance">
            {format_length(measurement.distance, unit)}
          </div>
          <div className="measure-row">
            <span>Start</span>
            <span>{format_coordinates(measurement.points[0], unit)}</span>
          </div>
          <div className="measure-row">
            <span>End</span>
            <span>{format_coordinates(measurement.points[1], unit)}</span>
          </div>
        </>
      )}

      {measurement?.kind === "angle" && measurement.angle !== null && (
        <>
          <div className="measure-distance">
            {measurement.angle.toFixed(1)}°
          </div>
          <div className="measure-row">
            <span>Arm 1</span>
            <span>
              {format_length(
                arm_length(measurement.points[0], measurement.points[1]),
                unit,
              )}
            </span>
          </div>
          <div className="measure-row">
            <span>Arm 2</span>
            <span>
              {format_length(
                arm_length(measurement.points[1], measurement.points[2]),
                unit,
              )}
            </span>
          </div>
          <div className="measure-row">
            <span>Corner</span>
            <span>{format_coordinates(measurement.points[1], unit)}</span>
          </div>
        </>
      )}

      <p className="measure-hint">
        {is_angle
          ? "Click three points. The middle point is the corner."
          : "Click two points on the model."}
        {measurement ? " Click again to start a new measurement." : ""}
      </p>
    </div>
  );
}

function ViewCube({
  on_direction,
}: {
  on_direction: (direction: ViewDirection) => void;
}) {
  return (
    <div className="view-cube">
      <div className="cube">
        <button
          className="face f-top"
          type="button"
          title="Top view"
          onClick={() => on_direction("top")}
        >
          T
        </button>
        <button
          className="face f-front"
          type="button"
          title="Front view"
          onClick={() => on_direction("front")}
        >
          F
        </button>
        <button
          className="face f-right"
          type="button"
          title="Right view"
          onClick={() => on_direction("right")}
        >
          R
        </button>
      </div>
    </div>
  );
}

export function Stage({
  version,
  compare,
  display_label,
  source_name,
  meta_line,
  tool,
  on_tool,
  measure_enabled,
  on_toggle_measure,
  measurement,
  on_clear_measure,
  measure_mode,
  on_measure_mode,
  length_unit,
  on_length_unit,
  selected,
  on_zoom_object,
  on_fit,
  on_view_direction,
  compare_active,
  compare_labels,
  displaying,
  on_show_version,
  on_close_compare,
  callbacks,
}: {
  version: VersionDetail | null;
  compare: VersionDetail | null;
  display_label: string | null;
  source_name: string;
  meta_line: string;
  tool: ToolName;
  on_tool: (tool: ToolName) => void;
  measure_enabled: boolean;
  on_toggle_measure: () => void;
  measurement: Measurement | null;
  on_clear_measure: () => void;
  measure_mode: MeasureMode;
  on_measure_mode: (mode: MeasureMode) => void;
  length_unit: LengthUnit;
  on_length_unit: (unit: LengthUnit) => void;
  selected: ObjectRecord | null;
  on_zoom_object: () => void;
  on_fit: () => void;
  on_view_direction: (direction: ViewDirection) => void;
  compare_active: boolean;
  compare_labels: { a: string; b: string } | null;
  displaying: "a" | "b";
  on_show_version: (label: string) => void;
  on_close_compare: () => void;
  callbacks: StageCallbacks;
}) {
  const container_ref = useRef<HTMLDivElement>(null);
  const [engine, set_engine] = useState<ViewerEngine | null>(null);
  const [progress, set_progress] = useState<{
    percent: number;
    message: string;
  } | null>(null);
  const [scene_error, set_scene_error] = useState<string | null>(null);
  const callbacks_ref = useRef(callbacks);
  callbacks_ref.current = callbacks;

  useEffect(() => {
    const container = container_ref.current;
    if (!container) {
      return;
    }
    const created = new ViewerEngine(container, {
      on_load_progress: (_key, percent, message) =>
        set_progress({ percent, message }),
      on_ready: () => set_progress(null),
      on_error: (_key, message) => {
        set_progress(null);
        callbacks_ref.current.on_error(message);
      },
      on_selection: (record) => callbacks_ref.current.on_selection(record),
      on_measure: (value) => callbacks_ref.current.on_measure(value),
      on_stats: (stats) => callbacks_ref.current.on_stats(stats),
      on_sections_changed: (sections) =>
        callbacks_ref.current.on_sections(sections),
      on_active_changed: (label) =>
        callbacks_ref.current.on_display_label(label),
    });
    set_engine(created);
    callbacks_ref.current.on_engine(created);
    (window as unknown as { __viewer?: ViewerEngine }).__viewer = created;
    return () => {
      callbacks_ref.current.on_engine(null);
      created.dispose();
      (window as unknown as { __viewer?: ViewerEngine }).__viewer = undefined;
      set_engine(null);
    };
  }, []);

  useEffect(() => {
    if (!engine || !version) {
      return;
    }
    if (
      !version.glb_url ||
      !version.scene_url ||
      !version.objects_url ||
      version.status !== "ready"
    ) {
      return;
    }
    let cancelled = false;
    if (engine.has_version(version.label)) {
      return;
    }
    set_progress({ percent: 0, message: "Reading scene.json..." });
    set_scene_error(null);

    async function load() {
      try {
        const [scene, objects] = await Promise.all([
          fetch_scene(version!.scene_url!),
          fetch_objects(version!.objects_url!),
        ]);
        if (cancelled) {
          return;
        }
        callbacks_ref.current.on_scene_loaded(version!.label, scene);
        await engine!.load_version(
          version!.label,
          version!.glb_url!,
          scene,
          objects,
          true,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        set_progress(null);
        const message =
          error instanceof Error ? error.message : "Could not load the model";
        set_scene_error(message);
        callbacks_ref.current.on_error(message);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [engine, version?.label, version?.glb_url]);

  useEffect(() => {
    if (!engine || !compare || compare.status !== "ready") {
      return;
    }
    if (!compare.glb_url || !compare.scene_url || !compare.objects_url) {
      return;
    }
    if (engine.has_version(compare.label)) {
      return;
    }
    let cancelled = false;

    async function load_compare() {
      try {
        const [scene, objects] = await Promise.all([
          fetch_scene(compare!.scene_url!),
          fetch_objects(compare!.objects_url!),
        ]);
        if (cancelled) {
          return;
        }
        callbacks_ref.current.on_scene_loaded(compare!.label, scene);
        await engine!.load_version(
          compare!.label,
          compare!.glb_url!,
          scene,
          objects,
          false,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Could not load version B";
        callbacks_ref.current.on_error(message);
      }
    }

    load_compare();
    return () => {
      cancelled = true;
    };
  }, [engine, compare?.label, compare?.glb_url]);

  return (
    <section className="stage stage-viewer">
      <div className="viewport" ref={container_ref} />

      {progress && (
        <div className="loading-overlay">
          <div className="loading-card">
            <span className="spinner" />
            <span>
              {progress.message}
              {progress.percent > 0 ? ` · ${progress.percent}%` : ""}
            </span>
          </div>
        </div>
      )}

      {!version && !progress && (
        <div className="stage-message">
          <div className="stage-message-card">
            <h2>No version yet</h2>
            <p>
              Copy a version folder into data\projects\TPRO\versions, then press
              “Load new version” to scan again.
            </p>
          </div>
        </div>
      )}

      {scene_error && (
        <div className="stage-message">
          <div className="stage-message-card">
            <h2>Could not load the model</h2>
            <p>{scene_error}</p>
          </div>
        </div>
      )}

      <div className="viewer-chip">
        <Icon name="cube" />
        <div>
          <strong>{source_name}</strong>
          <br />
          <span>{meta_line}</span>
        </div>
      </div>

      <div className="viewer-tools">
        <button
          className={`tool${tool === "select" ? " active" : ""}`}
          type="button"
          title="Select object"
          aria-label="Select object"
          onClick={() => on_tool("select")}
        >
          <Icon name="cursor" />
        </button>
        <button
          className={`tool${tool === "pan" ? " active" : ""}`}
          type="button"
          title="Pan (drag the model)"
          aria-label="Pan the model"
          onClick={() => on_tool("pan")}
        >
          <Icon name="hand" />
        </button>
        <button
          className={`tool${tool === "layers" ? " active" : ""}`}
          type="button"
          title="Layers"
          aria-label="Layers"
          onClick={() => on_tool("layers")}
        >
          <Icon name="layers" />
        </button>
        <button
          className={`tool${tool === "section" ? " active" : ""}`}
          type="button"
          title="Section"
          aria-label="Section"
          onClick={() => on_tool("section")}
        >
          <Icon name="scissors" />
        </button>
        <button
          className={`tool${measure_enabled ? " active" : ""}`}
          type="button"
          title="Measure distance"
          aria-label="Measure distance"
          onClick={on_toggle_measure}
        >
          <Icon name="ruler" />
        </button>
        <button
          className="tool"
          type="button"
          title="Fit all"
          aria-label="Fit the whole model"
          onClick={on_fit}
        >
          <Icon name="target" />
        </button>
      </div>

      <ViewCube on_direction={on_view_direction} />

      {measure_enabled && (
        <MeasurePanel
          measurement={measurement}
          mode={measure_mode}
          unit={length_unit}
          on_mode={on_measure_mode}
          on_unit={on_length_unit}
          on_clear={on_clear_measure}
        />
      )}

      {selected && !measure_enabled && (
        <ObjectCard
          record={selected}
          on_zoom={on_zoom_object}
          on_close={() => callbacks.on_selection(null)}
        />
      )}

      {compare_active && compare_labels && (
        <div className="ab-pill">
          <button
            type="button"
            className={displaying === "a" ? "active" : ""}
            title={`Show ${compare_labels.a}`}
            onClick={() => on_show_version(compare_labels.a)}
          >
            A · {compare_labels.a}
          </button>
          <span className="ab-sep">/</span>
          <button
            type="button"
            className={displaying === "b" ? "active" : ""}
            title={`Show ${compare_labels.b}`}
            onClick={() => on_show_version(compare_labels.b)}
          >
            B · {compare_labels.b}
          </button>
          <button
            className="ab-close"
            type="button"
            title="Close comparison"
            aria-label="Close comparison"
            onClick={on_close_compare}
          >
            ×
          </button>
        </div>
      )}

      {display_label && (
        <div className="viewer-scale">
          <span className="scale-line" />
          <span>{display_label}</span>
        </div>
      )}
    </section>
  );
}
