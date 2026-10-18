import { createContext, useContext, useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { isKnown, resolve, segments } from "../lib/vars";
import { cx } from "./ui";

/** Variables in scope for the request being edited (collection + environment). */
export const VariablesContext = createContext<Map<string, string> | null>(null);

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (v: string) => void;
};

/**
 * A text input that colors {{variables}}: green when defined, red when not.
 * It layers a highlighted copy of the text under a transparent input and
 * keeps their horizontal scroll in sync.
 */
export function VarInput({ value, onChange, className, ...props }: Props) {
  const vars = useContext(VariablesContext);
  const inputRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const sync = () => {
    if (layerRef.current && inputRef.current) layerRef.current.scrollLeft = inputRef.current.scrollLeft;
  };
  useLayoutEffect(sync, [value]);

  const hasVars = value.includes("{{");
  const resolved = hasVars && vars ? resolve(value, vars) : undefined;

  return (
    <div className={cx("relative min-w-0 font-mono text-[12.5px]", className)}>
      <div
        ref={layerRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-2.5 whitespace-pre"
      >
        {segments(value).map((s, i) =>
          s.variable ? (
            <span
              key={i}
              className={cx(
                "rounded-sm",
                vars && isKnown(s.variable, vars)
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-red-500/15 text-red-600 dark:text-red-400",
              )}
            >
              {s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
        {/* Room for the caret at the end of long values. */}
        <span className="inline-block w-4" />
      </div>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
        onKeyUp={sync}
        onSelect={sync}
        spellCheck={false}
        autoComplete="off"
        title={resolved !== undefined && resolved !== value ? resolved : undefined}
        className="relative h-full w-full bg-transparent px-2.5 text-transparent caret-[var(--fg)] outline-none placeholder:font-sans placeholder:text-muted/70"
        {...props}
      />
    </div>
  );
}
