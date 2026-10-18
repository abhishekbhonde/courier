import type { KV } from "../types";

// The URL string is the source of truth for what gets sent. The params table
// is kept in sync with its query string, and also remembers disabled params,
// which by definition are not in the URL. Params are shown raw (not decoded),
// so editing either side never rewrites the user's text.

interface SplitUrl {
  base: string;
  query: string | null;
  hash: string;
}

export function splitUrl(url: string): SplitUrl {
  let hash = "";
  const h = url.indexOf("#");
  if (h >= 0) {
    hash = url.slice(h);
    url = url.slice(0, h);
  }
  const q = url.indexOf("?");
  if (q < 0) return { base: url, query: null, hash };
  return { base: url.slice(0, q), query: url.slice(q + 1), hash };
}

export function parseQuery(query: string | null): KV[] {
  if (!query) return [];
  return query
    .split("&")
    .filter((p) => p !== "")
    .map((part) => {
      const eq = part.indexOf("=");
      return eq < 0
        ? { key: part, value: "", enabled: true }
        : { key: part.slice(0, eq), value: part.slice(eq + 1), enabled: true };
    });
}

/** Params after the user edited the URL: enabled rows follow the URL, disabled rows stay put. */
export function paramsFromUrl(url: string, previous: KV[]): KV[] {
  const parsed = parseQuery(splitUrl(url).query);
  const out: KV[] = [];
  let i = 0;
  for (const p of previous) {
    if (!p.enabled) {
      out.push(p);
    } else if (i < parsed.length) {
      out.push({ ...parsed[i++], description: p.description });
    }
  }
  while (i < parsed.length) out.push(parsed[i++]);
  return out;
}

/** URL after the user edited the params table. */
export function urlFromParams(url: string, params: KV[]): string {
  const { base, hash } = splitUrl(url);
  const parts = params
    .filter((p) => p.enabled && (p.key !== "" || p.value !== ""))
    .map((p) => (p.value === "" ? p.key : `${p.key}=${p.value}`));
  return base + (parts.length ? "?" + parts.join("&") : "") + hash;
}
