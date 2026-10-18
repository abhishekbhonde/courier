// These types mirror backend/internal/model and backend/internal/runner.

export interface KV {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export interface Variable {
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
}

export interface FormField {
  key: string;
  value: string;
  enabled: boolean;
  type: "text" | "file";
  fileName?: string;
  /** base64 */
  fileContent?: string;
  contentType?: string;
}

export type BodyMode = "none" | "json" | "raw" | "urlencoded" | "formdata";

export interface Body {
  mode: BodyMode;
  raw?: string;
  contentType?: string;
  urlencoded?: KV[];
  formdata?: FormField[];
}

export type AuthType = "none" | "inherit" | "bearer" | "basic" | "apikey";

export interface Auth {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  in?: "header" | "query";
}

export interface RequestSpec {
  method: string;
  url: string;
  params: KV[];
  headers: KV[];
  body: Body;
  auth: Auth;
}

export interface SavedRequest extends RequestSpec {
  id: string;
  collectionId: string;
  folderId: string | null;
  name: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  collectionId: string;
  parentId: string | null;
  name: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  variables: Variable[];
  auth: Auth;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionTree extends Collection {
  folders: Folder[];
  requests: SavedRequest[];
}

export interface Environment {
  id: string;
  name: string;
  variables: Variable[];
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  request: RequestSpec;
  status: number;
  durationMs: number;
  size: number;
  error?: string;
  createdAt: string;
}

export interface Settings {
  timeoutMs: number;
  followRedirects: boolean;
  verifyTls: boolean;
  maxResponseBytes: number;
  historyLimit: number;
}

export interface Header {
  name: string;
  value: string;
}

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

export interface Timings {
  dns: number;
  connect: number;
  tls: number;
  send: number;
  waiting: number;
  download: number;
  total: number;
}

export interface ExecResult {
  status: number;
  statusText: string;
  proto: string;
  url: string;
  headers: Header[];
  cookies: Cookie[];
  contentType: string;
  body: string;
  bodyEncoding: "utf8" | "base64";
  size: number;
  wireSize: number;
  truncated: boolean;
  timings: Timings;
  request?: { method: string; url: string; headers: Header[]; bodySize: number };
  unresolvedVariables: string[];
  error?: string;
}

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export function blankSpec(): RequestSpec {
  return {
    method: "GET",
    url: "",
    params: [],
    headers: [],
    body: { mode: "none" },
    auth: { type: "inherit" },
  };
}
