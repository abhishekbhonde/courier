import { Check, Copy, FileJson, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { LANGUAGES, generate, resolveSpec, type Language } from "../lib/codegen";
import { variableMap } from "../lib/vars";
import { storage } from "../store/storage";
import { useTabs } from "../store/tabs";
import { attempt, toast, useUI } from "../store/ui";
import { activeEnvironment, useWorkspace } from "../store/workspace";
import type { Auth, CollectionTree, Settings, Variable } from "../types";
import { AuthEditor } from "./AuthEditor";
import { CodeEditor } from "./CodeEditor";
import { KeyValueEditor } from "./KeyValueEditor";
import { Button, Checkbox, Field, Input, Modal, Select, TabStrip, cx } from "./ui";

export function ModalHost() {
  const modal = useUI((s) => s.modal);
  const close = useUI((s) => s.closeModal);
  if (!modal) return null;
  switch (modal.type) {
    case "save":
      return <SaveRequestModal tabId={modal.tabId} onClose={close} />;
    case "import":
      return <ImportModal onClose={close} />;
    case "environment":
      return <EnvironmentModal id={modal.id} onClose={close} />;
    case "collection":
      return <CollectionModal id={modal.id} onClose={close} />;
    case "settings":
      return <SettingsModal onClose={close} />;
    case "code":
      return <CodeModal tabId={modal.tabId} onClose={close} />;
  }
}

// ---------------- save ----------------

/** Folder options for a collection, indented by depth. */
function folderOptions(c: CollectionTree | undefined): { id: string; label: string }[] {
  if (!c) return [];
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of c.folders.filter((f) => f.parentId === parent)) {
      out.push({ id: f.id, label: `${"   ".repeat(depth)}${f.name}` });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const NEW = "__new__";

function SaveRequestModal({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const markSaved = useTabs((s) => s.markSaved);
  const collections = useWorkspace((s) => s.collections);
  const refresh = useWorkspace((s) => s.refreshCollections);

  const [name, setName] = useState(tab?.name === "Untitled request" && tab.spec.url ? tab.spec.url : (tab?.name ?? ""));
  const [collectionId, setCollectionId] = useState(tab?.collectionId ?? collections[0]?.id ?? NEW);
  const [folderId, setFolderId] = useState("");
  const [newCollection, setNewCollection] = useState("");
  const [busy, setBusy] = useState(false);

  if (!tab) return null;
  const folders = folderOptions(collections.find((c) => c.id === collectionId));

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    let cid = collectionId;
    if (cid === NEW) {
      const c = await attempt(() => api.collections.create({ name: newCollection.trim() || "My collection" }));
      if (!c) return setBusy(false);
      cid = c.id;
    }
    const saved = await attempt(() => api.requests.create({ ...tab.spec, name: name.trim(), collectionId: cid, folderId: folderId || null }));
    setBusy(false);
    if (!saved) return;
    useTabs.getState().patch(tabId, { name: saved.name });
    markSaved(tabId, saved);
    await refresh();
    toast("Request saved", "success");
    onClose();
  };

  return (
    <Modal
      title="Save request"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save())}>
        <Field label="Request name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Collection">
          <Select value={collectionId} onChange={(e) => (setCollectionId(e.target.value), setFolderId(""))} className="w-full">
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW}>+ New collection…</option>
          </Select>
        </Field>
        {collectionId === NEW ? (
          <Field label="New collection name">
            <Input value={newCollection} onChange={(e) => setNewCollection(e.target.value)} placeholder="My collection" />
          </Field>
        ) : (
          folders.length > 0 && (
            <Field label="Folder">
              <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="w-full">
                <option value="">(collection root)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
          )
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------- import ----------------

function ImportModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ws = useWorkspace();
  const newTab = useTabs((s) => s.newTab);

  const run = async (content: string) => {
    content = content.trim();
    if (!content) return;
    setBusy(true);
    try {
      if (/^curl\s/.test(content)) {
        const spec = await api.importCurl(content);
        newTab({ name: spec.url || "Imported request", spec: { ...spec, auth: spec.auth.type === "none" ? { type: "inherit" } : spec.auth } });
        toast("cURL command imported into a new tab", "success");
      } else {
        const res = await api.importPostman(content);
        if (res.collection) {
          await ws.refreshCollections();
          toast(`Imported collection "${res.collection.name}" (${res.collection.requests.length} requests)`, "success");
        } else if (res.environment) {
          await ws.refreshEnvironments();
          toast(`Imported environment "${res.environment.name}"`, "success");
        }
      }
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (f: File | undefined) => {
    if (f) await run(await f.text());
  };

  return (
    <Modal
      title="Import"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => run(text)} disabled={busy || !text.trim()}>
            Import
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            readFile(e.dataTransfer.files[0]);
          }}
          onClick={() => fileRef.current?.click()}
          className={cx(
            "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors",
            dragOver ? "border-accent bg-accent/5" : "border-border hover:bg-hover/50",
          )}
        >
          <FileJson size={26} className="text-muted" />
          <div className="font-medium">Drop a file here or click to choose</div>
          <div className="text-xs text-muted">Postman collection (v2.0 / v2.1) or Postman environment, as JSON</div>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => readFile(e.target.files?.[0])} />
        </div>
        <Field label="…or paste a cURL command or JSON">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={"curl https://api.example.com/users -H 'Accept: application/json'"}
            className="w-full rounded-md border border-border bg-elevated p-2.5 font-mono text-[12px] outline-none focus:border-accent"
          />
        </Field>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Terminal size={13} /> Tip: you can also paste a cURL command straight into the URL bar.
        </p>
      </div>
    </Modal>
  );
}

// ---------------- environment ----------------

function EnvironmentModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const ws = useWorkspace();
  const existing = ws.environments.find((e) => e.id === id);
  const [name, setName] = useState(existing?.name ?? "");
  const [vars, setVars] = useState<Variable[]>(existing?.variables ?? []);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const clean = vars.filter((v) => v.key.trim() !== "" || v.value !== "");
    const saved = await attempt(() =>
      existing ? api.environments.update({ ...existing, name, variables: clean }) : api.environments.create({ name, variables: clean }),
    );
    setBusy(false);
    if (!saved) return;
    await ws.refreshEnvironments();
    if (!existing && !ws.activeEnvironmentId) ws.setActiveEnvironment(saved.id);
    toast("Environment saved", "success");
    onClose();
  };

  return (
    <Modal
      title={existing ? "Edit environment" : "New environment"}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input autoFocus={!existing} value={name} onChange={(e) => setName(e.target.value)} placeholder="Development" />
        </Field>
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted">Variables</div>
          <KeyValueEditor rows={vars} onChange={setVars} keyPlaceholder="Variable" valuePlaceholder="Value" withSecret highlightVars={false} />
          <p className="text-xs text-muted">
            Use them anywhere in a request as <code>{"{{name}}"}</code>. Environment variables override collection variables.
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- collection ----------------

function CollectionModal({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace();
  const c = ws.collections.find((c) => c.id === id);
  const [section, setSection] = useState<"variables" | "auth" | "overview">("variables");
  const [name, setName] = useState(c?.name ?? "");
  const [description, setDescription] = useState(c?.description ?? "");
  const [vars, setVars] = useState<Variable[]>(c?.variables ?? []);
  const [auth, setAuth] = useState<Auth>(c?.auth ?? { type: "none" });

  if (!c) return null;

  const save = async () => {
    const { folders: _f, requests: _r, ...collection } = c;
    const saved = await attempt(() =>
      api.collections.update({
        ...collection,
        name,
        description,
        auth,
        variables: vars.filter((v) => v.key.trim() !== "" || v.value !== ""),
      }),
    );
    if (!saved) return;
    await ws.refreshCollections();
    toast("Collection saved", "success");
    onClose();
  };

  return (
    <Modal
      title={c.name}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <TabStrip
        className="-mx-4 -mt-4 mb-4"
        value={section}
        onChange={setSection}
        tabs={[
          { id: "variables", label: "Variables" },
          { id: "auth", label: "Authorization" },
          { id: "overview", label: "Overview" },
        ]}
      />
      {section === "variables" && (
        <div className="space-y-1.5">
          <KeyValueEditor rows={vars} onChange={setVars} keyPlaceholder="Variable" withSecret highlightVars={false} />
          <p className="text-xs text-muted">Collection variables are available to every request here. The active environment overrides them.</p>
        </div>
      )}
      {section === "auth" && (
        <div className="space-y-3">
          <p className="text-xs text-muted">Requests set to "Inherit from collection" use this auth.</p>
          <AuthEditor auth={auth} onChange={setAuth} allowInherit={false} />
        </div>
      )}
      {section === "overview" && (
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-border bg-elevated p-2.5 outline-none focus:border-accent"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}

// ---------------- settings ----------------

function SettingsModal({ onClose }: { onClose: () => void }) {
  const current = useWorkspace((s) => s.settings);
  const setSettings = useWorkspace((s) => s.setSettings);
  const [s, setS] = useState<Settings | null>(current);
  useEffect(() => setS(current), [current]);
  if (!s) return null;

  const save = async () => {
    const saved = await attempt(() => api.settings.save(s));
    if (!saved) return;
    setSettings(saved);
    toast("Settings saved", "success");
    onClose();
  };

  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Request timeout (ms)" hint="0 means no timeout.">
          <Input type="number" min={0} value={s.timeoutMs} onChange={(e) => setS({ ...s, timeoutMs: num(e.target.value) })} />
        </Field>
        <Field label="Max response size (MB)" hint="Larger bodies are truncated.">
          <Input
            type="number"
            min={1}
            value={Math.round(s.maxResponseBytes / 1024 / 1024)}
            onChange={(e) => setS({ ...s, maxResponseBytes: Math.max(1, num(e.target.value)) * 1024 * 1024 })}
          />
        </Field>
        <Field label="History entries to keep">
          <Input type="number" min={0} value={s.historyLimit} onChange={(e) => setS({ ...s, historyLimit: num(e.target.value) })} />
        </Field>
        <div className="flex flex-col items-start gap-2 pt-1">
          <Checkbox checked={s.followRedirects} onChange={(followRedirects) => setS({ ...s, followRedirects })} label="Follow redirects automatically" />
          <Checkbox checked={s.verifyTls} onChange={(verifyTls) => setS({ ...s, verifyTls })} label="Verify TLS certificates" />
          {!s.verifyTls && <p className="pl-6 text-xs text-amber-500">Certificate errors will be ignored. Only use this for local development servers.</p>}
        </div>
      </div>
    </Modal>
  );
}

// ---------------- code ----------------

const LANG_KEY = "courier.codeLanguage";

function CodeModal({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const ws = useWorkspace();
  const [lang, setLang] = useState<Language>(() => (storage.get(LANG_KEY) as Language) || "curl");
  const [resolveVars, setResolveVars] = useState(true);
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    if (!tab) return "";
    const collection = ws.collections.find((c) => c.id === tab.collectionId);
    const vars = resolveVars ? variableMap(collection?.variables, activeEnvironment(ws)?.variables) : new Map<string, string>();
    return generate(lang, resolveSpec(tab.spec, vars, collection?.auth));
  }, [tab, ws, lang, resolveVars]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Clipboard access was denied", "error");
    }
  };

  return (
    <Modal
      title="Code snippet"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-3">
        <Select
          value={lang}
          onChange={(e) => {
            setLang(e.target.value as Language);
            storage.set(LANG_KEY, e.target.value);
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
        <Checkbox checked={resolveVars} onChange={setResolveVars} label="Resolve variables" />
      </div>
      <div className="h-80 overflow-hidden rounded-md border border-border">
        <CodeEditor value={code} readOnly language="text" />
      </div>
    </Modal>
  );
}

// ---------------- dialogs & toasts ----------------

export function DialogHost() {
  const dialog = useUI((s) => s.dialog);
  const [value, setValue] = useState("");
  useEffect(() => {
    if (dialog?.kind === "prompt") setValue(dialog.initial);
  }, [dialog]);
  if (!dialog) return null;

  if (dialog.kind === "prompt") {
    const submit = () => dialog.resolve(value);
    return (
      <Modal
        title={dialog.title}
        onClose={() => dialog.resolve(null)}
        width="max-w-sm"
        footer={
          <>
            <Button onClick={() => dialog.resolve(null)}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!value.trim()}>
              {dialog.confirmText}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => (e.preventDefault(), value.trim() && submit())}>
          <Field label={dialog.label ?? "Name"}>
            <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
          </Field>
        </form>
      </Modal>
    );
  }

  return (
    <Modal
      title={dialog.title}
      onClose={() => dialog.resolve(false)}
      width="max-w-sm"
      footer={
        <>
          <Button onClick={() => dialog.resolve(false)}>Cancel</Button>
          <Button variant={dialog.danger ? "danger" : "primary"} onClick={() => dialog.resolve(true)} autoFocus>
            {dialog.confirmText}
          </Button>
        </>
      }
    >
      <p className="text-muted">{dialog.message}</p>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            "pointer-events-auto max-w-sm rounded-lg border px-3 py-2 shadow-lg",
            t.kind === "error" && "border-red-500/40 bg-red-950 text-red-100",
            t.kind === "success" && "border-emerald-500/40 bg-elevated",
            t.kind === "info" && "border-border bg-elevated",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
