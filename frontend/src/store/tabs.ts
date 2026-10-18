import { create } from "zustand";
import { blankSpec, type CollectionTree, type ExecResult, type RequestSpec, type SavedRequest } from "../types";
import { storage } from "./storage";

export interface Tab {
  id: string;
  name: string;
  /** The saved request this tab edits, if any. */
  requestId: string | null;
  collectionId: string | null;
  spec: RequestSpec;
  /** Serialized spec as last saved/opened; the tab is dirty when spec differs. */
  baseline: string;
  response?: ExecResult;
  loading: boolean;
  error?: string;
}

export const serialize = (s: RequestSpec) => JSON.stringify(s);
export const isDirty = (t: Tab) => serialize(t.spec) !== t.baseline;

interface TabsState {
  tabs: Tab[];
  activeId: string | null;

  newTab: (init?: { name?: string; spec?: RequestSpec; collectionId?: string | null }) => string;
  openRequest: (r: SavedRequest) => void;
  closeTab: (id: string) => void;
  closeOthers: (id: string) => void;
  setActive: (id: string) => void;
  updateSpec: (id: string, fn: (s: RequestSpec) => RequestSpec) => void;
  patch: (id: string, p: Partial<Tab>) => void;
  markSaved: (id: string, r: SavedRequest) => void;
  reconcile: (collections: CollectionTree[]) => void;
}

const TABS_KEY = "courier.tabs";

type Persisted = { tabs: Omit<Tab, "response" | "loading" | "error">[]; activeId: string | null };

function restore(): Pick<TabsState, "tabs" | "activeId"> {
  const p = storage.getJSON<Persisted>(TABS_KEY, { tabs: [], activeId: null });
  const tabs = (p.tabs ?? []).map((t) => ({ ...t, loading: false }));
  return { tabs, activeId: tabs.some((t) => t.id === p.activeId) ? p.activeId : (tabs[0]?.id ?? null) };
}

const newId = () => crypto.randomUUID();

function makeTab(init: { name?: string; spec?: RequestSpec; collectionId?: string | null } = {}): Tab {
  const spec = init.spec ?? blankSpec();
  return {
    id: newId(),
    name: init.name ?? "Untitled request",
    requestId: null,
    collectionId: init.collectionId ?? null,
    spec,
    baseline: serialize(spec),
    loading: false,
  };
}

/** A blank, untouched tab that can be replaced when opening something else. */
const isPristine = (t: Tab) => !t.requestId && !t.response && t.spec.url === "" && !isDirty(t);

export const useTabs = create<TabsState>((set, get) => ({
  ...restore(),

  newTab: (init) => {
    const tab = makeTab(init);
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
    return tab.id;
  },

  openRequest: (r) => {
    const { tabs, activeId } = get();
    const existing = tabs.find((t) => t.requestId === r.id);
    if (existing) {
      set({ activeId: existing.id });
      return;
    }
    const { id: _id, collectionId, name, folderId: _f, sort: _s, createdAt: _c, updatedAt: _u, ...rest } = r;
    const spec: RequestSpec = rest;
    const tab: Tab = { ...makeTab({ name, spec, collectionId }), requestId: r.id };
    const active = tabs.find((t) => t.id === activeId);
    if (active && isPristine(active)) {
      set({ tabs: tabs.map((t) => (t.id === active.id ? tab : t)), activeId: tab.id });
    } else {
      set({ tabs: [...tabs, tab], activeId: tab.id });
    }
  },

  closeTab: (id) => {
    const { tabs, activeId } = get();
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const next = tabs.filter((t) => t.id !== id);
    let nextActive = activeId;
    if (activeId === id) nextActive = next[Math.min(i, next.length - 1)]?.id ?? null;
    set({ tabs: next, activeId: nextActive });
  },

  closeOthers: (id) => set((s) => ({ tabs: s.tabs.filter((t) => t.id === id), activeId: id })),

  setActive: (id) => set({ activeId: id }),

  updateSpec: (id, fn) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, spec: fn(t.spec) } : t)) })),

  patch: (id, p) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...p } : t)) })),

  markSaved: (id, r) =>
    get().patch(id, {
      requestId: r.id,
      collectionId: r.collectionId,
      name: r.name,
      baseline: serialize(get().tabs.find((t) => t.id === id)!.spec),
    }),

  // Keeps tabs consistent after collections change: renamed requests are
  // renamed, deleted ones become unsaved drafts.
  reconcile: (collections) => {
    const byId = new Map<string, SavedRequest>();
    for (const c of collections) for (const r of c.requests) byId.set(r.id, r);
    const collectionIds = new Set(collections.map((c) => c.id));
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.requestId) {
          const r = byId.get(t.requestId);
          if (r) return r.name === t.name && r.collectionId === t.collectionId ? t : { ...t, name: r.name, collectionId: r.collectionId };
          return { ...t, requestId: null, collectionId: null, baseline: "" };
        }
        if (t.collectionId && !collectionIds.has(t.collectionId)) return { ...t, collectionId: null };
        return t;
      }),
    }));
  },
}));

// Persist tabs (minus responses) whenever they change, debounced.
let timer: ReturnType<typeof setTimeout> | undefined;
useTabs.subscribe((s) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const persisted: Persisted = {
      activeId: s.activeId,
      tabs: s.tabs.map(({ response: _r, loading: _l, error: _e, ...t }) => t),
    };
    let json = JSON.stringify(persisted);
    if (json.length > 2_000_000) {
      // Attached files can be large; drop them rather than fail to persist.
      persisted.tabs = persisted.tabs.map((t) => ({
        ...t,
        spec: { ...t.spec, body: { ...t.spec.body, formdata: t.spec.body.formdata?.map((f) => ({ ...f, fileContent: undefined })) } },
      }));
      json = JSON.stringify(persisted);
    }
    storage.set(TABS_KEY, json);
  }, 300);
});
