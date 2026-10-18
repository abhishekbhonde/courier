import { AlertTriangle, Check, Copy, Download, Loader2, Radio, WifiOff } from "lucide-react";
import { useMemo, useState } from "react";
import { base64ToBytes, formatBytes, formatMs, languageFor, prettyJson, statusClass } from "../lib/format";
import { cancelTab } from "../store/actions";
import type { Tab } from "../store/tabs";
import { toast } from "../store/ui";
import type { ExecResult, Header, Timings } from "../types";
import { CodeEditor } from "./CodeEditor";
import { Button, Count, EmptyState, IconButton, Kbd, TabStrip, cx, modKey } from "./ui";

type Section = "body" | "headers" | "cookies" | "timing" | "request";
type BodyView = "pretty" | "raw" | "preview";

export function ResponseViewer({ tab }: { tab: Tab }) {
  const [section, setSection] = useState<Section>("body");
  const res = tab.response;

  if (tab.loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <Loader2 size={22} className="animate-spin" />
        <div>Sending request…</div>
        <Button onClick={() => cancelTab(tab.id)}>Cancel</Button>
      </div>
    );
  }
  if (tab.error) {
    return (
      <EmptyState icon={<WifiOff size={28} />} title="Courier server unreachable">
        {tab.error}
      </EmptyState>
    );
  }
  if (!res) {
    return (
      <EmptyState icon={<Radio size={28} />} title="No response yet">
        Enter a URL and press Send, or <Kbd>{modKey}</Kbd> <Kbd>↵</Kbd>.
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabStrip<Section>
        value={section}
        onChange={setSection}
        tabs={[
          { id: "body", label: "Body" },
          { id: "headers", label: <>Headers <Count n={res.headers.length} /></> },
          { id: "cookies", label: <>Cookies <Count n={res.cookies.length} /></> },
          { id: "timing", label: "Timing" },
          { id: "request", label: "Request" },
        ]}
        right={<StatusLine res={res} onTiming={() => setSection("timing")} />}
      />
      {res.unresolvedVariables.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle size={13} />
          Unresolved variables: {res.unresolvedVariables.map((v) => `{{${v}}}`).join(", ")}. Check the active environment.
        </div>
      )}
      <div className="min-h-0 flex-1">
        {res.error && !res.status ? (
          <EmptyState icon={<AlertTriangle size={28} className="text-red-500" />} title="Could not send request">
            <span className="font-mono">{res.error}</span>
          </EmptyState>
        ) : (
          <>
            {section === "body" && <BodyPanel res={res} />}
            {section === "headers" && <HeaderTable headers={res.headers} />}
            {section === "cookies" && <CookieTable res={res} />}
            {section === "timing" && <TimingPanel t={res.timings} />}
            {section === "request" && <SentRequestPanel res={res} />}
          </>
        )}
      </div>
    </div>
  );
}

function StatusLine({ res, onTiming }: { res: ExecResult; onTiming: () => void }) {
  if (!res.status) return null;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className={cx("font-semibold", statusClass(res.status))}>
        {res.status} {res.statusText}
      </span>
      <button type="button" onClick={onTiming} className="text-muted hover:text-fg" title="Timing breakdown">
        <span className="text-emerald-500">{formatMs(res.timings.total)}</span>
      </button>
      <span className="text-muted" title={res.wireSize !== res.size ? `${formatBytes(res.wireSize)} transferred` : undefined}>
        <span className="text-emerald-500">{formatBytes(res.size)}</span>
      </span>
    </div>
  );
}

function isImage(ct: string) {
  return ct.toLowerCase().startsWith("image/");
}

function BodyPanel({ res }: { res: ExecResult }) {
  const lang = useMemo(() => (res.bodyEncoding === "utf8" ? languageFor(res.contentType, res.body) : "text"), [res]);
  const canPreview = lang === "html" || isImage(res.contentType);
  const binary = res.bodyEncoding === "base64";
  const views = (["pretty", "raw", "preview"] as BodyView[])
    .filter((v) => v !== "preview" || canPreview)
    .filter((v) => !binary || v !== "pretty");
  const [chosen, setView] = useState<BodyView>(isImage(res.contentType) ? "preview" : "pretty");
  // The chosen view sticks across sends but may not apply to a new response.
  const view = views.includes(chosen) ? chosen : views[0];
  const [copied, setCopied] = useState(false);

  const pretty = useMemo(() => {
    if (res.bodyEncoding !== "utf8") return "";
    // Formatting multi-megabyte JSON freezes the UI; show it raw instead.
    if (lang === "json" && res.body.length < 5_000_000) return prettyJson(res.body);
    return res.body;
  }, [res, lang]);

  const download = () => {
    const data = res.bodyEncoding === "base64" ? base64ToBytes(res.body) : res.body;
    const blob = new Blob([data as BlobPart], { type: res.contentType || "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const ext = lang === "json" ? "json" : lang === "html" ? "html" : lang === "xml" ? "xml" : res.contentType.split("/")[1]?.split(";")[0] || "bin";
    a.download = `response.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view === "pretty" ? pretty : res.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Clipboard access was denied", "error");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-3 py-1.5">
        {views.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cx("rounded px-2 py-0.5 text-xs capitalize", view === v ? "bg-hover text-fg" : "text-muted hover:text-fg")}
          >
            {v}
          </button>
        ))}
        {res.truncated && (
          <span className="ml-2 text-xs text-amber-500">Truncated at {formatBytes(res.wireSize)} (raise the limit in Settings)</span>
        )}
        {res.error && <span className="ml-2 truncate text-xs text-red-500">{res.error}</span>}
        <div className="ml-auto flex items-center">
          {!binary && (
            <IconButton label="Copy body" onClick={copy}>
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            </IconButton>
          )}
          <IconButton label="Download body" onClick={download}>
            <Download size={14} />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 border-t border-border">
        {view === "preview" ? (
          isImage(res.contentType) ? (
            <div className="flex h-full items-center justify-center overflow-auto p-4">
              <img
                alt="Response preview"
                className="max-h-full max-w-full"
                src={`data:${res.contentType};base64,${binary ? res.body : btoa(unescape(encodeURIComponent(res.body)))}`}
              />
            </div>
          ) : (
            // An empty sandbox blocks scripts, forms and navigation in the previewed page.
            <iframe title="HTML preview" sandbox="" srcDoc={res.body} className="h-full w-full bg-white" />
          )
        ) : binary ? (
          <EmptyState title="Binary response">
            {formatBytes(res.size)} of {res.contentType || "binary data"}. Use download to save it.
          </EmptyState>
        ) : res.body === "" ? (
          <EmptyState title="Empty body">The response did not include a body.</EmptyState>
        ) : (
          <CodeEditor value={view === "pretty" ? pretty : res.body} language={view === "pretty" ? lang : "text"} readOnly wrap={view === "raw"} />
        )}
      </div>
    </div>
  );
}

function HeaderTable({ headers }: { headers: Header[] }) {
  if (!headers.length) return <EmptyState title="No headers" />;
  return (
    <div className="h-full overflow-auto p-3">
      <table className="w-full border-collapse font-mono text-[12px]">
        <tbody>
          {headers.map((h, i) => (
            <tr key={i} className="border-b border-border align-top last:border-0">
              <td className="w-1/3 py-1.5 pr-4 font-medium break-all text-muted">{h.name}</td>
              <td className="py-1.5 break-all select-text">{h.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CookieTable({ res }: { res: ExecResult }) {
  if (!res.cookies.length) return <EmptyState title="No cookies">The response did not set any cookies.</EmptyState>;
  const cols = ["Name", "Value", "Domain", "Path", "Expires", "HttpOnly", "Secure", "SameSite"];
  return (
    <div className="h-full overflow-auto p-3">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            {cols.map((c) => (
              <th key={c} className="py-1.5 pr-4 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {res.cookies.map((c, i) => (
            <tr key={i} className="border-b border-border align-top last:border-0">
              <td className="py-1.5 pr-4">{c.name}</td>
              <td className="max-w-xs py-1.5 pr-4 break-all">{c.value}</td>
              <td className="py-1.5 pr-4">{c.domain}</td>
              <td className="py-1.5 pr-4">{c.path}</td>
              <td className="py-1.5 pr-4">{c.expires ?? (c.maxAge ? `${c.maxAge}s` : "Session")}</td>
              <td className="py-1.5 pr-4">{c.httpOnly ? "✓" : ""}</td>
              <td className="py-1.5 pr-4">{c.secure ? "✓" : ""}</td>
              <td className="py-1.5 pr-4">{c.sameSite}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PHASES: { key: keyof Timings; label: string; color: string }[] = [
  { key: "dns", label: "DNS lookup", color: "bg-sky-500" },
  { key: "connect", label: "TCP connect", color: "bg-violet-500" },
  { key: "tls", label: "TLS handshake", color: "bg-fuchsia-500" },
  { key: "send", label: "Request sent", color: "bg-amber-500" },
  { key: "waiting", label: "Waiting (TTFB)", color: "bg-emerald-500" },
  { key: "download", label: "Content download", color: "bg-orange-500" },
];

function TimingPanel({ t }: { t: Timings }) {
  const total = Math.max(t.total, 0.001);
  let offset = 0;
  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-2xl space-y-2.5">
        {PHASES.map((p) => {
          const start = offset;
          offset += t[p.key];
          return (
            <div key={p.key} className="flex items-center gap-3 text-xs">
              <div className="w-32 shrink-0 text-muted">{p.label}</div>
              <div className="relative h-2.5 flex-1 rounded-sm bg-hover">
                {t[p.key] > 0 && (
                  <div
                    className={cx("absolute inset-y-0 rounded-sm", p.color)}
                    style={{ left: `${(start / total) * 100}%`, width: `${Math.max((t[p.key] / total) * 100, 0.5)}%` }}
                  />
                )}
              </div>
              <div className="w-20 shrink-0 text-right font-mono">{t[p.key] > 0 ? formatMs(t[p.key]) : "—"}</div>
            </div>
          );
        })}
        <div className="flex items-center gap-3 border-t border-border pt-2.5 text-xs font-medium">
          <div className="w-32 shrink-0">Total</div>
          <div className="flex-1" />
          <div className="w-20 shrink-0 text-right font-mono">{formatMs(t.total)}</div>
        </div>
        <p className="pt-2 text-xs text-muted">Phases marked — did not happen, e.g. no DNS for an IP address or no TLS for plain HTTP.</p>
      </div>
    </div>
  );
}

function SentRequestPanel({ res }: { res: ExecResult }) {
  const r = res.request;
  if (!r) return <EmptyState title="Request was not sent" />;
  return (
    <div className="h-full overflow-auto p-3">
      <div className="mb-3 font-mono text-[12px] break-all">
        <span className="font-semibold">{r.method}</span> {r.url}
      </div>
      {res.url && res.url !== r.url && (
        <div className="mb-3 text-xs text-muted">
          Redirected to <span className="font-mono">{res.url}</span>
        </div>
      )}
      <HeaderTable headers={r.headers} />
      {r.bodySize > 0 && <div className="px-3 text-xs text-muted">Body: {formatBytes(r.bodySize)}</div>}
    </div>
  );
}
