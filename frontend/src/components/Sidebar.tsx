import {
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FilePlus,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  History,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { dayLabel, methodClass, statusClass } from "../lib/format";
import * as actions from "../store/actions";
import { storage } from "../store/storage";
import { useTabs } from "../store/tabs";
import { attempt, confirm, useUI } from "../store/ui";
import { useWorkspace } from "../store/workspace";
import type { CollectionTree, Folder, HistoryEntry, SavedRequest } from "../types";
import { EmptyState, IconButton, Menu, cx, useMenu, type MenuItem } from "./ui";

type Panel = "collections" | "environments" | "history";

export function Sidebar() {
  const [panel, setPanel] = useState<Panel>(() => (storage.get("courier.panel") as Panel) || "collections");
  const choose = (p: Panel) => {
    setPanel(p);
    storage.set("courier.panel", p);
  };

  const items: { id: Panel; icon: ReactNode; label: string }[] = [
    { id: "collections", icon: <Layers size={18} />, label: "Collections" },
    { id: "environments", icon: <Braces size={18} />, label: "Environments" },
    { id: "history", icon: <History size={18} />, label: "History" },
  ];

  return (
    <div className="flex h-full min-w-0">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => choose(i.id)}
            title={i.label}
            aria-label={i.label}
            className={cx(
              "flex w-14 flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] transition-colors",
              panel === i.id ? "bg-hover text-fg" : "text-muted hover:text-fg",
            )}
          >
            {i.icon}
            {i.label === "Environments" ? "Envs" : i.label}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {panel === "collections" && <CollectionsPanel />}
        {panel === "environments" && <EnvironmentsPanel />}
        {panel === "history" && <HistoryPanel />}
      </div>
    </div>
  );
}

function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-border pr-2 pl-3">
      <span className="font-semibold">{title}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
      <Search size={13} className="shrink-0 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-6 w-full bg-transparent outline-none placeholder:text-muted/70"
      />
    </div>
  );
}

// ---------------- collections ----------------

const EXPANDED_KEY = "courier.expanded";

type DragItem = { kind: "request" | "folder"; id: string; collectionId: string };
const DRAG_MIME = "application/x-courier-item";
let dragging: DragItem | null = null;

function CollectionsPanel() {
  const collections = useWorkspace((s) => s.collections);
  const openModal = useUI((s) => s.openModal);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(storage.getJSON<string[]>(EXPANDED_KEY, [])));

  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      storage.setJSON(EXPANDED_KEY, [...next]);
      return next;
    });

  const q = filter.trim().toLowerCase();
  const matches = (r: SavedRequest) => !q || r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q);

  return (
    <>
      <PanelHeader title="Collections">
        <IconButton label="Import" onClick={() => openModal({ type: "import" })}>
          <Upload size={15} />
        </IconButton>
        <IconButton label="New collection" onClick={actions.createCollection}>
          <Plus size={16} />
        </IconButton>
      </PanelHeader>
      <SearchBox value={filter} onChange={setFilter} placeholder="Filter requests" />
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {collections.length === 0 ? (
          <EmptyState icon={<Layers size={26} />} title="No collections yet">
            Group related requests into a collection, or import one from Postman.
            <div className="mt-3 flex justify-center gap-2">
              <button className="text-accent hover:underline" onClick={actions.createCollection}>
                Create collection
              </button>
              <span>·</span>
              <button className="text-accent hover:underline" onClick={() => openModal({ type: "import" })}>
                Import
              </button>
            </div>
          </EmptyState>
        ) : (
          collections.map((c) => (
            <CollectionNode key={c.id} c={c} expanded={expanded} toggle={toggle} filter={q} matches={matches} />
          ))
        )}
      </div>
    </>
  );
}

interface NodeProps {
  c: CollectionTree;
  expanded: Set<string>;
  toggle: (id: string, open?: boolean) => void;
  filter: string;
  matches: (r: SavedRequest) => boolean;
}

/** Shared drop-target behavior for collection and folder rows. */
function useDropTarget(c: CollectionTree, folderId: string | null, onDropped: () => void) {
  const [over, setOver] = useState(false);
  const accepts = (d: DragItem | null) =>
    !!d && (d.kind === "request" || (d.collectionId === c.id && d.id !== folderId && !isAncestor(c, d.id, folderId)));
  return {
    over,
    handlers: {
      onDragOver: (e: React.DragEvent) => {
        if (!accepts(dragging)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const d = dragging;
        dragging = null;
        if (!d || !accepts(d)) return;
        if (d.kind === "request") {
          const r = useWorkspace.getState().collections.flatMap((x) => x.requests).find((r) => r.id === d.id);
          if (r) actions.moveRequest(r, c.id, folderId);
        } else {
          const f = c.folders.find((f) => f.id === d.id);
          if (f) actions.moveFolder(f, folderId);
        }
        onDropped();
      },
    },
  };
}

/** Whether folder `ancestorId` contains folder `id` (so dropping would create a cycle). */
function isAncestor(c: CollectionTree, ancestorId: string, id: string | null): boolean {
  for (let cur = id; cur; ) {
    if (cur === ancestorId) return true;
    cur = c.folders.find((f) => f.id === cur)?.parentId ?? null;
  }
  return false;
}

function hasMatch(c: CollectionTree, folderId: string | null, matches: (r: SavedRequest) => boolean): boolean {
  if (c.requests.some((r) => r.folderId === folderId && matches(r))) return true;
  return c.folders.some((f) => f.parentId === folderId && hasMatch(c, f.id, matches));
}

function CollectionNode({ c, expanded, toggle, filter, matches }: NodeProps) {
  const menu = useMenu();
  const openModal = useUI((s) => s.openModal);
  const drop = useDropTarget(c, null, () => toggle(c.id, true));
  if (filter && !hasMatch(c, null, matches)) return null;
  const open = !!filter || expanded.has(c.id);

  const items: MenuItem[] = [
    { label: "Add request", icon: <FilePlus size={14} />, onSelect: () => (toggle(c.id, true), actions.createRequestIn(c.id, null)) },
    { label: "Add folder", icon: <FolderPlus size={14} />, onSelect: () => (toggle(c.id, true), actions.createFolder(c.id, null)) },
    { label: "Edit variables & auth", icon: <Settings2 size={14} />, onSelect: () => openModal({ type: "collection", id: c.id }), separator: true },
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => actions.renameCollection(c.id) },
    { label: "Export (Postman v2.1)", icon: <Download size={14} />, onSelect: () => actions.exportCollection(c.id) },
    { label: "Delete", icon: <Trash2 size={14} />, onSelect: () => actions.deleteCollection(c.id), danger: true, separator: true },
  ];

  return (
    <div>
      <Row
        depth={0}
        onClick={() => toggle(c.id)}
        onContextMenu={menu.openFromEvent}
        dropOver={drop.over}
        {...drop.handlers}
        icon={open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        label={<span className="font-medium">{c.name}</span>}
        actions={
          <IconButton label="Collection actions" onClick={menu.openFromEvent} className="h-6 w-6">
            <MoreHorizontal size={14} />
          </IconButton>
        }
      />
      {menu.at && <Menu {...menu.at} items={items} onClose={menu.close} />}
      {open && (
        <Children c={c} folderId={null} depth={1} expanded={expanded} toggle={toggle} filter={filter} matches={matches} />
      )}
    </div>
  );
}

function Children(props: NodeProps & { folderId: string | null; depth: number }) {
  const { c, folderId, depth, matches } = props;
  const folders = c.folders.filter((f) => f.parentId === folderId);
  const requests = c.requests.filter((r) => r.folderId === folderId && matches(r));
  if (!folders.length && !requests.length && !props.filter) {
    return <div className="py-1 text-xs text-muted" style={{ paddingLeft: depth * 14 + 26 }}>Empty</div>;
  }
  return (
    <>
      {folders.map((f) => (
        <FolderNode key={f.id} {...props} folder={f} depth={depth} />
      ))}
      {requests.map((r) => (
        <RequestNode key={r.id} r={r} depth={depth} />
      ))}
    </>
  );
}

function FolderNode(props: NodeProps & { folder: Folder; depth: number }) {
  const { c, folder, depth, expanded, toggle, filter, matches } = props;
  const menu = useMenu();
  const drop = useDropTarget(c, folder.id, () => toggle(folder.id, true));
  if (filter && !hasMatch(c, folder.id, matches)) return null;
  const open = !!filter || expanded.has(folder.id);

  const items: MenuItem[] = [
    { label: "Add request", icon: <FilePlus size={14} />, onSelect: () => (toggle(folder.id, true), actions.createRequestIn(c.id, folder.id)) },
    { label: "Add folder", icon: <FolderPlus size={14} />, onSelect: () => (toggle(folder.id, true), actions.createFolder(c.id, folder.id)) },
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => actions.renameFolder(folder), separator: true },
    { label: "Delete", icon: <Trash2 size={14} />, onSelect: () => actions.deleteFolder(folder), danger: true },
  ];

  return (
    <div>
      <Row
        depth={depth}
        onClick={() => toggle(folder.id)}
        onContextMenu={menu.openFromEvent}
        draggable
        onDragStart={(e) => {
          dragging = { kind: "folder", id: folder.id, collectionId: c.id };
          e.dataTransfer.setData(DRAG_MIME, folder.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        dropOver={drop.over}
        {...drop.handlers}
        icon={open ? <FolderOpen size={14} className="text-muted" /> : <FolderIcon size={14} className="text-muted" />}
        label={folder.name}
        actions={
          <IconButton label="Folder actions" onClick={menu.openFromEvent} className="h-6 w-6">
            <MoreHorizontal size={14} />
          </IconButton>
        }
      />
      {menu.at && <Menu {...menu.at} items={items} onClose={menu.close} />}
      {open && <Children {...props} folderId={folder.id} depth={depth + 1} />}
    </div>
  );
}

function RequestNode({ r, depth }: { r: SavedRequest; depth: number }) {
  const menu = useMenu();
  const openRequest = useTabs((s) => s.openRequest);
  const active = useTabs((s) => s.tabs.find((t) => t.id === s.activeId)?.requestId === r.id);

  const items: MenuItem[] = [
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => actions.renameRequest(r) },
    { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => actions.duplicateRequest(r) },
    { label: "Delete", icon: <Trash2 size={14} />, onSelect: () => actions.deleteRequest(r), danger: true, separator: true },
  ];

  return (
    <>
      <Row
        depth={depth}
        active={active}
        onClick={() => openRequest(r)}
        onContextMenu={menu.openFromEvent}
        draggable
        onDragStart={(e) => {
          dragging = { kind: "request", id: r.id, collectionId: r.collectionId };
          e.dataTransfer.setData(DRAG_MIME, r.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        icon={<MethodBadge method={r.method} />}
        label={r.name}
        title={r.url}
        actions={
          <IconButton label="Request actions" onClick={menu.openFromEvent} className="h-6 w-6">
            <MoreHorizontal size={14} />
          </IconButton>
        }
      />
      {menu.at && <Menu {...menu.at} items={items} onClose={menu.close} />}
    </>
  );
}

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  const short: Record<string, string> = { DELETE: "DEL", OPTIONS: "OPT", PATCH: "PTCH" };
  return (
    <span className={cx("w-9 shrink-0 text-right font-mono text-[10px] font-bold", methodClass(method), className)}>
      {short[method] ?? method}
    </span>
  );
}

function Row({
  depth,
  icon,
  label,
  actions: rowActions,
  active,
  dropOver,
  title,
  ...rest
}: {
  depth: number;
  icon: ReactNode;
  label: ReactNode;
  actions?: ReactNode;
  active?: boolean;
  dropOver?: boolean;
  title?: string;
} & React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }) {
  return (
    <div
      role="treeitem"
      title={title}
      className={cx(
        "group mx-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1 select-none",
        active ? "bg-hover text-fg" : "hover:bg-hover/70",
        dropOver && "ring-1 ring-accent ring-inset",
      )}
      style={{ paddingLeft: depth * 14 + 6 }}
      {...rest}
    >
      <span className="flex shrink-0 items-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="hidden group-hover:flex">{rowActions}</span>
    </div>
  );
}

// ---------------- environments ----------------

function EnvironmentsPanel() {
  const environments = useWorkspace((s) => s.environments);
  const activeId = useWorkspace((s) => s.activeEnvironmentId);
  const setActive = useWorkspace((s) => s.setActiveEnvironment);
  const openModal = useUI((s) => s.openModal);

  return (
    <>
      <PanelHeader title="Environments">
        <IconButton label="Import" onClick={() => openModal({ type: "import" })}>
          <Upload size={15} />
        </IconButton>
        <IconButton label="New environment" onClick={() => openModal({ type: "environment", id: null })}>
          <Plus size={16} />
        </IconButton>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {environments.length === 0 ? (
          <EmptyState icon={<Braces size={26} />} title="No environments">
            Environments hold variables like <code>{"{{baseUrl}}"}</code> so one request works against dev, staging and prod.
            <div className="mt-3">
              <button className="text-accent hover:underline" onClick={() => openModal({ type: "environment", id: null })}>
                Create environment
              </button>
            </div>
          </EmptyState>
        ) : (
          environments.map((e) => (
            <div
              key={e.id}
              className="group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-hover/70"
              onClick={() => openModal({ type: "environment", id: e.id })}
            >
              <button
                type="button"
                title={activeId === e.id ? "Active environment" : "Set active"}
                aria-label={activeId === e.id ? "Active environment" : "Set active"}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setActive(activeId === e.id ? null : e.id);
                }}
                className={cx(
                  "h-3 w-3 shrink-0 rounded-full border",
                  activeId === e.id ? "border-emerald-500 bg-emerald-500" : "border-muted",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span className="text-xs text-muted">{e.variables.length} vars</span>
              <IconButton
                label="Delete environment"
                className="hidden h-6 w-6 group-hover:flex"
                onClick={(ev) => {
                  ev.stopPropagation();
                  actions.deleteEnvironment(e.id);
                }}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ---------------- history ----------------

function HistoryPanel() {
  const history = useWorkspace((s) => s.history);
  const refresh = useWorkspace((s) => s.refreshHistory);
  const newTab = useTabs((s) => s.newTab);
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out: { label: string; items: HistoryEntry[] }[] = [];
    for (const h of history) {
      if (q && !h.request.url.toLowerCase().includes(q) && !h.request.method.toLowerCase().includes(q)) continue;
      const label = dayLabel(h.createdAt);
      if (out.at(-1)?.label !== label) out.push({ label, items: [] });
      out.at(-1)!.items.push(h);
    }
    return out;
  }, [history, filter]);

  const clear = async () => {
    const ok = await confirm({ title: "Clear history", message: "Remove all history entries?", confirmText: "Clear", danger: true });
    if (!ok) return;
    await attempt(() => api.history.clear());
    await refresh();
  };

  return (
    <>
      <PanelHeader title="History">
        <IconButton label="Clear history" onClick={clear} disabled={!history.length}>
          <Trash2 size={15} />
        </IconButton>
      </PanelHeader>
      <SearchBox value={filter} onChange={setFilter} placeholder="Filter history" />
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {history.length === 0 && (
          <EmptyState icon={<History size={26} />} title="No history yet">
            Requests you send will appear here.
          </EmptyState>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="sticky top-0 bg-panel px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
              {g.label}
            </div>
            {g.items.map((h) => (
              <div
                key={h.id}
                onClick={() => newTab({ name: h.request.url || "History request", spec: h.request })}
                title={`${h.request.method} ${h.request.url}\n${new Date(h.createdAt).toLocaleString()}`}
                className="group mx-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 hover:bg-hover/70"
              >
                <MethodBadge method={h.request.method} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{h.request.url}</span>
                <span className={cx("text-[11px] group-hover:hidden", h.error && !h.status ? "text-red-500" : statusClass(h.status))}>
                  {h.status || "ERR"}
                </span>
                <IconButton
                  label="Remove from history"
                  className="hidden h-6 w-6 group-hover:flex"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await attempt(() => api.history.remove(h.id));
                    await refresh();
                  }}
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
