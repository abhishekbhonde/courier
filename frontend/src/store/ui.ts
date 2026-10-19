import { create } from "zustand";

export type Modal =
  | { type: "save"; tabId: string }
  | { type: "import" }
  | { type: "environment"; id: string | null }
  | { type: "collection"; id: string }
  | { type: "settings" }
  | { type: "code"; tabId: string };

type Dialog =
  | {
      kind: "prompt";
      title: string;
      label?: string;
      initial: string;
      secret: boolean;
      confirmText: string;
      resolve: (v: string | null) => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmText: string;
      danger: boolean;
      resolve: (v: boolean) => void;
    };

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error" | "success";
}

interface UIState {
  modal: Modal | null;
  dialog: Dialog | null;
  toasts: Toast[];
  openModal: (m: Modal) => void;
  closeModal: () => void;
}

export const useUI = create<UIState>((set) => ({
  modal: null,
  dialog: null,
  toasts: [],
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
}));

export function prompt(opts: {
  title: string;
  label?: string;
  initial?: string;
  confirmText?: string;
  secret?: boolean;
}): Promise<string | null> {
  return new Promise((resolve) => {
    useUI.setState({
      dialog: {
        kind: "prompt",
        title: opts.title,
        label: opts.label,
        initial: opts.initial ?? "",
        secret: opts.secret ?? false,
        confirmText: opts.confirmText ?? "OK",
        resolve: (v) => {
          useUI.setState({ dialog: null });
          resolve(v);
        },
      },
    });
  });
}

export function confirm(opts: { title: string; message: string; confirmText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useUI.setState({
      dialog: {
        kind: "confirm",
        title: opts.title,
        message: opts.message,
        confirmText: opts.confirmText ?? "Confirm",
        danger: opts.danger ?? false,
        resolve: (v) => {
          useUI.setState({ dialog: null });
          resolve(v);
        },
      },
    });
  });
}

let toastId = 0;
export function toast(message: string, kind: Toast["kind"] = "info") {
  const id = ++toastId;
  useUI.setState((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
  setTimeout(() => useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 6000 : 3000);
}

/** Runs an async action, reporting failures as an error toast. */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const v = await fn();
    if (success) toast(success, "success");
    return v;
  } catch (err) {
    toast((err as Error).message, "error");
    return undefined;
  }
}
