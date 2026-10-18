import { ChevronRight, Code2, Loader2, Save, Send, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { paramsFromUrl, urlFromParams } from "../lib/url";
import { methodClass } from "../lib/format";
import { cancelTab, saveTab, sendTab } from "../store/actions";
import { isDirty, useTabs, type Tab } from "../store/tabs";
import { toast, useUI } from "../store/ui";
import { useWorkspace } from "../store/workspace";
import { METHODS, type RequestSpec } from "../types";
import { AuthEditor, describeAuth } from "./AuthEditor";
import { BodyEditor } from "./BodyEditor";
import { KeyValueEditor } from "./KeyValueEditor";
import { VarInput } from "./VarInput";
import { Button, Count, Kbd, TabStrip, cx, modKey } from "./ui";

type Section = "params" | "auth" | "headers" | "body";

export function RequestEditor({ tab }: { tab: Tab }) {
  const updateSpec = useTabs((s) => s.updateSpec);
  const patch = useTabs((s) => s.patch);
  const openModal = useUI((s) => s.openModal);
  const collections = useWorkspace((s) => s.collections);
  const [section, setSection] = useState<Section>(tab.spec.body.mode !== "none" ? "body" : "params");

  const spec = tab.spec;
  const set = (fn: (s: RequestSpec) => RequestSpec) => updateSpec(tab.id, fn);
  const collection = collections.find((c) => c.id === tab.collectionId);
  const dirty = isDirty(tab);

  const folderPath = useMemo(() => {
    if (!collection || !tab.requestId) return [];
    const req = collection.requests.find((r) => r.id === tab.requestId);
    const path: string[] = [];
    let fid = req?.folderId ?? null;
    while (fid) {
      const f = collection.folders.find((f) => f.id === fid);
      if (!f) break;
      path.unshift(f.name);
      fid = f.parentId;
    }
    return path;
  }, [collection, tab.requestId]);

  const onUrlChange = (url: string) => set((s) => ({ ...s, url, params: paramsFromUrl(url, s.params) }));

  const onPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/^\s*curl\s/.test(text)) return;
    e.preventDefault();
    try {
      const imported = await api.importCurl(text);
      set((s) => ({ ...imported, auth: imported.auth.type === "none" ? s.auth : imported.auth }));
      toast("Imported cURL command", "success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const enabledHeaders = spec.headers.filter((h) => h.enabled && h.key).length;
  const enabledParams = spec.params.filter((p) => p.enabled && p.key).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Title row */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          {collection && (
            <>
              <span className="truncate text-muted">{collection.name}</span>
              {folderPath.map((f, i) => (
                <span key={i} className="flex items-center gap-1 text-muted">
                  <ChevronRight size={13} />
                  <span className="truncate">{f}</span>
                </span>
              ))}
              <ChevronRight size={13} className="shrink-0 text-muted" />
            </>
          )}
          <input
            value={tab.name}
            onChange={(e) => patch(tab.id, { name: e.target.value })}
            className="min-w-0 flex-1 truncate rounded bg-transparent px-1 py-0.5 font-medium outline-none hover:bg-hover focus:bg-elevated"
            aria-label="Request name"
          />
        </div>
        <Button variant="ghost" onClick={() => openModal({ type: "code", tabId: tab.id })} title="Generate code">
          <Code2 size={14} /> Code
        </Button>
        <Button onClick={() => saveTab(tab.id)} title={`Save (${modKey}+S)`}>
          <Save size={14} />
          Save
          {dirty && tab.requestId && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
        </Button>
      </div>

      {/* URL bar */}
      <div className="flex gap-2 px-4 pb-3">
        <div className="flex h-9 min-w-0 flex-1 rounded-md border border-border bg-elevated focus-within:border-accent">
          <select
            value={spec.method}
            onChange={(e) => set((s) => ({ ...s, method: e.target.value }))}
            className={cx("w-28 shrink-0 rounded-l-md border-r border-border bg-transparent px-2 font-mono text-xs font-bold outline-none", methodClass(spec.method))}
            aria-label="Method"
          >
            {METHODS.map((m) => (
              <option key={m} value={m} className="text-fg">
                {m}
              </option>
            ))}
            {!METHODS.includes(spec.method as (typeof METHODS)[number]) && <option value={spec.method}>{spec.method}</option>}
          </select>
          <VarInput
            value={spec.url}
            onChange={onUrlChange}
            onPaste={onPaste}
            placeholder="Enter URL or paste a cURL command"
            className="h-full flex-1"
            aria-label="URL"
          />
        </div>
        {tab.loading ? (
          <Button variant="secondary" className="h-9 w-28" onClick={() => cancelTab(tab.id)}>
            <X size={14} /> Cancel
          </Button>
        ) : (
          <Button variant="primary" className="h-9 w-28" onClick={() => sendTab(tab.id)} title={`Send (${modKey}+Enter)`}>
            <Send size={14} /> Send
          </Button>
        )}
      </div>

      <TabStrip<Section>
        value={section}
        onChange={setSection}
        tabs={[
          { id: "params", label: <>Params <Count n={enabledParams} /></> },
          { id: "auth", label: <>Authorization {spec.auth.type !== "none" && spec.auth.type !== "inherit" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}</> },
          { id: "headers", label: <>Headers <Count n={enabledHeaders} /></> },
          { id: "body", label: <>Body {spec.body.mode !== "none" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}</> },
        ]}
        right={tab.loading ? <Loader2 size={14} className="animate-spin text-muted" /> : <span className="hidden text-xs text-muted lg:inline"><Kbd>{modKey}</Kbd> <Kbd>↵</Kbd> to send</span>}
      />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {section === "params" && (
          <div className="space-y-2">
            <KeyValueEditor
              rows={spec.params}
              onChange={(params) => set((s) => ({ ...s, params, url: urlFromParams(s.url, params) }))}
              withDescription
            />
            <p className="text-xs text-muted">Query params stay in sync with the URL. Disabled params are kept here but not sent.</p>
          </div>
        )}
        {section === "auth" && (
          <AuthEditor
            auth={spec.auth}
            onChange={(auth) => set((s) => ({ ...s, auth }))}
            allowInherit
            inheritedFrom={
              collection
                ? `Uses the collection's auth: ${describeAuth(collection.auth)} from "${collection.name}". Edit it in the collection settings.`
                : undefined
            }
          />
        )}
        {section === "headers" && (
          <div className="space-y-2">
            <KeyValueEditor rows={spec.headers} onChange={(headers) => set((s) => ({ ...s, headers }))} withDescription />
            <p className="text-xs text-muted">
              Courier adds <code>User-Agent</code>, <code>Accept</code>, <code>Accept-Encoding</code> and <code>Content-Type</code> automatically
              unless you set them here.
            </p>
          </div>
        )}
        {section === "body" && <BodyEditor body={spec.body} onChange={(body) => set((s) => ({ ...s, body }))} />}
      </div>
    </div>
  );
}
