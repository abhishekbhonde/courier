import { Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { closeTabWithConfirm } from "../store/actions";
import { isDirty, useTabs, type Tab } from "../store/tabs";
import { MethodBadge } from "./Sidebar";
import { IconButton, Menu, cx, useMenu } from "./ui";

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const newTab = useTabs((s) => s.newTab);
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the active tab visible.
  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>(`[data-tab="${activeId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-border bg-panel">
      <div
        ref={scroller}
        className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]"
        onWheel={(e) => {
          if (scroller.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) scroller.current.scrollLeft += e.deltaY;
        }}
      >
        {tabs.map((t) => (
          <TabItem key={t.id} tab={t} active={t.id === activeId} />
        ))}
      </div>
      <div className="flex items-center px-1">
        <IconButton label="New request tab" onClick={() => newTab()}>
          <Plus size={16} />
        </IconButton>
      </div>
    </div>
  );
}

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const setActive = useTabs((s) => s.setActive);
  const closeOthers = useTabs((s) => s.closeOthers);
  const newTab = useTabs((s) => s.newTab);
  const menu = useMenu();
  const dirty = isDirty(tab);

  return (
    <>
      <div
        data-tab={tab.id}
        onClick={() => setActive(tab.id)}
        onAuxClick={(e) => e.button === 1 && closeTabWithConfirm(tab.id)}
        onContextMenu={menu.openFromEvent}
        title={tab.spec.url || tab.name}
        className={cx(
          "group relative flex max-w-56 min-w-32 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border pr-1.5 pl-2 select-none",
          active ? "bg-bg text-fg" : "text-muted hover:bg-hover/60",
        )}
      >
        {active && <div className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
        <MethodBadge method={tab.spec.method} className="w-auto" />
        <span className={cx("min-w-0 flex-1 truncate", !tab.requestId && "italic")}>{tab.name}</span>
        <button
          type="button"
          aria-label="Close tab"
          onClick={(e) => {
            e.stopPropagation();
            closeTabWithConfirm(tab.id);
          }}
          className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-hover"
        >
          {dirty && tab.requestId && <span className="absolute h-2 w-2 rounded-full bg-accent group-hover:hidden" />}
          <X size={12} className={cx(dirty && tab.requestId ? "hidden group-hover:block" : "opacity-0 group-hover:opacity-100", active && !dirty && "opacity-100")} />
        </button>
      </div>
      {menu.at && (
        <Menu
          {...menu.at}
          onClose={menu.close}
          items={[
            { label: "Duplicate tab", onSelect: () => newTab({ name: `${tab.name} (copy)`, spec: structuredClone(tab.spec), collectionId: tab.collectionId }) },
            { label: "Close", onSelect: () => closeTabWithConfirm(tab.id), separator: true },
            { label: "Close other tabs", onSelect: () => closeOthers(tab.id) },
          ]}
        />
      )}
    </>
  );
}
