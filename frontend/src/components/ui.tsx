import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { storage } from "../store/storage";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "bg-elevated border border-border hover:bg-hover",
  ghost: "hover:bg-hover",
  danger: "bg-red-600 text-white hover:bg-red-500",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  className,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-8 w-full rounded-md border border-border bg-elevated px-2.5 outline-none placeholder:text-muted/70 focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "h-8 rounded-md border border-border bg-elevated px-2 outline-none focus:border-accent",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  ariaLabel,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Visible label text. */
  label?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 select-none", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
        aria-label={label ? undefined : ariaLabel}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Horizontal tab strip used for request/response sections. */
export function TabStrip<T extends string>({
  tabs,
  value,
  onChange,
  className,
  right,
}: {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <div className={cx("flex items-center gap-1 border-b border-border px-3", className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px flex h-9 items-center gap-1.5 border-b-2 px-2 transition-colors",
            value === t.id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
        </button>
      ))}
      {right && <div className="ml-auto flex items-center gap-1">{right}</div>}
    </div>
  );
}

export function Count({ n }: { n: number }) {
  if (!n) return null;
  return <span className="rounded bg-hover px-1.5 text-[11px] leading-4 text-muted">{n}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = "max-w-lg",
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay p-4 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cx("flex max-h-[80vh] w-full flex-col rounded-xl border border-border bg-panel shadow-2xl", width)}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  separator?: boolean;
}

/** A floating menu at viewport coordinates, closed by outside click or Escape. */
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 min-w-44 rounded-lg border border-border bg-elevated p-1 shadow-xl"
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separator && <div className="my-1 border-t border-border" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cx(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover",
              item.danger && "text-red-500",
            )}
          >
            <span className="flex w-4 justify-center text-muted">{item.icon}</span>
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** State helper for menus opened from a button or a right-click. */
export function useMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const openFromEvent = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "contextmenu") {
      setAt({ x: e.clientX, y: e.clientY });
    } else {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setAt({ x: r.left, y: r.bottom + 4 });
    }
  }, []);
  const close = useCallback(() => setAt(null), []);
  return { at, openFromEvent, close };
}

/** A size in pixels that the user can drag to change, remembered across reloads. */
export function useResizable(key: string, initial: number, min: number, max: number, axis: "x" | "y") {
  const [size, setSize] = useState(() => {
    const v = Number(storage.get(key));
    return v >= min && v <= max ? v : initial;
  });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const start = axis === "x" ? e.clientX : e.clientY;
      const startSize = sizeRef.current;
      const onMove = (ev: MouseEvent) => {
        const delta = (axis === "x" ? ev.clientX : ev.clientY) - start;
        setSize(Math.max(min, Math.min(max, startSize + delta)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        storage.set(key, String(sizeRef.current));
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [axis, key, min, max],
  );
  return { size, onMouseDown };
}

export function Splitter({ axis, onMouseDown }: { axis: "x" | "y"; onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      className={cx(
        "group relative shrink-0 bg-border",
        axis === "x" ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
      )}
    >
      <div
        className={cx(
          "absolute z-10 transition-colors group-hover:bg-accent/60",
          axis === "x" ? "inset-y-0 -left-1 w-2" : "inset-x-0 -top-1 h-2",
        )}
      />
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
      {icon && <div className="mb-1 opacity-60">{icon}</div>}
      <div className="font-medium text-fg">{title}</div>
      {children && <div className="max-w-xs text-xs">{children}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-elevated px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";
