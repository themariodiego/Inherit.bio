import { describe, expect, it } from "vitest";
import { checkResponsePolicy, classifyIntent, withPeopleAsPersons } from "./guard";

/**
 * A group scope names its people. The rule table names persons by pronoun
 * ("do they have …", "your partner has …"), so without the people list a
 * question or an answer about a named person slips past rules that would
 * catch the same sentence about "you". These hold the group scope to the
 * own scope's rules, and leave every other scope exactly as it was.
 */
const family = { kind: "family" as const, displayLabel: "your family view", people: ["Bea", "Invited adult", "Jo (A.)"] };

describe("the input gate reads a group scope's people as persons", () => {
  it.each([
    ["Does Bea have diabetes?", "diagnosis"],
    ["does invited adult have dementia", "diagnosis"],
    ["Will Bea get cancer?", "prognosis"],
    ["How much vitamin D should Bea take?", "treatment"],
    ["Does Jo (A.) have diabetes?", "diagnosis"],
  ])("gates %j as %s", (message, intent) => {
    expect(classifyIntent(message, family).intent).toBe(intent);
  });

  it.each([
    "Does Bea have the lactase variant?",
    "Does Bea have MTHFR?",
    "What did Bea share with me?",
    "What does Bea's caffeine report say?",
    "Beatrice and Bea both shared estimates. Which reports are they?",
  ])("still allows the file-fact question %j", (message) => {
    expect(classifyIntent(message, family).intent).toBe("allowed");
  });

  it("changes nothing for a scope without people", () => {
    expect(classifyIntent("Does Bea have diabetes?", { kind: "self", displayLabel: "You" }))
      .toEqual(classifyIntent("Does Bea have diabetes?", { kind: "self", displayLabel: "You", people: [] }));
  });
});

describe("the output guard reads a group scope's people as persons", () => {
  it.each([
    ["Bea has diabetes.", "diagnosis"],
    ["Invited adult will develop cancer.", "prognosis"],
    ["Bea should take vitamin D.", "treatment"],
  ])("replaces %j as %s", (answer, intent) => {
    expect(checkResponsePolicy(answer, "family", family.people).intent).toBe(intent);
  });

  it.each([
    "Bea has one copy of the A letter at rs4988235 in the Fixture estimate report.",
    "Bea shared one estimate report. It does not say whether Bea has any condition.",
  ])("keeps the file-fact answer %j", (answer) => {
    expect(checkResponsePolicy(answer, "family", family.people).intent).toBe("allowed");
  });

  it("matches whole names only, longest first, and escapes them", () => {
    expect(withPeopleAsPersons("bea and beatrice", ["Bea"], "they", "their")).toBe("they and beatrice");
    expect(withPeopleAsPersons("jo a s report", ["Jo (A.)"], "they", "their")).toBe("they s report");
    expect(withPeopleAsPersons("invited adult's file", ["Invited adult", "Invited"], "they", "their")).toBe("their file");
  });
});
