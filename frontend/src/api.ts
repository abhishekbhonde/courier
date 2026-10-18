import type {
  Collection,
  CollectionTree,
  Environment,
  ExecResult,
  Folder,
  HistoryEntry,
  RequestSpec,
  SavedRequest,
  Settings,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Cannot reach the Courier server. Is it running?", 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(text || res.statusText, res.status);
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error ?? res.statusText;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

const get = <T>(p: string) => request<T>("GET", p);
const post = <T>(p: string, b: unknown) => request<T>("POST", p, b);
const put = <T>(p: string, b: unknown) => request<T>("PUT", p, b);
const del = (p: string) => request<void>("DELETE", p);

export type NewRequest = Omit<SavedRequest, "id" | "sort" | "createdAt" | "updatedAt">;

export const api = {
  collections: {
    list: () => get<CollectionTree[]>("/api/collections"),
    create: (c: Partial<Collection>) => post<Collection>("/api/collections", c),
    update: (c: Collection) => put<Collection>(`/api/collections/${c.id}`, c),
    remove: (id: string) => del(`/api/collections/${id}`),
    exportUrl: (id: string) => `/api/collections/${id}/export`,
  },
  folders: {
    create: (f: { collectionId: string; parentId: string | null; name: string }) => post<Folder>("/api/folders", f),
    update: (f: Folder) => put<Folder>(`/api/folders/${f.id}`, f),
    remove: (id: string) => del(`/api/folders/${id}`),
  },
  requests: {
    create: (r: NewRequest) => post<SavedRequest>("/api/requests", r),
    update: (r: SavedRequest) => put<SavedRequest>(`/api/requests/${r.id}`, r),
    remove: (id: string) => del(`/api/requests/${id}`),
    duplicate: (id: string) => post<SavedRequest>(`/api/requests/${id}/duplicate`, {}),
  },
  environments: {
    list: () => get<Environment[]>("/api/environments"),
    create: (e: Partial<Environment>) => post<Environment>("/api/environments", e),
    update: (e: Environment) => put<Environment>(`/api/environments/${e.id}`, e),
    remove: (id: string) => del(`/api/environments/${id}`),
  },
  history: {
    list: (limit = 200) => get<HistoryEntry[]>(`/api/history?limit=${limit}`),
    remove: (id: string) => del(`/api/history/${id}`),
    clear: () => del("/api/history"),
  },
  settings: {
    get: () => get<Settings>("/api/settings"),
    save: (s: Settings) => put<Settings>("/api/settings", s),
  },
  execute: (
    body: { request: RequestSpec; environmentId: string | null; collectionId: string | null },
    signal?: AbortSignal,
  ) => request<ExecResult>("POST", "/api/execute", body, signal),
  importCurl: (command: string) => post<RequestSpec>("/api/import/curl", { command }),
  importPostman: (content: string) =>
    post<{ collection?: CollectionTree; environment?: Environment }>("/api/import/postman", { content }),
};
