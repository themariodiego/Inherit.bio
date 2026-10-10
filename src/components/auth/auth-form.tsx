"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface Field {
  name: string;
  label: string;
  type: "email" | "password" | "text";
  autoComplete?: string;
  minLength?: number;
}

// The server and first hydration pass must exclude credentials from native
// submission. Enable them only after React has attached the submit handler.
const subscribeToHydration = () => () => {};
const hydrated = () => true;
const notHydrated = () => false;

export function AuthForm({
  fields,
  submitLabel,
  onSubmit,
}: {
  fields: Field[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<string | null>;
}) {
  const ready = useSyncExternalStore(subscribeToHydration, hydrated, notHydrated);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setError(null);
        setPending(true);
        const data = new FormData(e.currentTarget);
        const values: Record<string, string> = {};
        for (const f of fields) values[f.name] = String(data.get(f.name) ?? "");
        const err = await onSubmit(values);
        if (err) {
          setError(err);
          setPending(false);
        }
      }}
    >
      <fieldset disabled={!ready} className="space-y-5">
        {fields.map((f) => (
          <div key={f.name} className="space-y-2">
            <Label htmlFor={f.name}>{f.label}</Label>
            <Input
              id={f.name}
              name={f.name}
              type={f.type}
              required
              autoComplete={f.autoComplete}
              minLength={f.minLength}
            />
          </div>
        ))}
        {error ? (
          <p role="alert" className="auth-note text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={!ready || pending}>
          {pending ? "Working…" : submitLabel}
        </Button>
      </fieldset>
      <noscript>
        <p className="auth-note">Turn on JavaScript in your browser to use this form.</p>
      </noscript>
    </form>
  );
}
