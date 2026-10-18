import { Paperclip, Trash2, Wand2 } from "lucide-react";
import { useRef } from "react";
import { bytesToBase64, formatBytes, prettyJson } from "../lib/format";
import { toast } from "../store/ui";
import type { Body, BodyMode, FormField } from "../types";
import { CodeEditor } from "./CodeEditor";
import { KeyValueEditor } from "./KeyValueEditor";
import { VarInput } from "./VarInput";
import { Button, Checkbox, IconButton, Select, cx } from "./ui";

const MODES: { id: BodyMode; label: string }[] = [
  { id: "none", label: "None" },
  { id: "json", label: "JSON" },
  { id: "raw", label: "Raw" },
  { id: "urlencoded", label: "x-www-form-urlencoded" },
  { id: "formdata", label: "form-data" },
];

const RAW_TYPES = [
  { value: "text/plain", label: "Text" },
  { value: "application/xml", label: "XML" },
  { value: "text/html", label: "HTML" },
  { value: "application/javascript", label: "JavaScript" },
  { value: "application/graphql", label: "GraphQL" },
];

export function BodyEditor({ body, onChange }: { body: Body; onChange: (b: Body) => void }) {
  const set = (patch: Partial<Body>) => onChange({ ...body, ...patch });

  const beautify = () => {
    const pretty = prettyJson(body.raw ?? "");
    if (pretty === body.raw) {
      try {
        JSON.parse(body.raw ?? "");
      } catch (e) {
        toast(`Invalid JSON: ${(e as Error).message}`, "error");
      }
      return;
    }
    set({ raw: pretty });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {MODES.map((m) => (
          <label key={m.id} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="body-mode"
              checked={body.mode === m.id}
              onChange={() => set({ mode: m.id })}
              className="accent-[var(--accent)]"
            />
            <span className={cx(body.mode === m.id ? "text-fg" : "text-muted")}>{m.label}</span>
          </label>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {body.mode === "raw" && (
            <Select value={body.contentType || "text/plain"} onChange={(e) => set({ contentType: e.target.value })} className="h-7 text-xs">
              {RAW_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
          {body.mode === "json" && (
            <Button variant="ghost" className="h-7 text-xs" onClick={beautify}>
              <Wand2 size={13} /> Beautify
            </Button>
          )}
        </div>
      </div>

      {body.mode === "none" && <p className="text-xs text-muted">This request does not have a body.</p>}

      {(body.mode === "json" || body.mode === "raw") && (
        <div className="min-h-40 flex-1 overflow-hidden rounded-md border border-border">
          <CodeEditor
            value={body.raw ?? ""}
            onChange={(raw) => set({ raw })}
            language={body.mode === "json" ? "json" : body.contentType?.includes("xml") ? "xml" : body.contentType?.includes("html") ? "html" : "text"}
            placeholder={body.mode === "json" ? '{\n  "key": "{{value}}"\n}' : ""}
          />
        </div>
      )}

      {body.mode === "urlencoded" && (
        <KeyValueEditor rows={body.urlencoded ?? []} onChange={(urlencoded) => set({ urlencoded })} withDescription />
      )}

      {body.mode === "formdata" && <FormDataEditor fields={body.formdata ?? []} onChange={(formdata) => set({ formdata })} />}
    </div>
  );
}

const MAX_FILE = 25 * 1024 * 1024;

function FormDataEditor({ fields, onChange }: { fields: FormField[]; onChange: (f: FormField[]) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const pickingFor = useRef(0);
  const all: FormField[] = [...fields, { key: "", value: "", enabled: true, type: "text" }];

  const update = (i: number, patch: Partial<FormField>) => {
    if (i === fields.length) onChange([...fields, { key: "", value: "", enabled: true, type: "text", ...patch }]);
    else onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE) {
      toast(`Files are limited to ${formatBytes(MAX_FILE)}`, "error");
      return;
    }
    const content = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    update(pickingFor.current, {
      type: "file",
      fileName: file.name,
      fileContent: content,
      contentType: file.type || "application/octet-stream",
    });
  };

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex border-b border-border bg-panel text-xs font-medium text-muted">
        <div className="w-9 shrink-0 border-r border-border" />
        <div className="flex-1 border-r border-border px-2.5 py-1.5">Key</div>
        <div className="w-20 shrink-0 border-r border-border px-2.5 py-1.5">Type</div>
        <div className="flex-[1.4] border-r border-border px-2.5 py-1.5">Value</div>
        <div className="w-9 shrink-0" />
      </div>
      {all.map((f, i) => {
        const ghost = i === fields.length;
        return (
          <div key={i} className={cx("group flex h-8 border-b border-border last:border-b-0", !f.enabled && "opacity-50")}>
            <div className="flex w-9 shrink-0 items-center justify-center border-r border-border">
              {!ghost && <Checkbox checked={f.enabled} onChange={(enabled) => update(i, { enabled })} ariaLabel="Enabled" />}
            </div>
            <div className="flex-1 border-r border-border">
              <VarInput value={f.key} onChange={(key) => update(i, { key })} placeholder={ghost ? "Add key" : ""} className="h-full" />
            </div>
            <div className="w-20 shrink-0 border-r border-border">
              <select
                value={f.type}
                onChange={(e) => update(i, { type: e.target.value as FormField["type"] })}
                className="h-full w-full bg-transparent px-1.5 text-xs outline-none"
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
            </div>
            <div className="flex min-w-0 flex-[1.4] items-center border-r border-border">
              {f.type === "file" ? (
                <button
                  type="button"
                  onClick={() => {
                    pickingFor.current = i;
                    fileInput.current?.click();
                  }}
                  className="flex h-full w-full min-w-0 items-center gap-1.5 px-2.5 text-left hover:bg-hover"
                >
                  <Paperclip size={13} className="shrink-0 text-muted" />
                  {f.fileName ? (
                    <span className="truncate">
                      {f.fileName}
                      {!f.fileContent && <span className="ml-2 text-xs text-orange-500">file missing, select again</span>}
                    </span>
                  ) : (
                    <span className="text-muted">Select file…</span>
                  )}
                </button>
              ) : (
                <VarInput value={f.value} onChange={(value) => update(i, { value })} placeholder={ghost ? "Value" : ""} className="h-full w-full" />
              )}
            </div>
            <div className="flex w-9 shrink-0 items-center justify-center">
              {!ghost && (
                <IconButton
                  label="Remove"
                  onClick={() => onChange(fields.filter((_, j) => j !== i))}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 size={14} />
                </IconButton>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
