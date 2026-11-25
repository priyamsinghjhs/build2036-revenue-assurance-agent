/** Server-side record visibility. Out-of-scope ids are 404, never 403. */

import type { AppUser } from "../shared/roles";
import { AppError } from "../shared/errors";
import {
  SCOPE_NOT_FOUND,
  areaFromExceptionId,
  areaInRoleScope,
  recordInScope,
  roleSeesAllAreas,
  type RecordObjectType,
} from "../shared/scope";
import type { AppDb } from "./pg";

export { SCOPE_NOT_FOUND, areaFromExceptionId };

export function notFound(): never {
  throw new AppError(SCOPE_NOT_FOUND, 404);
}

export async function isAssigned(
  db: AppDb,
  userId: string,
  objectType: RecordObjectType,
  objectId: string,
): Promise<boolean> {
  try {
    const row = await db
      .prepare(
        "SELECT 1 AS ok FROM ra_record_assignments WHERE user_id=? AND object_type=? AND object_id=? LIMIT 1",
      )
      .bind(userId, objectType, objectId)
      .first<{ ok: number }>();
    if (row) return true;
    // A review/action/case is visible if the underlying exception was assigned.
    if (objectType !== "exception" && objectId.includes(":")) {
      const ex = await db
        .prepare(
          "SELECT 1 AS ok FROM ra_record_assignments WHERE user_id=? AND object_type='exception' AND object_id=? LIMIT 1",
        )
        .bind(userId, objectId)
        .first<{ ok: number }>();
      if (ex) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function recordVisible(
  db: AppDb,
  user: AppUser,
  opts: { type: RecordObjectType; id: string; area?: string | null },
): Promise<boolean> {
  if (roleSeesAllAreas(user.role)) return true;
  const area = opts.area ?? areaFromExceptionId(opts.id);
  if (area && areaInRoleScope(user.role, area)) return true;
  return isAssigned(db, user.id, opts.type, opts.id);
}

export async function assertRecordVisible(
  db: AppDb,
  user: AppUser,
  opts: { type: RecordObjectType; id: string; area?: string | null },
): Promise<void> {
  if (!(await recordVisible(db, user, opts))) notFound();
}

export async function assertAreaVisible(user: AppUser, area: string): Promise<void> {
  if (!areaInRoleScope(user.role, area)) notFound();
}

export function filterRowsByScope<T>(
  user: AppUser,
  rows: T[],
  areaOf: (row: T) => string | null | undefined,
  assignedIds?: Set<string>,
  idOf?: (row: T) => string,
): T[] {
  if (roleSeesAllAreas(user.role)) return rows;
  return rows.filter((row) => {
    const assigned = Boolean(assignedIds && idOf && assignedIds.has(idOf(row)));
    return recordInScope(user.role, { area: areaOf(row), assignedToUser: assigned });
  });
}

export async function loadAssignedIds(
  db: AppDb,
  userId: string,
  types: RecordObjectType[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!types.length) return out;
  try {
    const ph = types.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT object_type, object_id FROM ra_record_assignments WHERE user_id=? AND object_type IN (${ph})`,
      )
      .bind(userId, ...types)
      .all<{ object_type: string; object_id: string }>();
    for (const r of results ?? []) {
      out.add(r.object_id);
      if (r.object_type === "exception") out.add(r.object_id);
    }
  } catch {
    /* table may not exist yet in a local empty DB */
  }
  return out;
}
