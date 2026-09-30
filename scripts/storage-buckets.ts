import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Which Storage buckets the migrations leave in place. `pnpm gate:routes`
 * compares this set with the register's declared buckets, and the browser
 * tests that attack or sweep "every bucket" read the same set, so a bucket
 * added or dropped by a migration reaches both without a hand-kept list.
 */

/**
 * Bucket names created by a migration. Only the one shape appears in this
 * repository, and a second shape appearing later trips the gate's floor guard
 * rather than passing unnoticed.
 */
export function createdBuckets(sql: string): string[] {
  const found: string[] = [];
  for (const statement of sql.matchAll(
    /insert\s+into\s+storage\.buckets\s*\([^)]*\)\s*values\s*([\s\S]*?);/gi,
  )) {
    for (const row of statement[1].matchAll(/\(\s*'([^']+)'/g)) found.push(row[1]);
  }
  return found;
}

/**
 * Bucket names a migration drops: `delete from storage.buckets where id =
 * 'name'` or `where id in ('a', 'b')`. Any other delete from storage.buckets
 * is a shape this reader cannot resolve, so it throws rather than letting a
 * dropped bucket read as still created.
 */
export function droppedBuckets(sql: string): string[] {
  const found: string[] = [];
  for (const statement of sql.matchAll(/delete\s+from\s+storage\.buckets\b([\s\S]*?);/gi)) {
    const single = /^\s*where\s+id\s*=\s*'([^']+)'\s*$/i.exec(statement[1]);
    const list = /^\s*where\s+id\s+in\s*\(([^)]*)\)\s*$/i.exec(statement[1]);
    if (single) found.push(single[1]);
    else if (list) for (const literal of list[1].matchAll(/'([^']+)'/g)) found.push(literal[1]);
    else throw new Error(`unreadable bucket delete: delete from storage.buckets${statement[1]}`);
  }
  return found;
}

/**
 * The buckets the migrations leave in place, applied in filename order and,
 * within a file, in statement order: a bucket a later statement drops is not
 * created, and one re-created after a drop is.
 */
export function migrationBuckets(migrationDirectory: string): Set<string> {
  const buckets = new Set<string>();
  const files = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const sql = readFileSync(path.join(migrationDirectory, name), "utf8");
    const statements = [...sql.matchAll(/(insert\s+into|delete\s+from)\s+storage\.buckets\b[\s\S]*?;/gi)];
    for (const statement of statements) {
      if (/^delete/i.test(statement[1])) for (const bucket of droppedBuckets(statement[0])) buckets.delete(bucket);
      else for (const bucket of createdBuckets(statement[0])) buckets.add(bucket);
    }
  }
  return buckets;
}
