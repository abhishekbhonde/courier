import { Moon, Plus, Send, Settings, Sun, Upload } from "lucide-react";
import { useEffect, useMemo } from "react";
import { DialogHost, ModalHost, Toasts } from "./components/Modals";
import { RequestEditor } from "./components/RequestEditor";
import { ResponseViewer } from "./components/ResponseViewer";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { VariablesContext } from "./components/VarInput";
import { Button, IconButton, Kbd, Select, Splitter, modKey, useResizable } from "./components/ui";
import { variableMap } from "./lib/vars";
import { saveTab, sendTab } from "./store/actions";
import { useTabs, type Tab } from "./store/tabs";
import { useTheme } from "./store/theme";
import { useUI } from "./store/ui";
import { activeEnvironment, useWorkspace } from "./store/workspace";

export default function App() {
  const loaded = useWorkspace((s) => s.loaded);
  const loadError = useWorkspace((s) => s.loadError);
  const load = useWorkspace((s) => s.load);
  const sidebar = useResizable("courier.sidebarWidth", 300, 220, 560, "x");

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const id = useTabs.getState().activeId;
      if (e.key === "Enter" && id) {
        e.preventDefault();
        sendTab(id);
      } else if (e.key.toLowerCase() === "s" && id) {
        e.preventDefault();
        saveTab(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loadError && !loaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="text-base font-semibold">Can't connect to the Courier server</div>
        <div className="max-w-md text-muted">{loadError}</div>
        <Button variant="primary" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <aside style={{ width: sidebar.size }} className="shrink-0 bg-panel">
          <Sidebar />
        </aside>
        <Splitter axis="x" onMouseDown={sidebar.onMouseDown} />
        <main className="flex min-w-0 flex-1 flex-col">
          <TabBar />
          <Workspace />
        </main>
      </div>
      <ModalHost />
      <DialogHost />
      <Toasts />
    </div>
  );
}

function TopBar() {
  const environments = useWorkspace((s) => s.environments);
  const activeId = useWorkspace((s) => s.activeEnvironmentId);
  const setActive = useWorkspace((s) => s.setActiveEnvironment);
  const openModal = useUI((s) => s.openModal);
  const { theme, toggle } = useTheme();

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-panel px-3">
      <div className="flex items-center gap-2 font-semibold">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white">
          <Send size={13} />
        </div>
        Courier
      </div>
      <div className="flex-1" />
      <Button variant="ghost" className="h-8" onClick={() => openModal({ type: "import" })}>
        <Upload size={14} /> Import
      </Button>
      <Select
        value={activeId ?? ""}
        onChange={(e) => {
          if (e.target.value === "__manage__") openModal({ type: "environment", id: activeId });
          else if (e.target.value === "__new__") openModal({ type: "environment", id: null });
          else setActive(e.target.value || null);
        }}
        className="w-52"
        aria-label="Active environment"
      >
        <option value="">No environment</option>
        {environments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
        <option disabled>──────────</option>
        {activeId && <option value="__manage__">Edit current environment…</option>}
        <option value="__new__">New environment…</option>
      </Select>
      <IconButton label={theme === "dark" ? "Light theme" : "Dark theme"} onClick={toggle}>
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </IconButton>
      <IconButton label="Settings" onClick={() => openModal({ type: "settings" })}>
        <Settings size={16} />
      </IconButton>
    </header>
  );
}

function Workspace() {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId));
  if (!tab) return <Welcome />;
  return <TabView key={tab.id} tab={tab} />;
}

function TabView({ tab }: { tab: Tab }) {
  const split = useResizable("courier.requestHeight", 340, 160, 1200, "y");
  const collections = useWorkspace((s) => s.collections);
  const environments = useWorkspace((s) => s.environments);
  const activeEnvironmentId = useWorkspace((s) => s.activeEnvironmentId);

  const vars = useMemo(() => {
    const c = collections.find((c) => c.id === tab.collectionId);
    return variableMap(c?.variables, activeEnvironment({ environments, activeEnvironmentId })?.variables);
  }, [collections, environments, activeEnvironmentId, tab.collectionId]);

  return (
    <VariablesContext.Provider value={vars}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div style={{ height: split.size }} className="min-h-0 shrink-0">
          <RequestEditor tab={tab} />
        </div>
        <Splitter axis="y" onMouseDown={split.onMouseDown} />
        <div className="min-h-0 flex-1">
          <ResponseViewer tab={tab} />
        </div>
      </div>
    </VariablesContext.Provider>
  );
}

function Welcome() {
  const newTab = useTabs((s) => s.newTab);
  const openModal = useUI((s) => s.openModal);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white">
        <Send size={22} />
      </div>
      <div>
        <div className="text-base font-semibold">Welcome to Courier</div>
        <div className="mt-1 text-muted">Build, send and organize HTTP requests.</div>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => newTab()}>
          <Plus size={14} /> New request
        </Button>
        <Button onClick={() => openModal({ type: "import" })}>
          <Upload size={14} /> Import
        </Button>
      </div>
      <div className="space-y-1 text-xs text-muted">
        <div>
          <Kbd>{modKey}</Kbd> <Kbd>↵</Kbd> send · <Kbd>{modKey}</Kbd> <Kbd>S</Kbd> save
        </div>
        <div>Paste a cURL command into the URL bar to import it.</div>
      </div>
    </div>
  );
}
