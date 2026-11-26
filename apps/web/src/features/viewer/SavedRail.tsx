import type { SavedView, SectionState, Version } from "../../api/types";
import { Icon } from "../../components/Icon";
import { format_bytes, format_meters } from "./format";

function view_meta(view: SavedView, total_layers: number): string {
  const parts: string[] = [];
  const visible = Math.max(total_layers - view.hidden_layers.length, 0);
  parts.push(`${visible}/${total_layers} layers`);
  const active_axes = (Object.keys(view.sections) as Array<keyof SectionState>)
    .filter((axis) => view.sections?.[axis]?.enabled)
    .map((axis) => {
      const section = view.sections[axis];
      const letter = axis.toUpperCase();
      return `cut ${letter} ${format_meters(section.value)}`;
    });
  if (active_axes.length) {
    parts.push(active_axes.join(", "));
  }
  return parts.join(" · ");
}

function view_has_section(view: SavedView): boolean {
  return (Object.keys(view.sections ?? {}) as Array<keyof SectionState>).some(
    (axis) => view.sections?.[axis]?.enabled,
  );
}

export function SavedRail({
  views,
  versions,
  active_view_id,
  total_layers,
  on_apply,
  on_delete,
}: {
  views: SavedView[];
  versions: Version[];
  active_view_id: number | null;
  total_layers: number;
  on_apply: (view: SavedView) => void;
  on_delete: (view: SavedView) => void;
}) {
  const storage_bytes = versions.reduce(
    (total, version) => total + (version.glb_bytes ?? 0),
    0,
  );
  const storage_percent = Math.min((storage_bytes / 10 / 1024 ** 3) * 100, 100);

  return (
    <aside className="rail">
      <div className="rail-scroll">
        <div className="rail-section-head">
          <span className="rail-title">Saved layer sets</span>
          <span className="count-badge">{views.length}</span>
        </div>

        <ul className="preset-list">
          {views.length === 0 && (
            <li className="list-empty">No saved layer sets yet.</li>
          )}
          {views.map((view) => {
            const is_active = view.id === active_view_id;
            return (
              <li
                className={`preset-item${is_active ? " active" : ""}`}
                key={view.id}
                role="button"
                tabIndex={0}
                aria-pressed={is_active}
                onClick={() => on_apply(view)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    on_apply(view);
                  }
                }}
              >
                <span className="preset-icon">
                  <Icon name={view_has_section(view) ? "scissors" : "layers"} />
                </span>
                <span className="preset-body">
                  <span className="preset-name">{view.name}</span>
                  <span className="preset-meta">
                    {view_meta(view, total_layers)}
                  </span>
                </span>
                <span className="preset-actions">
                  <button
                    type="button"
                    title="Delete layer set"
                    aria-label={`Delete ${view.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      on_delete(view);
                    }}
                  >
                    <Icon name="x" />
                  </button>
                </span>
                <span className="preset-state">Viewing</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rail-foot">
        <div className="storage-row">
          <span>GLB storage</span>
          <span>{format_bytes(storage_bytes)}</span>
        </div>
        <div className="meter">
          <span style={{ width: `${storage_percent}%` }} />
        </div>
      </div>
    </aside>
  );
}
