import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthForm, type Field } from "./auth-form";

const email: Field = { name: "email", label: "Email", type: "email", autoComplete: "email" };
const password: Field = { name: "password", label: "Password", type: "password", autoComplete: "current-password" };
const forms: { name: string; fields: Field[]; submitLabel: string }[] = [
  { name: "sign in", fields: [email, password], submitLabel: "Sign in" },
  { name: "sign up", fields: [email, { ...password, autoComplete: "new-password", minLength: 8 }], submitLabel: "Sign up" },
  { name: "password reset request", fields: [email], submitLabel: "Send reset link" },
  { name: "new password", fields: [{ ...password, label: "New password", autoComplete: "new-password", minLength: 8 }], submitLabel: "Update password" },
];

describe("auth forms before hydration", () => {
  it.each(forms)("excludes every $name credential control from native submission", ({ fields, submitLabel }) => {
    const onSubmit = vi.fn();
    const html = renderToStaticMarkup(createElement(AuthForm, { fields, submitLabel, onSubmit }));
    const fieldsets = [...html.matchAll(/<fieldset\b([^>]*)>([\s\S]*?)<\/fieldset>/gu)];
    expect(fieldsets).toHaveLength(1);
    expect(fieldsets[0][1]).toMatch(/\bdisabled=""/u);
    // A disabled fieldset excludes its controls from the browser's native
    // entry list, including a browser's autofilled email or password.
    const closed = fieldsets[0][2];
    expect([...closed.matchAll(/<input\b/gu)]).toHaveLength(fields.length);
    for (const field of fields) {
      expect(closed).toContain(`name="${field.name}"`);
      expect(closed).toContain(`type="${field.type}"`);
      expect(closed).toContain(`for="${field.name}"`);
      expect(closed).toContain(`id="${field.name}"`);
      expect(closed).toContain(`autoComplete="${field.autoComplete}"`);
      if (field.minLength) expect(closed).toContain(`minLength="${field.minLength}"`);
    }
    expect(closed).toMatch(new RegExp(`<button\\b[^>]*type="submit"[^>]*disabled=""[^>]*>${submitLabel}<`, "u"));
    expect(html.replace(fieldsets[0][0], "")).not.toMatch(/<(?:input|select|textarea)\b/u);
    expect(html).toContain("<noscript>");
    expect(html).toContain("Turn on JavaScript in your browser to use this form.");
    expect(html).not.toContain('role="alert"');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
