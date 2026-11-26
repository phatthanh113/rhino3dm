import { useMemo, useState } from "react";
import type {
  LayerInfo,
  SceneJson,
  SectionAxisState,
  SectionState,
} from "../../api/types";
import { Icon } from "../../components/Icon";
import { format_meters, format_number } from "./format";

export type ViewerTab = "layers" | "materials" | "section";
type ClipAxis = "x" | "y" | "z";

export type MaterialGroup = {
  colour: string;
  layers: LayerInfo[];
  triangle_count: number;
  visible: boolean;
};const AXIS_LABELS: Record<ClipAxis, string> = {
  y: "Horizontal (Y)",
  x: "Vertical X",
  z: "Vertical Z",
};

function group_materials(
  layers: LayerInfo[],
  hidden_layers: Set<string>,
): MaterialGroup[] {
  const groups = new Map<string, MaterialGroup>();
  for (const layer of layers) {
    const colour = layer.color || "#9aa6b2";
    let group = groups.get(colour);
    if (!group) {
      group = { colour, layers: [], triangle_count: 0, visible: false };
      groups.set(colour, group);
    }
    group.layers.push(layer);
    group.triangle_count += layer.triangle_count;
    if (!hidden_layers.has(layer.path)) {
      group.visible = true;
    }
  }
  return [...groups.values()].sort(
    (left, right) => right.triangle_count - left.triangle_count,
  );
}

function LayerRow({
  layer,
  hidden_layers,
  on_toggle_layer,
  on_zoom_layer,
  nested = false,
}: {
  layer: LayerInfo;
  hidden_layers: Set<string>;
  on_toggle_layer: (path: string, visible: boolean) => void;
  on_zoom_layer: (path: string) => void;
  nested?: boolean;
}) {
  return (
    <li
      className={`layer-row${nested ? " color-layer" : ""}`}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT") {
          return;
        }
        on_zoom_layer(layer.path);
      }}
    >
      <input
        type="checkbox"
        checked={!hidden_layers.has(layer.path)}
        onChange={(event) => on_toggle_layer(layer.path, event.target.checked)}
      />
      <span className="swatch" style={{ background: layer.color }} />
      <button
        className="layer-name"
        type="button"
        style={{ paddingLeft: nested ? 0 : layer.depth * 10 }}
        title={`Zoom to ${layer.path}`}
        onClick={(event) => {
          event.stopPropagation();
          on_zoom_layer(layer.path);
        }}
      >
        {layer.name}
      </button>
      <span className="count">{format_number(layer.triangle_count)}</span>
    </li>
  );
}

function SectionPanel({
  sections,
  bounds,
  on_section,
  on_reset,
}: {
  sections: SectionState;
  bounds: Record<ClipAxis, { min: number; max: number }> | null;
  on_section: (axis: ClipAxis, partial: Partial<SectionAxisState>) => void;
  on_reset: () => void;
}) {
  const [axis, set_axis] = useState<ClipAxis>("y");
  const section = sections[axis];
  const range = bounds?.[axis] ?? { min: -100, max: 100 };
  const min = Number.isFinite(range.min) ? range.min : -100;
  const max = Number.isFinite(range.max) ? range.max : 100;
  const value = Math.min(Math.max(section.value, min), max);

  return (
    <div className="section-block">
      <label className="section-switch">
        <input
          type="checkbox"
          checked={section.enabled}
          onChange={(event) =>
            on_section(axis, { enabled: event.target.checked })
          }
        />
        Enable section
      </label>

      <div className="axis-pick">
        {(Object.keys(AXIS_LABELS) as ClipAxis[]).map((item) => (
          <button
            key={item}
            className={item === axis ? "active" : ""}
            type="button"
            onClick={() => set_axis(item)}
          >
            {AXIS_LABELS[item]}
          </button>
        ))}
      </div>

      <div className="slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={0.1}
          value={value}
          onChange={(event) =>
            on_section(axis, { value: Number(event.target.value) })
          }
        />
        <span className="slider-value">{format_meters(value)}</span>
      </div>

      <div className="section-actions">
        <button
          type="button"
          onClick={() => on_section(axis, { flipped: !section.flipped })}
        >
          <Icon name="flip" />
          Flip
        </button>
        <button type="button" onClick={on_reset}>
          Reset
        </button>
      </div>

      <p className="hint">
        <Icon name="info" />
        <span>
          Drag the outline on the model to move the cut, or use the slider.
        </span>
      </p>
    </div>
  );
}

export function Inspector({
  active_tab,
  on_tab,
  scene,
  layers,
  hidden_layers,
  on_toggle_layer,
  on_zoom_layer,
  on_all_layers,
  on_save_view,
  sections,
  section_bounds,
  on_section,
  on_reset_sections,
}: {
  active_tab: ViewerTab;
  on_tab: (tab: ViewerTab) => void;
  scene: SceneJson | null;
  layers: LayerInfo[];
  hidden_layers: Set<string>;
  on_toggle_layer: (path: string, visible: boolean) => void;
  on_zoom_layer: (path: string) => void;
  on_all_layers: (visible: boolean) => void;
  on_save_view: () => void;
  sections: SectionState;
  section_bounds: Record<ClipAxis, { min: number; max: number }> | null;
  on_section: (axis: ClipAxis, partial: Partial<SectionAxisState>) => void;
  on_reset_sections: () => void;
}) {
  const [search, set_search] = useState("");
  const [group_by_color, set_group_by_color] = useState(true);
  const material_groups = useMemo(
    () => group_materials(layers, hidden_layers),
    [layers, hidden_layers],
  );

  const needle = search.trim().toLowerCase();
  const filtered_layers = needle
    ? layers.filter(
        (layer) =>
          layer.path.toLowerCase().includes(needle) ||
          layer.name.toLowerCase().includes(needle),
      )
    : layers;
  const filtered_groups = material_groups
    .map((group) => ({
      group,
      layers:
        needle && !group.colour.toLowerCase().includes(needle)
          ? group.layers.filter(
              (layer) =>
                layer.path.toLowerCase().includes(needle) ||
                layer.name.toLowerCase().includes(needle),
            )
          : group.layers,
    }))
    .filter((entry) => entry.layers.length > 0);
  const filtered_materials = needle
    ? material_groups.filter((group) =>
        group.colour.toLowerCase().includes(needle),
      )
    : material_groups;

  const visible_count = layers.filter(
    (layer) => !hidden_layers.has(layer.path),
  ).length;
  const all_visible = visible_count === layers.length && layers.length > 0;

  function toggle_material(group: MaterialGroup) {
    for (const layer of group.layers) {
      on_toggle_layer(layer.path, !group.visible);
    }
  }

  return (
    <aside className="inspector inspector-viewer">
      <div className="tabs" role="tablist" aria-label="Model information">
        <button
          className={`tab${active_tab === "layers" ? " active" : ""}`}
          type="button"
          role="tab"
          aria-selected={active_tab === "layers"}
          onClick={() => on_tab("layers")}
        >
          Layers <span className="n">{layers.length}</span>
        </button>
        <button
          className={`tab${active_tab === "materials" ? " active" : ""}`}
          type="button"
          role="tab"
          aria-selected={active_tab === "materials"}
          onClick={() => on_tab("materials")}
        >
          Materials <span className="n">{material_groups.length}</span>
        </button>
        <button
          className={`tab${active_tab === "section" ? " active" : ""}`}
          type="button"
          role="tab"
          aria-selected={active_tab === "section"}
          onClick={() => on_tab("section")}
        >
          Section
        </button>
      </div>

      {active_tab !== "section" && (
        <input
          className="panel-search"
          type="search"
          placeholder="Search layers / materials…"
          aria-label="Search layers or materials"
          value={search}
          onChange={(event) => set_search(event.target.value)}
        />
      )}

      {active_tab === "layers" && (
        <div className="panel active">
          <div className="layers-head">
            <span className="layers-count">
              {visible_count} / {layers.length} layers on
            </span>
            <div className="layers-head-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => on_all_layers(!all_visible)}
              >
                {all_visible ? "Hide all" : "Show all"}
              </button>
              <button
                className="save-layer"
                type="button"
                title="Save the current view as a new layer set"
                onClick={on_save_view}
              >
                <Icon name="plus" />
                Save layers
              </button>
            </div>
          </div>

          <div className="layer-view-toggle" role="group" aria-label="Group layers">
            <button
              className={group_by_color ? "" : "active"}
              type="button"
              onClick={() => set_group_by_color(false)}
            >
              By layer
            </button>
            <button
              className={group_by_color ? "active" : ""}
              type="button"
              onClick={() => set_group_by_color(true)}
            >
              By color
            </button>
          </div>

          <ul className="layer-list">
            {group_by_color &&
              filtered_groups.map((entry) => (
                <li className="color-group" key={entry.group.colour}>
                  <label className="color-group-head">
                    <input
                      type="checkbox"
                      checked={entry.group.visible}
                      onChange={() => toggle_material(entry.group)}
                    />
                    <span
                      className="swatch"
                      style={{ background: entry.group.colour }}
                    />
                    <span className="color-group-name">
                      {entry.group.colour.toUpperCase()}
                    </span>
                    <span className="count">{entry.layers.length}</span>
                  </label>
                  <ul className="color-group-layers">
                    {entry.layers.map((layer) => (
                      <LayerRow
                        key={layer.path}
                        layer={layer}
                        hidden_layers={hidden_layers}
                        on_toggle_layer={on_toggle_layer}
                        on_zoom_layer={on_zoom_layer}
                        nested
                      />
                    ))}
                  </ul>
                </li>
              ))}

            {!group_by_color &&
              filtered_layers.map((layer) => (
                <LayerRow
                  key={layer.path}
                  layer={layer}
                  hidden_layers={hidden_layers}
                  on_toggle_layer={on_toggle_layer}
                  on_zoom_layer={on_zoom_layer}
                />
              ))}

            {((group_by_color && filtered_groups.length === 0) ||
              (!group_by_color && filtered_layers.length === 0)) && (
              <li className="list-empty">
                {layers.length === 0
                  ? "No layers loaded yet."
                  : "No matching layers."}
              </li>
            )}
          </ul>
        </div>
      )}

      {active_tab === "materials" && (
        <div className="panel active">
          <p className="panel-note">
            Each colour is one material in the GLB. Turning a material off hides
            the layers that use it.
          </p>
          <ul className="layer-list">
            {filtered_materials.map((group) => (
              <li className="layer-row" key={group.colour}>
                <input
                  type="checkbox"
                  checked={group.visible}
                  onChange={() => toggle_material(group)}
                />
                <span
                  className="swatch"
                  style={{ background: group.colour }}
                />
                <span className="name" title={group.colour}>
                  Material {group.colour}
                </span>
                <span className="count">{group.layers.length}</span>
              </li>
            ))}
            {filtered_materials.length === 0 && (
              <li className="list-empty">No matching materials.</li>
            )}
          </ul>
        </div>
      )}

      {active_tab === "section" && (
        <div className="panel active">
          <SectionPanel
            sections={sections}
            bounds={section_bounds}
            on_section={on_section}
            on_reset={on_reset_sections}
          />
        </div>
      )}

      {scene && active_tab !== "section" && (
        <p className="inspector-foot">
          {format_number(scene.totals.objects)} objects ·{" "}
          {format_number(scene.totals.triangles)} triangles
        </p>
      )}
    </aside>
  );
}
