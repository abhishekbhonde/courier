import type { Auth, KV, RequestSpec } from "../types";
import { bytesToBase64 } from "./format";
import { resolve } from "./vars";

export const LANGUAGES = [
  { id: "curl", label: "cURL" },
  { id: "fetch", label: "JavaScript (fetch)" },
  { id: "python", label: "Python (requests)" },
  { id: "go", label: "Go (net/http)" },
] as const;

export type Language = (typeof LANGUAGES)[number]["id"];

type PreparedBody =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "urlencoded"; pairs: [string, string][] }
  | { kind: "form"; fields: { key: string; value?: string; file?: string }[] };

interface Prepared {
  method: string;
  url: string;
  headers: [string, string][];
  body: PreparedBody;
}

/** Substitutes variables throughout a spec. `auth` replaces an "inherit" auth. */
export function resolveSpec(spec: RequestSpec, vars: Map<string, string>, inherited?: Auth): RequestSpec {
  const r = (s: string | undefined) => (s === undefined ? s : resolve(s, vars));
  const kv = (list: KV[] | undefined) => list?.map((p) => ({ ...p, key: r(p.key)!, value: r(p.value)! }));
  let auth = spec.auth;
  if (auth.type === "inherit") auth = inherited ?? { type: "none" };
  return {
    ...spec,
    url: r(spec.url)!,
    params: kv(spec.params)!,
    headers: kv(spec.headers)!,
    body: {
      ...spec.body,
      raw: r(spec.body.raw),
      urlencoded: kv(spec.body.urlencoded),
      formdata: spec.body.formdata?.map((f) => ({ ...f, key: r(f.key)!, value: r(f.value)! })),
    },
    auth: {
      ...auth,
      token: r(auth.token),
      username: r(auth.username),
      password: r(auth.password),
      key: r(auth.key),
      value: r(auth.value),
    },
  };
}

function hasHeader(headers: [string, string][], name: string) {
  return headers.some(([k]) => k.toLowerCase() === name.toLowerCase());
}

function prepare(spec: RequestSpec): Prepared {
  let url = spec.url.trim();
  if (url && !url.includes("://")) url = "http://" + url;
  const headers: [string, string][] = spec.headers
    .filter((h) => h.enabled && h.key.trim())
    .map((h) => [h.key.trim(), h.value]);

  const a = spec.auth;
  if (a.type === "bearer" && a.token && !hasHeader(headers, "Authorization")) {
    headers.push(["Authorization", `Bearer ${a.token}`]);
  } else if (a.type === "basic" && !hasHeader(headers, "Authorization")) {
    const cred = bytesToBase64(new TextEncoder().encode(`${a.username ?? ""}:${a.password ?? ""}`));
    headers.push(["Authorization", `Basic ${cred}`]);
  } else if (a.type === "apikey" && a.key) {
    if (a.in === "query") {
      const pair = `${encodeURIComponent(a.key)}=${encodeURIComponent(a.value ?? "")}`;
      const hash = url.indexOf("#");
      if (hash >= 0) url = url.slice(0, hash);
      url += (url.includes("?") ? "&" : "?") + pair;
    } else if (!hasHeader(headers, a.key)) {
      headers.push([a.key, a.value ?? ""]);
    }
  }

  let body: PreparedBody = { kind: "none" };
  const b = spec.body;
  const setType = (ct: string) => {
    if (!hasHeader(headers, "Content-Type")) headers.push(["Content-Type", ct]);
  };
  switch (b.mode) {
    case "json":
      body = { kind: "text", text: b.raw ?? "" };
      setType("application/json");
      break;
    case "raw":
      body = { kind: "text", text: b.raw ?? "" };
      setType(b.contentType || "text/plain");
      break;
    case "urlencoded":
      body = {
        kind: "urlencoded",
        pairs: (b.urlencoded ?? []).filter((p) => p.enabled && p.key).map((p) => [p.key, p.value]),
      };
      setType("application/x-www-form-urlencoded");
      break;
    case "formdata":
      body = {
        kind: "form",
        fields: (b.formdata ?? [])
          .filter((f) => f.enabled && f.key)
          .map((f) => (f.type === "file" ? { key: f.key, file: f.fileName || "file" } : { key: f.key, value: f.value })),
      };
      break;
  }
  return { method: spec.method.toUpperCase(), url, headers, body };
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const str = (s: string) => JSON.stringify(s);

function curl(p: Prepared): string {
  const lines: string[] = [];
  const hasBody = p.body.kind !== "none";
  lines.push(p.method === "GET" && !hasBody ? `curl ${sh(p.url)}` : `curl --request ${p.method} ${sh(p.url)}`);
  for (const [k, v] of p.headers) lines.push(`--header ${sh(`${k}: ${v}`)}`);
  switch (p.body.kind) {
    case "text":
      lines.push(`--data-raw ${sh(p.body.text)}`);
      break;
    case "urlencoded":
      for (const [k, v] of p.body.pairs) lines.push(`--data-urlencode ${sh(`${k}=${v}`)}`);
      break;
    case "form":
      for (const f of p.body.fields) lines.push(`--form ${sh(f.file ? `${f.key}=@${f.file}` : `${f.key}=${f.value}`)}`);
      break;
  }
  return lines.join(" \\\n  ");
}

function fetchJs(p: Prepared): string {
  const out: string[] = [];
  let bodyExpr = "";
  const headers = p.body.kind === "form" ? p.headers.filter(([k]) => k.toLowerCase() !== "content-type") : p.headers;
  switch (p.body.kind) {
    case "text":
      bodyExpr = str(p.body.text);
      break;
    case "urlencoded":
      out.push(`const body = new URLSearchParams([`);
      for (const [k, v] of p.body.pairs) out.push(`  [${str(k)}, ${str(v)}],`);
      out.push(`]);`, "");
      bodyExpr = "body";
      break;
    case "form":
      out.push(`const body = new FormData();`);
      for (const f of p.body.fields) {
        out.push(
          f.file
            ? `body.append(${str(f.key)}, fileInput.files[0], ${str(f.file)});`
            : `body.append(${str(f.key)}, ${str(f.value ?? "")});`,
        );
      }
      out.push("");
      bodyExpr = "body";
      break;
  }
  out.push(`const response = await fetch(${str(p.url)}, {`);
  out.push(`  method: ${str(p.method)},`);
  if (headers.length) {
    out.push(`  headers: {`);
    for (const [k, v] of headers) out.push(`    ${str(k)}: ${str(v)},`);
    out.push(`  },`);
  }
  if (bodyExpr) out.push(`  body: ${bodyExpr},`);
  out.push(`});`, "", `console.log(response.status, await response.text());`);
  return out.join("\n");
}

function python(p: Prepared): string {
  const out = ["import requests", "", `url = ${str(p.url)}`];
  const headers = p.body.kind === "form" ? p.headers.filter(([k]) => k.toLowerCase() !== "content-type") : p.headers;
  const args = ["url"];
  if (headers.length) {
    out.push("headers = {");
    for (const [k, v] of headers) out.push(`    ${str(k)}: ${str(v)},`);
    out.push("}");
    args.push("headers=headers");
  }
  switch (p.body.kind) {
    case "text":
      out.push(`payload = ${str(p.body.text)}`);
      args.push("data=payload");
      break;
    case "urlencoded":
      out.push("payload = [");
      for (const [k, v] of p.body.pairs) out.push(`    (${str(k)}, ${str(v)}),`);
      out.push("]");
      args.push("data=payload");
      break;
    case "form": {
      const text = p.body.fields.filter((f) => !f.file);
      const files = p.body.fields.filter((f) => f.file);
      if (text.length) {
        out.push("payload = {");
        for (const f of text) out.push(`    ${str(f.key)}: ${str(f.value ?? "")},`);
        out.push("}");
        args.push("data=payload");
      }
      if (files.length) {
        out.push("files = {");
        for (const f of files) out.push(`    ${str(f.key)}: open(${str(f.file!)}, "rb"),`);
        out.push("}");
        args.push("files=files");
      }
      break;
    }
  }
  out.push("", `response = requests.request(${str(p.method)}, ${args.join(", ")})`, "");
  out.push("print(response.status_code)", "print(response.text)");
  return out.join("\n");
}

function goLiteral(s: string): string {
  return s.includes("`") ? str(s) : "`" + s + "`";
}

function goCode(p: Prepared): string {
  const imports = new Set(["fmt", "io", "net/http"]);
  const pre: string[] = [];
  let bodyExpr = "nil";
  let headers = p.headers;
  switch (p.body.kind) {
    case "text":
      imports.add("strings");
      bodyExpr = `strings.NewReader(${goLiteral(p.body.text)})`;
      break;
    case "urlencoded":
      imports.add("net/url").add("strings");
      pre.push("\tform := url.Values{}");
      for (const [k, v] of p.body.pairs) pre.push(`\tform.Add(${str(k)}, ${str(v)})`);
      bodyExpr = "strings.NewReader(form.Encode())";
      break;
    case "form":
      imports.add("bytes").add("mime/multipart").add("os");
      headers = headers.filter(([k]) => k.toLowerCase() !== "content-type");
      pre.push("\tvar buf bytes.Buffer", "\tmw := multipart.NewWriter(&buf)");
      for (const f of p.body.fields) {
        if (f.file) {
          pre.push(
            `\tif fw, err := mw.CreateFormFile(${str(f.key)}, ${str(f.file)}); err == nil {`,
            `\t\tif data, err := os.ReadFile(${str(f.file)}); err == nil {`,
            "\t\t\tfw.Write(data)",
            "\t\t}",
            "\t}",
          );
        } else {
          pre.push(`\tmw.WriteField(${str(f.key)}, ${str(f.value ?? "")})`);
        }
      }
      pre.push("\tmw.Close()");
      bodyExpr = "&buf";
      break;
  }
  const out = ["package main", "", "import ("];
  for (const i of [...imports].sort()) out.push(`\t${str(i)}`);
  out.push(")", "", "func main() {", ...pre);
  out.push(`\treq, err := http.NewRequest(${str(p.method)}, ${str(p.url)}, ${bodyExpr})`);
  out.push("\tif err != nil {", "\t\tpanic(err)", "\t}");
  for (const [k, v] of headers) out.push(`\treq.Header.Set(${str(k)}, ${str(v)})`);
  if (p.body.kind === "form") out.push("\treq.Header.Set(\"Content-Type\", mw.FormDataContentType())");
  out.push(
    "",
    "\tres, err := http.DefaultClient.Do(req)",
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "\tdefer res.Body.Close()",
    "",
    "\tbody, _ := io.ReadAll(res.Body)",
    "\tfmt.Println(res.Status)",
    "\tfmt.Println(string(body))",
    "}",
  );
  return out.join("\n");
}

export function generate(lang: Language, spec: RequestSpec): string {
  const p = prepare(spec);
  switch (lang) {
    case "curl":
      return curl(p);
    case "fetch":
      return fetchJs(p);
    case "python":
      return python(p);
    case "go":
      return goCode(p);
  }
}
