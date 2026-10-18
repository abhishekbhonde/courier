import { create } from "zustand";
import { api } from "../api";
import type { CollectionTree, Environment, HistoryEntry, SavedRequest, Settings } from "../types";
import { storage } from "./storage";
import { useTabs } from "./tabs";

interface WorkspaceState {
  collections: CollectionTree[];
  environments: Environment[];
  history: HistoryEntry[];
  settings: Settings | null;
  activeEnvironmentId: string | null;
  loaded: boolean;
  loadError: string | null;

  load: () => Promise<void>;
  refreshCollections: () => Promise<void>;
  refreshEnvironments: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  setActiveEnvironment: (id: string | null) => void;
  setSettings: (s: Settings) => void;
}

const ENV_KEY = "courier.activeEnvironment";

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  collections: [],
  environments: [],
  history: [],
  settings: null,
  activeEnvironmentId: storage.get(ENV_KEY),
  loaded: false,
  loadError: null,

  load: async () => {
    try {
      const [collections, environments, history, settings] = await Promise.all([
        api.collections.list(),
        api.environments.list(),
        api.history.list(),
        api.settings.get(),
      ]);
      const active = get().activeEnvironmentId;
      set({
        collections,
        environments,
        history,
        settings,
        loaded: true,
        loadError: null,
        activeEnvironmentId: environments.some((e) => e.id === active) ? active : null,
      });
      useTabs.getState().reconcile(collections);
    } catch (err) {
      set({ loadError: (err as Error).message });
    }
  },

  refreshCollections: async () => {
    const collections = await api.collections.list();
    set({ collections });
    useTabs.getState().reconcile(collections);
  },

  refreshEnvironments: async () => {
    const environments = await api.environments.list();
    const active = get().activeEnvironmentId;
    set({ environments });
    if (active && !environments.some((e) => e.id === active)) get().setActiveEnvironment(null);
  },

  refreshHistory: async () => {
    set({ history: await api.history.list() });
  },

  setActiveEnvironment: (id) => {
    storage.set(ENV_KEY, id);
    set({ activeEnvironmentId: id });
  },

  setSettings: (settings) => set({ settings }),
}));

export function findRequest(collections: CollectionTree[], id: string): SavedRequest | undefined {
  for (const c of collections) {
    const r = c.requests.find((r) => r.id === id);
    if (r) return r;
  }
  return undefined;
}

export function activeEnvironment(s: Pick<WorkspaceState, "environments" | "activeEnvironmentId">) {
  return s.environments.find((e) => e.id === s.activeEnvironmentId);
}
