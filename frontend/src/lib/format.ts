export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 2 : 1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function statusClass(status: number): string {
  if (status >= 500) return "text-red-500";
  if (status >= 400) return "text-orange-500";
  if (status >= 300) return "text-sky-500";
  if (status >= 200) return "text-emerald-500";
  return "text-muted";
}

export function methodClass(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-emerald-500";
    case "POST":
      return "text-amber-500";
    case "PUT":
      return "text-sky-500";
    case "PATCH":
      return "text-violet-400";
    case "DELETE":
      return "text-red-500";
    default:
      return "text-pink-400";
  }
}

export type BodyLanguage = "json" | "html" | "xml" | "text";

export function languageFor(contentType: string, body: string): BodyLanguage {
  const ct = contentType.toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml") || ct.includes("svg")) return "xml";
  const t = body.trimStart();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(body);
      return "json";
    } catch {
      /* not JSON */
    }
  }
  if (t.startsWith("<")) return t.toLowerCase().startsWith("<!doctype html") || t.startsWith("<html") ? "html" : "xml";
  return "text";
}

/** Pretty-prints JSON; returns the input unchanged if it does not parse. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
