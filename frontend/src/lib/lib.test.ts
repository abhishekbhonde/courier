import { describe, expect, it } from "vitest";
import { blankSpec, type RequestSpec } from "../types";
import { generate, resolveSpec } from "./codegen";
import { paramsFromUrl, urlFromParams } from "./url";
import { resolve, segments, variableMap } from "./vars";

describe("url/params sync", () => {
  it("parses params from the URL, keeping disabled rows", () => {
    const prev = [
      { key: "a", value: "1", enabled: true, description: "first" },
      { key: "off", value: "x", enabled: false },
    ];
    const next = paramsFromUrl("https://x.test/p?a=2&b&c=3#frag", prev);
    expect(next).toEqual([
      { key: "a", value: "2", enabled: true, description: "first" },
      { key: "off", value: "x", enabled: false },
      { key: "b", value: "", enabled: true },
      { key: "c", value: "3", enabled: true },
    ]);
  });

  it("rebuilds the URL from enabled params and keeps the fragment", () => {
    const url = urlFromParams("https://x.test/p?old=1#frag", [
      { key: "a", value: "{{v}}", enabled: true },
      { key: "b", value: "", enabled: true },
      { key: "skip", value: "1", enabled: false },
    ]);
    expect(url).toBe("https://x.test/p?a={{v}}&b#frag");
    expect(urlFromParams("https://x.test/p?a=1", [])).toBe("https://x.test/p");
  });

  it("round-trips raw text without re-encoding", () => {
    const url = "https://x.test/?q=a%20b&r=c+d";
    expect(urlFromParams(url, paramsFromUrl(url, []))).toBe(url);
  });
});

describe("variables", () => {
  it("splits segments and resolves nested variables", () => {
    expect(segments("{{base}}/users/{{ id }}")).toEqual([
      { text: "{{base}}", variable: "base" },
      { text: "/users/" },
      { text: "{{ id }}", variable: "id" },
    ]);
    const vars = variableMap(
      [{ key: "host", value: "low", enabled: true }],
      [
        { key: "host", value: "api.test", enabled: true },
        { key: "base", value: "https://{{host}}", enabled: true },
      ],
    );
    expect(resolve("{{base}}/{{missing}}", vars)).toBe("https://api.test/{{missing}}");
  });
});

describe("codegen", () => {
  const spec: RequestSpec = {
    ...blankSpec(),
    method: "POST",
    url: "{{base}}/users",
    headers: [{ key: "X-Id", value: "it's", enabled: true }],
    body: { mode: "json", raw: '{"a":1}' },
    auth: { type: "inherit" },
  };
  const resolved = resolveSpec(spec, variableMap([{ key: "base", value: "https://api.test", enabled: true }]), {
    type: "bearer",
    token: "t0k",
  });

  it("generates curl with shell-safe quoting and inherited auth", () => {
    expect(generate("curl", resolved)).toBe(
      [
        "curl --request POST 'https://api.test/users'",
        "  --header 'X-Id: it'\\''s'",
        "  --header 'Authorization: Bearer t0k'",
        "  --header 'Content-Type: application/json'",
        `  --data-raw '{"a":1}'`,
      ].join(" \\\n"),
    );
  });

  it("generates the other languages", () => {
    expect(generate("fetch", resolved)).toContain(`method: "POST"`);
    expect(generate("python", resolved)).toContain(`requests.request("POST", url, headers=headers, data=payload)`);
    expect(generate("go", resolved)).toContain('req.Header.Set("Authorization", "Bearer t0k")');
  });

  it("adds api keys to the query string", () => {
    const s = { ...blankSpec(), url: "x.test/a?b=1", auth: { type: "apikey" as const, key: "k", value: "v w", in: "query" as const } };
    expect(generate("curl", s)).toBe("curl 'http://x.test/a?b=1&k=v%20w'");
  });
});
