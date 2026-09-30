/**
 * "Task completed yes/no" (G3.1), decided mechanically from what the browser
 * recorded and never from what the participant says. The rule for each task is
 * its binding in `bindings.json`: the bound routes, and for T1 and T3 the bound
 * report slugs. Two tasks need a fact the path cannot show, and the harness
 * reads it from the local database after the session: T8's deletion was
 * actually scheduled, and T9's participant did not create an account.
 *
 * Grading the answer is separate and blind (rubric.md). Where a task has a
 * threshold, both must pass.
 */
import type { TaskId } from "./conductor-contract";

export interface BoundTask { id: TaskId; routes: readonly string[]; templateSlugs: readonly string[] }
export interface SessionFacts {
  /** Every pathname the session's page reached, in order. */
  paths: readonly string[];
  /** T8: the account's deletion request exists in the database. */
  accountDeletionScheduled?: boolean;
  /** T9, T10: an account was created or signed in during the session. */
  accountCreated?: boolean;
}

/** `/genome/[subject]/reports/[slug]` → a whole-path matcher. A bracketed
 * segment matches one path segment; `slugs`, when given, restricts `[slug]`. */
export function routeMatcher(route: string, slugs?: readonly string[]): RegExp {
  if (!/^\/[A-Za-z0-9\-/[\]]*$/.test(route)) throw new Error(`Unsupported bound route ${route}`);
  const segments = route.split("/").slice(1).map(segment => {
    if (segment === "[slug]" && slugs?.length) return `(?:${slugs.map(slug => slug.replace(/[^a-z0-9-]/g, "")).join("|")})`;
    return /^\[[a-z]+\]$/.test(segment) ? "[^/]+" : segment.replace(/[-]/g, "\\-");
  });
  return new RegExp(`^/${segments.join("/")}/?$`);
}

const reached = (paths: readonly string[], matcher: RegExp) => paths.some(value => matcher.test(value));

export function taskCompleted(task: BoundTask, facts: SessionFacts): boolean {
  const { paths } = facts;
  switch (task.id) {
    case "T1":
    case "T3":
      // A bound report page, and only one of the bound reports.
      return reached(paths, routeMatcher("/genome/[subject]/reports/[slug]", task.templateSlugs));
    case "T8":
      return facts.accountDeletionScheduled === true;
    case "T9":
      // The subject-access route and the withdrawal it offers, without an
      // account. Since D-081 the bound `/withdraw/[token]` is two pages: the
      // mailed link opens `/withdraw/request`, which only hands the fragment
      // over, and the review offering the withdrawal is `/withdraw/session`.
      // Opening the mail is an entry, so it alone cannot complete the task.
      return facts.accountCreated === false && reached(paths, routeMatcher("/legal/appeals"))
        && reached(paths, routeMatcher("/withdraw/session"));
    case "T10":
      return facts.accountCreated === false && task.routes.slice(1).some(route => reached(paths, routeMatcher(route)));
    default:
      // T2, T4, T5, T6, T7: any bound surface other than the entry point.
      return task.routes.filter(route => route !== "/" && route !== "/overview")
        .some(route => reached(paths, routeMatcher(route)));
  }
}
