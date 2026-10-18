import { Eye, EyeOff, Trash2 } from "lucide-react";
import { VarInput } from "./VarInput";
import { Checkbox, IconButton, cx } from "./ui";

export interface Row {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
  secret?: boolean;
}

/**
 * Editable table of key/value rows. A trailing blank row turns into a real
 * row as soon as the user types into it.
 */
export function KeyValueEditor<T extends Row>({
  rows,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  withDescription = false,
  withSecret = false,
  highlightVars = true,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  withDescription?: boolean;
  withSecret?: boolean;
  highlightVars?: boolean;
}) {
  const update = (i: number, patch: Partial<Row>) => {
    if (i === rows.length) {
      onChange([...rows, { key: "", value: "", enabled: true, ...patch } as T]);
    } else {
      onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    }
  };
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const all: Row[] = [...rows, { key: "", value: "", enabled: true }];

  const cell = "h-8 border-r border-border";
  const plain = "h-full w-full bg-transparent px-2.5 font-mono text-[12.5px] outline-none placeholder:font-sans placeholder:text-muted/70";

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex border-b border-border bg-panel text-xs font-medium text-muted">
        <div className="w-9 shrink-0 border-r border-border" />
        <div className="flex-1 border-r border-border px-2.5 py-1.5">{keyPlaceholder}</div>
        <div className="flex-[1.4] border-r border-border px-2.5 py-1.5">{valuePlaceholder}</div>
        {withDescription && <div className="flex-1 border-r border-border px-2.5 py-1.5">Description</div>}
        <div className={cx("shrink-0", withSecret ? "w-16" : "w-9")} />
      </div>
      {all.map((row, i) => {
        const ghost = i === rows.length;
        return (
          <div key={i} className={cx("group flex border-b border-border last:border-b-0", !row.enabled && "opacity-50")}>
            <div className="flex w-9 shrink-0 items-center justify-center border-r border-border">
              {!ghost && <Checkbox checked={row.enabled} onChange={(enabled) => update(i, { enabled })} ariaLabel="Enabled" />}
            </div>
            <div className={cx(cell, "flex-1")}>
              {highlightVars ? (
                <VarInput value={row.key} onChange={(key) => update(i, { key })} placeholder={ghost ? "Add key" : ""} className="h-full" />
              ) : (
                <input className={plain} value={row.key} onChange={(e) => update(i, { key: e.target.value })} placeholder={ghost ? "Add key" : ""} spellCheck={false} />
              )}
            </div>
            <div className={cx(cell, "flex-[1.4]")}>
              {row.secret ? (
                <input type="password" className={plain} value={row.value} onChange={(e) => update(i, { value: e.target.value })} autoComplete="new-password" />
              ) : highlightVars ? (
                <VarInput value={row.value} onChange={(value) => update(i, { value })} placeholder={ghost ? "Value" : ""} className="h-full" />
              ) : (
                <input className={plain} value={row.value} onChange={(e) => update(i, { value: e.target.value })} placeholder={ghost ? "Value" : ""} spellCheck={false} />
              )}
            </div>
            {withDescription && (
              <div className={cx(cell, "flex-1")}>
                <input
                  className={cx(plain, "font-sans")}
                  value={row.description ?? ""}
                  onChange={(e) => update(i, { description: e.target.value })}
                  placeholder={ghost ? "Description" : ""}
                />
              </div>
            )}
            <div className={cx("flex shrink-0 items-center justify-center gap-0.5", withSecret ? "w-16" : "w-9")}>
              {!ghost && withSecret && (
                <IconButton label={row.secret ? "Show value" : "Mark as secret"} onClick={() => update(i, { secret: !row.secret })}>
                  {row.secret ? <EyeOff size={14} /> : <Eye size={14} />}
                </IconButton>
              )}
              {!ghost && (
                <IconButton label="Remove" onClick={() => remove(i)} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
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
