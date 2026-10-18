import type { Variable } from "../types";

// Matches the backend's pattern in internal/runner/vars.go.
const VAR = /\{\{\s*([^{}\s]+)\s*\}\}/g;

export const DYNAMIC_VARS = ["$guid", "$uuid", "$randomUUID", "$timestamp", "$isoTimestamp", "$randomInt"];

export type Segment = { text: string; variable?: string };

/** Splits text into plain and {{variable}} segments, for highlighting. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(VAR)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], variable: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Merges variable scopes, lowest priority first, into a lookup map. */
export function variableMap(...scopes: (Variable[] | undefined)[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const scope of scopes) {
    for (const v of scope ?? []) {
      if (v.enabled && v.key) m.set(v.key, v.value);
    }
  }
  return m;
}

/** Client-side resolution, used for code snippets and previews. Dynamic variables are left in place. */
export function resolve(text: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 5) return text;
  return text.replace(VAR, (match, name: string) => {
    const v = vars.get(name);
    return v === undefined ? match : resolve(v, vars, depth + 1);
  });
}

export function isKnown(name: string, vars: Map<string, string>): boolean {
  return vars.has(name) || DYNAMIC_VARS.includes(name);
}
