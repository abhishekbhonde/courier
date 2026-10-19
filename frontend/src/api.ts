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
import { storage } from "./store/storage";
import { prompt } from "./store/ui";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// A hosted server requires an access token (COURIER_TOKEN); a local one doesn't.
const TOKEN_KEY = "courier.token";
let tokenPrompt: Promise<string | null> | null = null;

// askToken shows one prompt no matter how many requests were rejected at once.
function askToken(): Promise<string | null> {
  tokenPrompt ??= prompt({
    title: "Access token required",
    label: "This Courier server needs its access token",
    confirmText: "Connect",
    secret: true,
  }).then((t) => {
    tokenPrompt = null;
    t = t?.trim() || null;
    if (t) storage.set(TOKEN_KEY, t);
    return t;
  });
  return tokenPrompt;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  for (let retried = false; ; retried = true) {
    const token = storage.get(TOKEN_KEY);
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(path, { ...init, headers });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ApiError("Cannot reach the Courier server. Is it running?", 0);
    }
    if (res.status !== 401 || retried) return res;
    if (token) storage.set(TOKEN_KEY, null);
    if (!(await askToken())) return res;
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await send(path, {
    method,
    signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
    export: async (id: string) => {
      const res = await send(`/api/collections/${id}/export`, {});
      if (!res.ok) throw new ApiError(res.statusText, res.status);
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
      return { blob: await res.blob(), filename: name ?? "collection.json" };
    },
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
