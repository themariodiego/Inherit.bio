"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AFFIRM_LABEL,
  BIRTH_PLACE_LABEL,
  DATE_HINT,
  DATE_OF_BIRTH_LABEL,
  EMAIL_HINT,
  EMAIL_LABEL,
  EXPIRED_STATUS,
  FAILED_STATUS,
  FIELD_ERROR,
  FORM_HEADING,
  INVALID_STATUS,
  KEY_HINT,
  LIMITED_STATUS,
  MODE_LABELS,
  MODE_LEGEND,
  NAME_LABEL,
  PARENT_NAMES_HINT,
  PARENT_NAMES_LABEL,
  RECEIVED_BODY,
  RECEIVED_HEADING,
  RECORD_KEY_LABEL,
  RECOVERY_KEY_LABEL,
  SENDING_BUTTON,
  SEND_BUTTON,
} from "@/copy/rights/future-person-claim";

type Mode = keyof typeof MODE_LABELS;
const MODES = Object.keys(MODE_LABELS) as Mode[];

/** What a person typed from a printed card: spaces and dashes dropped, capitals kept. */
function cardKey(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * The claim start (register api.future-person-claim). The page served the
 * form token; the browser already holds its cookie. The server answers every
 * accepted start the same way, so this form learns nothing about any record
 * and shows nothing about one. After a start, the next step (documents) is
 * named but not offered, because it is not built.
 */
export function FuturePersonClaimForm({ formToken }: { formToken: string }) {
  const [mode, setMode] = useState<Mode>("record-key");
  const [pending, setPending] = useState(false);
  const [received, setReceived] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());

  if (received) {
    return (
      <div role="status" className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-medium">{RECEIVED_HEADING}</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{RECEIVED_BODY}</p>
      </div>
    );
  }

  const fieldProps = (name: string) =>
    invalid.has(name)
      ? { "aria-invalid": true as const, "aria-describedby": `claim-${name}-error` }
      : {};
  const fieldError = (name: string) =>
    invalid.has(name) ? (
      <p id={`claim-${name}-error`} className="text-sm text-danger">
        {FIELD_ERROR}
      </p>
    ) : null;

  return (
    <form
      className="space-y-5 rounded-2xl border border-line bg-card p-6"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setStatus(null);
        setInvalid(new Set());
        const data = new FormData(event.currentTarget);
        const text = (name: string) => String(data.get(name) ?? "");
        const identity = {
          claimantName: text("claimantName"),
          contactEmail: text("contactEmail"),
          affirmed: data.get("affirmed") === "on",
        };
        const body = mode === "record-key"
          ? { mode, recordKey: cardKey(text("recordKey")), claimantDateOfBirth: text("dateOfBirth"), ...identity }
          : mode === "claimant-recovery-key"
            ? { mode, recoveryKey: cardKey(text("recoveryKey")), claimantDateOfBirth: text("dateOfBirth"), ...identity }
            : {
                mode,
                childDateOfBirth: text("dateOfBirth"),
                childPlaceOfBirth: text("childPlaceOfBirth"),
                parentNames: text("parentNames").split("\n").map((name) => name.trim()).filter(Boolean),
                ...identity,
              };
        let response: Response;
        try {
          response = await fetch("/api/future-person/claim", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json", "x-inherit-csrf": formToken },
            body: JSON.stringify(body),
          });
        } catch {
          setPending(false);
          setStatus(FAILED_STATUS);
          return;
        }
        setPending(false);
        if (response.status === 202) {
          setReceived(true);
          return;
        }
        if (response.status === 422) {
          const answer = (await response.json().catch(() => null)) as { issues?: unknown } | null;
          const issues = Array.isArray(answer?.issues) ? answer.issues.filter((issue): issue is string => typeof issue === "string") : [];
          setInvalid(new Set(issues.map((issue) => (issue === "claimantDateOfBirth" || issue === "childDateOfBirth" ? "dateOfBirth" : issue))));
          setStatus(INVALID_STATUS);
          return;
        }
        setStatus(response.status === 429 ? LIMITED_STATUS : response.status === 404 ? EXPIRED_STATUS : FAILED_STATUS);
      }}
    >
      <h2 className="font-medium">{FORM_HEADING}</h2>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{MODE_LEGEND}</legend>
        {MODES.map((value) => (
          <label key={value} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="radio"
              name="mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className="size-4"
            />
            <span>{MODE_LABELS[value]}</span>
          </label>
        ))}
      </fieldset>

      {mode === "record-key" || mode === "claimant-recovery-key" ? (
        <div className="space-y-2">
          <Label htmlFor={`claim-${mode === "record-key" ? "recordKey" : "recoveryKey"}`}>
            {mode === "record-key" ? RECORD_KEY_LABEL : RECOVERY_KEY_LABEL}
          </Label>
          <Input
            id={`claim-${mode === "record-key" ? "recordKey" : "recoveryKey"}`}
            name={mode === "record-key" ? "recordKey" : "recoveryKey"}
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            required
            {...fieldProps(mode === "record-key" ? "recordKey" : "recoveryKey")}
          />
          <p className="text-sm text-ink-muted">{KEY_HINT}</p>
          {fieldError(mode === "record-key" ? "recordKey" : "recoveryKey")}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="claim-claimantName">{NAME_LABEL}</Label>
        <Input id="claim-claimantName" name="claimantName" autoComplete="name" maxLength={120} required {...fieldProps("claimantName")} />
        {fieldError("claimantName")}
      </div>
      <div className="space-y-2">
        <Label htmlFor="claim-dateOfBirth">{DATE_OF_BIRTH_LABEL}</Label>
        {/* A text field, not type="date": the browser's date control keeps
            Tab inside its own segments, which traps keyboard focus. */}
        <Input
          id="claim-dateOfBirth"
          name="dateOfBirth"
          inputMode="numeric"
          autoComplete="bday"
          maxLength={10}
          required
          {...fieldProps("dateOfBirth")}
          aria-describedby={invalid.has("dateOfBirth") ? "claim-dateOfBirth-hint claim-dateOfBirth-error" : "claim-dateOfBirth-hint"}
        />
        <p id="claim-dateOfBirth-hint" className="text-sm text-ink-muted">{DATE_HINT}</p>
        {fieldError("dateOfBirth")}
      </div>
      {mode === "keyless-start" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="claim-childPlaceOfBirth">{BIRTH_PLACE_LABEL}</Label>
            <Input id="claim-childPlaceOfBirth" name="childPlaceOfBirth" maxLength={160} required {...fieldProps("childPlaceOfBirth")} />
            {fieldError("childPlaceOfBirth")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="claim-parentNames">{PARENT_NAMES_LABEL}</Label>
            <Textarea id="claim-parentNames" name="parentNames" rows={3} maxLength={500} required {...fieldProps("parentNames")} />
            <p className="text-sm text-ink-muted">{PARENT_NAMES_HINT}</p>
            {fieldError("parentNames")}
          </div>
        </>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="claim-contactEmail">{EMAIL_LABEL}</Label>
        <Input id="claim-contactEmail" name="contactEmail" type="email" autoComplete="email" maxLength={254} required {...fieldProps("contactEmail")} />
        <p className="text-sm text-ink-muted">{EMAIL_HINT}</p>
        {fieldError("contactEmail")}
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed">
        <input type="checkbox" name="affirmed" required className="mt-1 size-4" {...fieldProps("affirmed")} />
        <span>{AFFIRM_LABEL}</span>
      </label>
      {fieldError("affirmed")}
      {status ? (
        <p role="alert" className="text-sm text-danger">
          {status}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? SENDING_BUTTON : SEND_BUTTON}
      </Button>
    </form>
  );
}
