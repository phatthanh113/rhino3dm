import type {
  DeleteSourceResult,
  ObjectsJson,
  Project,
  SavedView,
  SavedViewInput,
  ScanResult,
  SceneJson,
  Version,
  VersionDetail,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      // keep the status text
    }
    throw new Error(detail);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () =>
    request<{ status: string; data_dir: string; default_project: string }>(
      "/api/health",
    ),
  projects: () => request<Project[]>("/api/projects"),
  scan: (slug: string, delete_source = false) =>
    request<ScanResult>(`/api/projects/${encodeURIComponent(slug)}/scan`, {
      method: "POST",
      body: JSON.stringify({ delete_source }),
    }),
  delete_source: (slug: string, label: string) =>
    request<DeleteSourceResult>(
      `/api/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(label)}/delete-source`,
      { method: "POST" },
    ),
  versions: (slug: string) =>
    request<Version[]>(`/api/projects/${encodeURIComponent(slug)}/versions`),
  version: (slug: string, label: string) =>
    request<VersionDetail>(
      `/api/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(label)}`,
    ),
  views: (slug: string) =>
    request<SavedView[]>(`/api/projects/${encodeURIComponent(slug)}/views`),
  create_view: (slug: string, payload: SavedViewInput) =>
    request<SavedView>(`/api/projects/${encodeURIComponent(slug)}/views`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update_view: (slug: string, view_id: number, payload: SavedViewInput) =>
    request<SavedView>(
      `/api/projects/${encodeURIComponent(slug)}/views/${view_id}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    ),
  delete_view: (slug: string, view_id: number) =>
    request<void>(
      `/api/projects/${encodeURIComponent(slug)}/views/${view_id}`,
      { method: "DELETE" },
    ),
};

export async function fetch_json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function fetch_scene(url: string) {
  return fetch_json<SceneJson>(url);
}

export function fetch_objects(url: string) {
  return fetch_json<ObjectsJson>(url);
}
