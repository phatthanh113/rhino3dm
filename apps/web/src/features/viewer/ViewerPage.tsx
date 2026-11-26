import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LayerInfo,
  Measurement,
  ObjectRecord,
  SavedView,
  SceneJson,
  SectionAxisState,
  SectionState,
  ViewDirection,
} from "../../api/types";
import { api } from "../../api/client";
import { Modal } from "../../components/Modal";
import type { ViewerEngine, ViewerStats } from "../../three/ViewerEngine";
import type { MeasureMode } from "../../three/MeasureManager";
import { TopBar } from "./TopBar";
import { SavedRail } from "./SavedRail";
import { Stage, type ToolName } from "./Stage";
import { Inspector, type ViewerTab } from "./Inspector";
import { format_bytes, format_number, type LengthUnit } from "./format";

type Toast = { text: string; kind: "info" | "error" };

const EMPTY_SECTIONS: SectionState = {
  x: { enabled: false, value: 0, flipped: false },
  y: { enabled: false, value: 0, flipped: false },
  z: { enabled: false, value: 0, flipped: false },
};

function hidden_material_keys(
  layers: LayerInfo[],
  hidden_layers: Set<string>,
): string[] {
  const visible_by_colour = new Map<string, boolean>();
  for (const layer of layers) {
    const colour = layer.color || "#9aa6b2";
    const visible = !hidden_layers.has(layer.path);
    visible_by_colour.set(
      colour,
      (visible_by_colour.get(colour) ?? false) || visible,
    );
  }
  return [...visible_by_colour.entries()]
    .filter(([, visible]) => !visible)
    .map(([colour]) => colour);
}

export function ViewerPage() {
  const query_client = useQueryClient();

  const projects_query = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects,
    staleTime: 60_000,
  });
  const project = projects_query.data?.[0] ?? null;
  const slug = project?.slug ?? "";

  const health_query = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    staleTime: Infinity,
  });

  const versions_query = useQuery({
    queryKey: ["versions", slug],
    queryFn: () => api.versions(slug),
    enabled: Boolean(slug),
    refetchInterval: (query) => {
      const data = query.state.data;
      const busy = data?.some(
        (version) =>
          version.status === "pending" || version.status === "converting",
      );
      return busy ? 4000 : false;
    },
  });
  const versions = versions_query.data ?? [];

  const views_query = useQuery({
    queryKey: ["views", slug],
    queryFn: () => api.views(slug),
    enabled: Boolean(slug),
  });
  const views = views_query.data ?? [];

  const [active_label, set_active_label] = useState<string | null>(null);
  const [compare_label, set_compare_label] = useState<string | null>(null);
  const [displaying, set_displaying] = useState<"a" | "b">("a");
  const [scenes, set_scenes] = useState<Record<string, SceneJson>>({});
  const [engine, set_engine] = useState<ViewerEngine | null>(null);
  const [hidden_layers, set_hidden_layers] = useState<Set<string>>(new Set());
  const [sections, set_sections] = useState<SectionState>(EMPTY_SECTIONS);
  const [section_bounds, set_section_bounds] = useState<Record<
    "x" | "y" | "z",
    { min: number; max: number }
  > | null>(null);
  const [stats, set_stats] = useState<ViewerStats | null>(null);
  const [selected, set_selected] = useState<ObjectRecord | null>(null);
  const [measurement, set_measurement] = useState<Measurement | null>(null);
  const [measure_enabled, set_measure_enabled] = useState(false);
  const [measure_mode, set_measure_mode] = useState<MeasureMode>("distance");
  const [length_unit, set_length_unit] = useState<LengthUnit>(() => {
    const stored = window.localStorage.getItem("rhinoview_length_unit");
    if (
      stored === "m" ||
      stored === "cm" ||
      stored === "mm" ||
      stored === "ft" ||
      stored === "in"
    ) {
      return stored;
    }
    return "m";
  });
  const [active_tab, set_active_tab] = useState<ViewerTab>("layers");
  const [tool, set_tool] = useState<ToolName>("select");
  const [active_view_id, set_active_view_id] = useState<number | null>(null);
  const [toast, set_toast] = useState<Toast | null>(null);
  const [scan_open, set_scan_open] = useState(false);
  const [delete_source_on_scan, set_delete_source_on_scan] = useState(true);
  const [cleanup_sources, set_cleanup_sources] = useState<
    { label: string; bytes: number }[] | null
  >(null);
  const [save_open, set_save_open] = useState(false);
  const [view_name, set_view_name] = useState("");
  const [delete_target, set_delete_target] = useState<SavedView | null>(null);

  useEffect(() => {
    if (active_label || versions.length === 0) {
      return;
    }
    const ready = versions.filter((version) => version.status === "ready");
    const pick = ready.length ? ready[ready.length - 1] : versions[versions.length - 1];
    set_active_label(pick.label);
  }, [versions, active_label]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => set_toast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    engine?.set_navigation_mode(tool === "pan" ? "pan" : "orbit");
  }, [engine, tool]);

  const version_query = useQuery({
    queryKey: ["version", slug, active_label],
    queryFn: () => api.version(slug, active_label as string),
    enabled: Boolean(slug && active_label),
    staleTime: Infinity,
  });
  const compare_query = useQuery({
    queryKey: ["version", slug, compare_label],
    queryFn: () => api.version(slug, compare_label as string),
    enabled: Boolean(slug && compare_label),
    staleTime: Infinity,
  });

  const active_version = version_query.data ?? null;
  const compare_version = compare_query.data ?? null;
  const display_label =
    displaying === "b" && compare_label ? compare_label : active_label;
  const display_version =
    displaying === "b" && compare_version ? compare_version : active_version;
  const active_scene = display_label ? scenes[display_label] ?? null : null;
  const layers = useMemo(() => active_scene?.layers ?? [], [active_scene]);

  const source_name =
    display_version?.source_name ?? active_version?.source_name ?? "";
  const meta_line = [
    display_label ?? "",
    `${layers.length} layers`,
    `${format_number(active_scene?.totals.triangles ?? 0)} triangles`,
    format_bytes(display_version?.glb_bytes ?? 0),
  ]
    .filter(Boolean)
    .join(" · ");

  const scan_mutation = useMutation({
    mutationFn: () => api.scan(slug, delete_source_on_scan),
    onSuccess: (result) => {
      set_scan_open(false);
      set_toast({ text: result.message, kind: "info" });
      query_client.invalidateQueries({ queryKey: ["versions", slug] });
      if (result.deletable_sources.length > 0) {
        set_cleanup_sources(result.deletable_sources);
      }
    },
    onError: (error) => {
      set_toast({
        text: error instanceof Error ? error.message : "Scan failed",
        kind: "error",
      });
    },
  });

  const delete_source_mutation = useMutation({
    mutationFn: async (labels: string[]) => {
      let freed = 0;
      for (const label of labels) {
        const result = await api.delete_source(slug, label);
        freed += result.freed_bytes;
      }
      return freed;
    },
    onSuccess: (freed) => {
      set_cleanup_sources(null);
      query_client.invalidateQueries({ queryKey: ["versions", slug] });
      query_client.invalidateQueries({ queryKey: ["version", slug] });
      set_toast({
        text: `Deleted the source .3dm files · ${format_bytes(freed)} freed`,
        kind: "info",
      });
    },
    onError: (error) => {
      set_toast({
        text:
          error instanceof Error
            ? error.message
            : "Could not delete the .3dm file",
        kind: "error",
      });
    },
  });

  const save_mutation = useMutation({
    mutationFn: (name: string) =>
      api.create_view(slug, {
        name,
        hidden_layers: [...hidden_layers],
        hidden_materials: hidden_material_keys(layers, hidden_layers),
        sections,
        camera: engine?.get_camera() ?? {
          position: [0, 0, 0],
          target: [0, 0, 0],
          up: [0, 1, 0],
        },
        created_on_version: display_label,
      }),
    onSuccess: (created) => {
      set_save_open(false);
      set_active_view_id(created.id);
      set_toast({ text: `Saved layer set “${created.name}”`, kind: "info" });
      query_client.invalidateQueries({ queryKey: ["views", slug] });
    },
    onError: (error) => {
      set_toast({
        text: error instanceof Error ? error.message : "Could not save",
        kind: "error",
      });
    },
  });

  const delete_mutation = useMutation({
    mutationFn: (view_id: number) => api.delete_view(slug, view_id),
    onSuccess: (_result, view_id) => {
      set_delete_target(null);
      if (active_view_id === view_id) {
        set_active_view_id(null);
      }
      query_client.invalidateQueries({ queryKey: ["views", slug] });
      set_toast({ text: "Layer set deleted", kind: "info" });
    },
    onError: (error) => {
      set_toast({
        text: error instanceof Error ? error.message : "Could not delete",
        kind: "error",
      });
    },
  });

  function sync_hidden() {
    if (!engine) {
      return;
    }
    set_hidden_layers(new Set(engine.get_hidden_layers()));
  }

  function handle_scene_loaded(label: string, scene: SceneJson) {
    set_scenes((current) => ({ ...current, [label]: scene }));
  }

  function handle_stats(next: ViewerStats) {
    set_stats(next);
    if (engine) {
      set_section_bounds(engine.get_section_bounds());
    }
  }

  function handle_display_label(label: string) {
    if (label === compare_label) {
      set_displaying("b");
    } else if (label === active_label) {
      set_displaying("a");
    }
  }

  function handle_select_version(label: string) {
    if (label === active_label) {
      return;
    }
    if (engine) {
      if (compare_label) {
        engine.unload_version(compare_label);
      }
      if (engine.has_version(label)) {
        engine.show_version(label);
      } else if (active_label) {
        engine.show_version(active_label);
      }
    }
    set_active_label(label);
    set_compare_label(null);
    set_displaying("a");
    set_active_view_id(null);
    set_selected(null);
    set_measurement(null);
  }

  function handle_compare(label: string) {
    if (!active_label || label === active_label) {
      return;
    }
    set_compare_label(label);
    set_displaying("a");
    engine?.show_version(active_label);
  }

  function handle_show_version(label: string) {
    if (!engine || !engine.has_version(label)) {
      set_toast({ text: "This version is still loading", kind: "info" });
      return;
    }
    engine.show_version(label);
    set_displaying(label === active_label ? "a" : "b");
    set_sections(engine.get_sections());
    set_section_bounds(engine.get_section_bounds());
  }

  function handle_close_compare() {
    if (!engine) {
      set_compare_label(null);
      return;
    }
    if (active_label) {
      engine.show_version(active_label);
      set_sections(engine.get_sections());
      set_section_bounds(engine.get_section_bounds());
    }
    if (compare_label) {
      engine.unload_version(compare_label);
    }
    set_compare_label(null);
    set_displaying("a");
  }

  function handle_toggle_layer(path: string, is_visible: boolean) {
    engine?.set_layer_visible(path, is_visible);
    sync_hidden();
    set_active_view_id(null);
  }

  function handle_all_layers(is_visible: boolean) {
    engine?.set_layers_visible(
      layers.map((layer) => layer.path),
      is_visible,
    );
    sync_hidden();
    set_active_view_id(null);
  }

  function handle_section(
    axis: "x" | "y" | "z",
    partial: Partial<SectionAxisState>,
  ) {
    engine?.set_section(axis, partial);
    set_active_view_id(null);
  }

  function handle_reset_sections() {
    engine?.reset_sections();
    set_active_view_id(null);
  }

  function handle_toggle_measure() {
    const next = !measure_enabled;
    engine?.set_measure_enabled(next);
    if (next) {
      engine?.set_measure_mode(measure_mode);
    }
    set_measure_enabled(next);
    set_measurement(null);
    set_selected(null);
    if (next) {
      set_tool("select");
    }
  }

  function handle_measure_mode(mode: MeasureMode) {
    set_measure_mode(mode);
    engine?.set_measure_mode(mode);
    set_measurement(null);
  }

  function handle_length_unit(unit: LengthUnit) {
    set_length_unit(unit);
    window.localStorage.setItem("rhinoview_length_unit", unit);
  }

  function handle_tool(next: ToolName) {
    if (measure_enabled) {
      engine?.set_measure_enabled(false);
      set_measure_enabled(false);
      set_measurement(null);
    }
    set_tool(next);
    if (next === "layers") {
      set_active_tab("layers");
    } else if (next === "section") {
      set_active_tab("section");
    }
  }

  function handle_apply_view(view: SavedView) {
    if (!engine) {
      return;
    }
    engine.set_all_layers_visible(true);
    engine.set_layers_visible(view.hidden_layers, false);
    engine.set_sections(view.sections);
    if (view.camera) {
      engine.set_camera(view.camera, true);
    }
    sync_hidden();
    set_sections(engine.get_sections());
    set_section_bounds(engine.get_section_bounds());
    set_active_view_id(view.id);
    set_selected(null);
    set_measurement(null);

    const known = new Set(layers.map((layer) => layer.path));
    const missing = view.hidden_layers.filter((path) => !known.has(path));
    if (missing.length) {
      set_toast({
        text: `${missing.length} layers in this set are not in ${display_label}`,
        kind: "error",
      });
    } else {
      set_toast({ text: `Opened “${view.name}”`, kind: "info" });
    }
  }

  function handle_zoom_layer(path: string) {
    if (!engine) {
      return;
    }
    if (new Set(engine.get_hidden_layers()).has(path)) {
      engine.set_layer_visible(path, true);
      sync_hidden();
    }
    engine.zoom_to_layer(path);
  }

  function handle_save_view() {
    set_view_name(`Layer set ${views.length + 1}`);
    set_save_open(true);
  }

  if (!project) {
    return (
      <div className="app-loading">
        <span className="spinner" />
        <span>Connecting to API...</span>
      </div>
    );
  }

  return (
    <>
      <TopBar
        project={project}
        versions={versions}
        active_label={active_label}
        compare_label={compare_label}
        source_name={source_name}
        scanning={scan_mutation.isPending}
        on_select={handle_select_version}
        on_compare={handle_compare}
        on_open_scan={() => set_scan_open(true)}
      />

      <main className="shell">
        <SavedRail
          views={views}
          versions={versions}
          active_view_id={active_view_id}
          total_layers={layers.length}
          on_apply={handle_apply_view}
          on_delete={set_delete_target}
        />

        <Stage
          version={active_version}
          compare={compare_version}
          display_label={display_label}
          source_name={source_name}
          meta_line={meta_line}
          tool={tool}
          on_tool={handle_tool}
          measure_enabled={measure_enabled}
          on_toggle_measure={handle_toggle_measure}
          measurement={measurement}
          on_clear_measure={() => {
            engine?.clear_measure();
            set_measurement(null);
          }}
          measure_mode={measure_mode}
          on_measure_mode={handle_measure_mode}
          length_unit={length_unit}
          on_length_unit={handle_length_unit}
          selected={selected}
          on_zoom_object={() => {
            if (engine && selected) {
              engine.zoom_to_record(selected);
            }
          }}
          on_fit={() => engine?.fit(false)}
          on_view_direction={(direction: ViewDirection) =>
            engine?.set_view_direction(direction)
          }
          compare_active={Boolean(compare_label)}
          compare_labels={
            active_label && compare_label
              ? { a: active_label, b: compare_label }
              : null
          }
          displaying={displaying}
          on_show_version={handle_show_version}
          on_close_compare={handle_close_compare}
          callbacks={{
            on_engine: set_engine,
            on_scene_loaded: handle_scene_loaded,
            on_stats: handle_stats,
            on_selection: set_selected,
            on_measure: set_measurement,
            on_sections: set_sections,
            on_display_label: handle_display_label,
            on_error: (message) => set_toast({ text: message, kind: "error" }),
          }}
        />

        <Inspector
          active_tab={active_tab}
          on_tab={(tab) => {
            set_active_tab(tab);
            if (tab === "section") {
              set_tool("section");
            }
          }}
          scene={active_scene}
          layers={layers}
          hidden_layers={hidden_layers}
          on_toggle_layer={handle_toggle_layer}
          on_zoom_layer={handle_zoom_layer}
          on_all_layers={handle_all_layers}
          on_save_view={handle_save_view}
          sections={sections}
          section_bounds={section_bounds}
          on_section={handle_section}
          on_reset_sections={handle_reset_sections}
        />
      </main>

      <footer className="statusbar">
        <span className="status-live">
          <span className="dot ok" />
          Connected · {project.name}
        </span>
        <span className="grow" />
        <span>
          <span className="status-strong">
            {format_number(stats?.visible_triangles ?? 0)}
          </span>{" "}
          / {format_number(stats?.total_triangles ?? 0)} triangle ·{" "}
          {stats?.visible_layers ?? 0} / {stats?.total_layers ?? 0} layer
        </span>
        <span className="grow" />
        <span>WebGL 2</span>
      </footer>

      {scan_open && (
        <Modal
          title="Load new version"
          on_close={() => set_scan_open(false)}
          actions={
            <>
              <button
                className="button"
                type="button"
                onClick={() => set_scan_open(false)}
              >
                Close
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={scan_mutation.isPending}
                onClick={() => scan_mutation.mutate()}
              >
                {scan_mutation.isPending ? "Scanning..." : "Scan again"}
              </button>
            </>
          }
        >
          <p>
            Copy a version folder into the data folder on the server. Each
            version is one folder with a <strong>source.3dm</strong> file:
          </p>
          <code>
            {health_query.data?.data_dir ?? "D:\\rhino\\data"}
            \projects\{project.slug}\versions\v5\source.3dm
          </code>
          <p>
            Press <strong>Scan again</strong>. The new version is converted to
            GLB in the background; when it is done, choose it next to the file
            name.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={delete_source_on_scan}
              onChange={(event) =>
                set_delete_source_on_scan(event.target.checked)
              }
            />
            <span>
              Delete the source <strong>.3dm</strong> after conversion to save
              disk space
            </span>
          </label>
          <p className="modal-note">
            The file is kept if a conversion fails. The version stays viewable
            from the generated GLB.
          </p>
        </Modal>
      )}

      {cleanup_sources && (
        <Modal
          title="Delete the source .3dm files?"
          on_close={() => set_cleanup_sources(null)}
          actions={
            <>
              <button
                className="button"
                type="button"
                onClick={() => set_cleanup_sources(null)}
              >
                Keep files
              </button>
              <button
                className="button button-danger"
                type="button"
                disabled={delete_source_mutation.isPending}
                onClick={() =>
                  delete_source_mutation.mutate(
                    cleanup_sources.map((source) => source.label),
                  )
                }
              >
                {delete_source_mutation.isPending
                  ? "Deleting..."
                  : "Delete .3dm files"}
              </button>
            </>
          }
        >
          <p>
            These versions are converted, so the viewer no longer needs the
            original Rhino file:
          </p>
          <ul className="cleanup-list">
            {cleanup_sources.map((source) => (
              <li key={source.label}>
                <strong>{source.label}</strong>
                <span>{format_bytes(source.bytes)}</span>
              </li>
            ))}
          </ul>
          <p>
            Deleting frees{" "}
            <strong>
              {format_bytes(
                cleanup_sources.reduce(
                  (total, source) => total + source.bytes,
                  0,
                ),
              )}
            </strong>
            . Layers, sections, saved sets and the GLB are not affected.
          </p>
        </Modal>
      )}

      {save_open && (
        <Modal
          title="Save layer set"
          on_close={() => set_save_open(false)}
          actions={
            <>
              <button
                className="button"
                type="button"
                onClick={() => set_save_open(false)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={!view_name.trim() || save_mutation.isPending}
                onClick={() => save_mutation.mutate(view_name.trim())}
              >
                {save_mutation.isPending ? "Saving..." : "Save"}
              </button>
            </>
          }
        >
          <p>
            Save the current layer visibility, hidden materials, section cuts
            and camera as one set that can be reused on any version.
          </p>
          <div className="field">
            <label htmlFor="view-name">Layer set name</label>
            <input
              id="view-name"
              value={view_name}
              autoFocus
              onChange={(event) => set_view_name(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && view_name.trim()) {
                  save_mutation.mutate(view_name.trim());
                }
              }}
            />
          </div>
        </Modal>
      )}

      {delete_target && (
        <Modal
          title="Delete layer set"
          on_close={() => set_delete_target(null)}
          actions={
            <>
              <button
                className="button"
                type="button"
                onClick={() => set_delete_target(null)}
              >
                Cancel
              </button>
              <button
                className="button button-danger"
                type="button"
                disabled={delete_mutation.isPending}
                onClick={() => delete_mutation.mutate(delete_target.id)}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            Delete the layer set <strong>{delete_target.name}</strong>? Layers
            and models are not affected.
          </p>
        </Modal>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </>
  );
}
