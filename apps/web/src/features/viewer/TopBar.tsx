import { useEffect, useRef, useState } from "react";
import type { Project, Version } from "../../api/types";
import { Icon } from "../../components/Icon";
import { format_bytes, format_date, format_number } from "./format";

function version_chip(version: Version, is_active: boolean) {
  if (version.status === "ready") {
    return (
      <span className={is_active ? "chip chip-ok" : "chip"}>
        {is_active ? "Viewing" : "Ready"}
      </span>
    );
  }
  if (version.status === "converting") {
    return (
      <span className="chip chip-busy">
        Converting {Math.round(version.progress * 100)}%
      </span>
    );
  }
  if (version.status === "pending") {
    return <span className="chip chip-warn">Queued</span>;
  }
  return <span className="chip chip-err">Error</span>;
}

export function TopBar({
  project,
  versions,
  active_label,
  compare_label,
  source_name,
  scanning,
  on_select,
  on_compare,
  on_open_scan,
}: {
  project: Project;
  versions: Version[];
  active_label: string | null;
  compare_label: string | null;
  source_name: string;
  scanning: boolean;
  on_select: (label: string) => void;
  on_compare: (label: string) => void;
  on_open_scan: () => void;
}) {
  const [is_open, set_open] = useState(false);
  const wrap_ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!is_open) {
      return;
    }
    const on_pointer_down = (event: PointerEvent) => {
      if (!wrap_ref.current?.contains(event.target as Node)) {
        set_open(false);
      }
    };
    window.addEventListener("pointerdown", on_pointer_down);
    return () => window.removeEventListener("pointerdown", on_pointer_down);
  }, [is_open]);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="cube" className="icon icon-lg" />
        </span>
        <span className="brand-name">RhinoView</span>
      </div>

      <nav className="crumbs">
        <span className="file-name" title={source_name}>
          {source_name || project.name}
        </span>
        <div className="version-wrap" ref={wrap_ref}>
          <button
            className="version-button"
            type="button"
            title="Switch version"
            aria-haspopup="true"
            aria-expanded={is_open}
            onClick={() => set_open((value) => !value)}
          >
            <span>{active_label ?? "none"}</span>
            <Icon name="chevron" />
          </button>

          {is_open && (
            <div className="version-menu" aria-label="Choose a version">
              {versions.length === 0 && (
                <p className="list-empty">No versions yet.</p>
              )}
              {versions.map((version) => {
                const is_active = version.label === active_label;
                const can_open = version.status === "ready";
                return (
                  <div className="version-option-row" key={version.label}>
                    <button
                      className={`version-option${is_active ? " selected" : ""}`}
                      type="button"
                      disabled={!can_open}
                      onClick={() => {
                        on_select(version.label);
                        set_open(false);
                      }}
                    >
                      <span className="version-option-line">
                        <strong>{version.label}</strong>
                        {version_chip(version, is_active)}
                      </span>
                      <span className="version-option-meta">
                        {version.status === "error" && version.message
                          ? version.message
                          : `${format_date(version.created_at)}${
                              version.has_source && version.source_size
                                ? ` · ${format_bytes(version.source_size)}`
                                : ""
                            }${
                              version.triangle_count
                                ? ` · ${format_number(version.triangle_count)} triangle`
                                : ""
                            }`}
                      </span>
                    </button>
                    <button
                      className="version-compare"
                      type="button"
                      disabled={!can_open || is_active}
                      title={`Compare A/B with ${version.label}`}
                      onClick={() => {
                        on_compare(version.label);
                        set_open(false);
                      }}
                    >
                      {compare_label === version.label ? "B" : "A/B"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      <div className="topbar-spacer" />

      <div className="topbar-actions">
        <button
          className="button button-primary"
          type="button"
          onClick={on_open_scan}
          disabled={scanning}
        >
          <Icon name="upload" />
          {scanning ? "Scanning..." : "Load new version"}
        </button>
      </div>
    </header>
  );
}
