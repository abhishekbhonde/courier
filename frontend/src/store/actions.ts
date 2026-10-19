// Cross-store actions: sending and saving requests, and sidebar CRUD.
import { api } from "../api";
import { blankSpec, type Folder, type SavedRequest } from "../types";
import { isDirty, useTabs } from "./tabs";
import { attempt, confirm, prompt, toast, useUI } from "./ui";
import { findRequest, useWorkspace } from "./workspace";

const controllers = new Map<string, AbortController>();

const tabById = (id: string) => useTabs.getState().tabs.find((t) => t.id === id);

export async function sendTab(id: string) {
  const tab = tabById(id);
  if (!tab || tab.loading) return;
  if (!tab.spec.url.trim()) {
    toast("Enter a URL first");
    return;
  }
  const { patch } = useTabs.getState();
  const ctrl = new AbortController();
  controllers.set(id, ctrl);
  patch(id, { loading: true, error: undefined });
  try {
    const response = await api.execute(
      {
        request: tab.spec,
        environmentId: useWorkspace.getState().activeEnvironmentId,
        collectionId: tab.collectionId,
      },
      ctrl.signal,
    );
    patch(id, { response, loading: false });
    useWorkspace.getState().refreshHistory().catch(() => {});
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    patch(id, { loading: false, error: aborted ? undefined : (err as Error).message });
  } finally {
    controllers.delete(id);
  }
}

export function cancelTab(id: string) {
  controllers.get(id)?.abort();
}

/** Saves a tab; unsaved tabs open the "save as" dialog. */
export async function saveTab(id: string) {
  const tab = tabById(id);
  if (!tab) return;
  if (!tab.requestId) {
    useUI.getState().openModal({ type: "save", tabId: id });
    return;
  }
  const existing = findRequest(useWorkspace.getState().collections, tab.requestId);
  if (!existing) return;
  const saved = await attempt(() => api.requests.update({ ...existing, ...tab.spec, name: tab.name }));
  if (!saved) return;
  useTabs.getState().markSaved(id, saved);
  await useWorkspace.getState().refreshCollections();
  toast("Saved", "success");
}

export async function closeTabWithConfirm(id: string) {
  const tab = tabById(id);
  if (!tab) return;
  if (isDirty(tab) && (tab.requestId || tab.spec.url)) {
    const ok = await confirm({
      title: "Discard changes?",
      message: `"${tab.name}" has unsaved changes.`,
      confirmText: "Discard",
      danger: true,
    });
    if (!ok) return;
  }
  cancelTab(id);
  useTabs.getState().closeTab(id);
}

// ---- collections, folders, requests ----

const refresh = () => useWorkspace.getState().refreshCollections();

export async function createCollection() {
  const name = await prompt({ title: "New collection", label: "Name", confirmText: "Create" });
  if (!name?.trim()) return;
  if (await attempt(() => api.collections.create({ name }))) await refresh();
}

export async function renameCollection(id: string) {
  const c = useWorkspace.getState().collections.find((c) => c.id === id);
  if (!c) return;
  const name = await prompt({ title: "Rename collection", initial: c.name, confirmText: "Rename" });
  if (!name?.trim() || name === c.name) return;
  const { folders: _f, requests: _r, ...collection } = c;
  if (await attempt(() => api.collections.update({ ...collection, name }))) await refresh();
}

export async function deleteCollection(id: string) {
  const c = useWorkspace.getState().collections.find((c) => c.id === id);
  if (!c) return;
  const ok = await confirm({
    title: "Delete collection",
    message: `Delete "${c.name}" and its ${c.requests.length} request(s)? This cannot be undone.`,
    confirmText: "Delete",
    danger: true,
  });
  if (!ok) return;
  await attempt(() => api.collections.remove(id));
  await refresh();
}

export async function createFolder(collectionId: string, parentId: string | null) {
  const name = await prompt({ title: "New folder", label: "Name", confirmText: "Create" });
  if (!name?.trim()) return;
  if (await attempt(() => api.folders.create({ collectionId, parentId, name }))) await refresh();
}

export async function renameFolder(f: Folder) {
  const name = await prompt({ title: "Rename folder", initial: f.name, confirmText: "Rename" });
  if (!name?.trim() || name === f.name) return;
  if (await attempt(() => api.folders.update({ ...f, name }))) await refresh();
}

export async function deleteFolder(f: Folder) {
  const ok = await confirm({
    title: "Delete folder",
    message: `Delete "${f.name}" and everything inside it?`,
    confirmText: "Delete",
    danger: true,
  });
  if (!ok) return;
  await attempt(() => api.folders.remove(f.id));
  await refresh();
}

export async function moveFolder(f: Folder, parentId: string | null) {
  if (f.parentId === parentId || f.id === parentId) return;
  if (await attempt(() => api.folders.update({ ...f, parentId }))) await refresh();
}

export async function createRequestIn(collectionId: string, folderId: string | null) {
  const name = await prompt({ title: "New request", label: "Name", initial: "New request", confirmText: "Create" });
  if (!name?.trim()) return;
  const r = await attempt(() => api.requests.create({ ...blankSpec(), collectionId, folderId, name }));
  if (!r) return;
  await refresh();
  useTabs.getState().openRequest(r);
}

export async function renameRequest(r: SavedRequest) {
  const name = await prompt({ title: "Rename request", initial: r.name, confirmText: "Rename" });
  if (!name?.trim() || name === r.name) return;
  if (await attempt(() => api.requests.update({ ...r, name }))) await refresh();
}

export async function duplicateRequest(r: SavedRequest) {
  const copy = await attempt(() => api.requests.duplicate(r.id));
  if (!copy) return;
  await refresh();
  useTabs.getState().openRequest(copy);
}

export async function deleteRequest(r: SavedRequest) {
  const ok = await confirm({ title: "Delete request", message: `Delete "${r.name}"?`, confirmText: "Delete", danger: true });
  if (!ok) return;
  await attempt(() => api.requests.remove(r.id));
  await refresh();
}

export async function moveRequest(r: SavedRequest, collectionId: string, folderId: string | null) {
  if (r.collectionId === collectionId && r.folderId === folderId) return;
  if (await attempt(() => api.requests.update({ ...r, collectionId, folderId }))) await refresh();
}

export async function exportCollection(id: string) {
  // Fetched rather than linked so the access token header is sent.
  const file = await attempt(() => api.collections.export(id));
  if (!file) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file.blob);
  a.download = file.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

// ---- environments ----

export async function deleteEnvironment(id: string) {
  const e = useWorkspace.getState().environments.find((e) => e.id === id);
  if (!e) return;
  const ok = await confirm({ title: "Delete environment", message: `Delete "${e.name}"?`, confirmText: "Delete", danger: true });
  if (!ok) return;
  await attempt(() => api.environments.remove(id));
  await useWorkspace.getState().refreshEnvironments();
}
