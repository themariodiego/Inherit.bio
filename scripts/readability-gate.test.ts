import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTsxBlocksFromSource, runReadabilityGate } from "./readability-gate";

describe("readability copy extraction", () => {
  it("scores nested copy containers separately instead of inventing a composite block", () => {
    const blocks = extractTsxBlocksFromSource(
      "src/example.tsx",
      `<div role="status"><h2>Invitation requested</h2><p>We will send an invitation if this address can receive one.</p></div>`,
    );

    expect(blocks.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "heading", text: "Invitation requested" },
      { role: "block", text: "We will send an invitation if this address can receive one." },
    ]);
  });

  it("keeps inline markup inside the string block", () => {
    const blocks = extractTsxBlocksFromSource(
      "src/example.tsx",
      `<p>Your <strong>private</strong> data stays here.</p>`,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("Your private data stays here.");
  });

  it("extracts visible text attributes independently", () => {
    const blocks = extractTsxBlocksFromSource(
      "src/example.tsx",
      `<img alt="A map of your results" title="Open the map" />`,
    );

    expect(blocks.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "label", text: "A map of your results" },
      { role: "label", text: "Open the map" },
    ]);
  });

  it("keeps every displayed provider field within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const providerFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/providers/providers.json:"),
    );

    expect(providerFailures).toEqual([]);
  });

  it("keeps every lifestyle and wellness template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const lifestyleFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/lifestyle-wellness.json:"),
    );

    expect(lifestyleFailures).toEqual([]);
  });

  it("keeps every brain-health template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const brainHealthFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/brain-health.json:"),
    );

    expect(brainHealthFailures).toEqual([]);
  });

  it("keeps every gastrointestinal template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const gastrointestinalFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/gastrointestinal.json:"),
    );

    expect(gastrointestinalFailures).toEqual([]);
  });

  it("keeps every longevity template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const longevityFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/longevity.json:"),
    );

    expect(longevityFailures).toEqual([]);
  });

  it("keeps every mental-health template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const mentalHealthFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/mental-health.json:"),
    );

    expect(mentalHealthFailures).toEqual([]);
  });

  it("keeps every basic-traits template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const basicTraitsFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/basic-traits.json:"),
    );

    expect(basicTraitsFailures).toEqual([]);
  });

  it("keeps every addiction template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const addictionFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/addiction.json:"),
    );

    expect(addictionFailures).toEqual([]);
  });

  it("keeps every aesthetic-cosmetic template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const aestheticFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/aesthetic-cosmetic.json:"),
    );

    expect(aestheticFailures).toEqual([]);
  });

  it("keeps every heart-cardiovascular template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const heartFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/heart-cardiovascular.json:"),
    );

    expect(heartFailures).toEqual([]);
  });

  it("keeps the privacy policy within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const privacyFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("src/app/(marketing)/privacy/page.tsx:"),
    );

    expect(privacyFailures).toEqual([]);
  });

  it("keeps every environmental-sensitivity template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const environmentalFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/environmental-sensitivity.json:"),
    );

    expect(environmentalFailures).toEqual([]);
  });

  it("keeps every reproductive-family template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const reproductiveFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/reproductive-family.json:"),
    );

    expect(reproductiveFailures).toEqual([]);
  });

  it("keeps every metabolic-obesity template within the long-block grade limit", () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const metabolicFailures = runReadabilityGate(repositoryRoot).failures.filter((failure) =>
      failure.startsWith("data/templates/metabolic-obesity.json:"),
    );

    expect(metabolicFailures).toEqual([]);
  });
});
