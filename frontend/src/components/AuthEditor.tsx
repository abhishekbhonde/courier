import type { Auth, AuthType } from "../types";
import { VarInput } from "./VarInput";
import { Field, Select } from "./ui";

const LABELS: Record<AuthType, string> = {
  inherit: "Inherit from collection",
  none: "No auth",
  bearer: "Bearer token",
  basic: "Basic auth",
  apikey: "API key",
};

function VarField({ label, value, onChange, placeholder }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Field label={label}>
      <VarInput
        value={value ?? ""}
        onChange={onChange}
        placeholder={placeholder}
        className="h-8 rounded-md border border-border bg-elevated focus-within:border-accent"
      />
    </Field>
  );
}

export function AuthEditor({
  auth,
  onChange,
  allowInherit,
  inheritedFrom,
}: {
  auth: Auth;
  onChange: (a: Auth) => void;
  allowInherit: boolean;
  /** Describes the auth that "inherit" resolves to, e.g. "Bearer token from My API". */
  inheritedFrom?: string;
}) {
  const types: AuthType[] = allowInherit ? ["inherit", "none", "bearer", "basic", "apikey"] : ["none", "bearer", "basic", "apikey"];
  const set = (patch: Partial<Auth>) => onChange({ ...auth, ...patch });

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Field label="Type">
        <Select value={auth.type} onChange={(e) => onChange({ ...auth, type: e.target.value as AuthType })} className="w-60">
          {types.map((t) => (
            <option key={t} value={t}>
              {LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>

      {auth.type === "inherit" && (
        <p className="text-xs text-muted">
          {inheritedFrom ?? "This request is not in a collection, so no auth will be sent."}
        </p>
      )}
      {auth.type === "none" && <p className="text-xs text-muted">This request does not use any authorization.</p>}
      {auth.type === "bearer" && (
        <VarField label="Token" value={auth.token} onChange={(token) => set({ token })} placeholder="{{token}}" />
      )}
      {auth.type === "basic" && (
        <>
          <VarField label="Username" value={auth.username} onChange={(username) => set({ username })} />
          <VarField label="Password" value={auth.password} onChange={(password) => set({ password })} />
        </>
      )}
      {auth.type === "apikey" && (
        <>
          <VarField label="Key" value={auth.key} onChange={(key) => set({ key })} placeholder="X-API-Key" />
          <VarField label="Value" value={auth.value} onChange={(value) => set({ value })} />
          <Field label="Add to">
            <Select value={auth.in ?? "header"} onChange={(e) => set({ in: e.target.value as "header" | "query" })} className="w-60">
              <option value="header">Header</option>
              <option value="query">Query params</option>
            </Select>
          </Field>
        </>
      )}
    </div>
  );
}

export function describeAuth(a: Auth): string {
  return LABELS[a.type];
}
