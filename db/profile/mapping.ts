import { MONTH_FIELDS, type CollectionEntity, type SingletonEntity } from "@/lib/profile/schemas";

type Entity = CollectionEntity | SingletonEntity;
type Row = Record<string, unknown>;

/** App months (YYYY-MM) to database dates (first of the month). */
export function toDbRow(entity: Entity, data: Row): Row {
  const row: Row = { ...data };
  for (const field of MONTH_FIELDS[entity]) {
    const value = row[field];
    row[field] = typeof value === "string" && value ? `${value}-01` : null;
  }
  return row;
}

/** Database dates to app months, dropping columns the app never reads (user_id, is_demo). */
export function fromDbRow(entity: Entity, row: Row): Row {
  const { user_id: _userId, is_demo: _isDemo, ...rest } = row;
  for (const field of MONTH_FIELDS[entity]) {
    const value = rest[field];
    rest[field] = typeof value === "string" && value ? value.slice(0, 7) : null;
  }
  return rest;
}

/** Display order: newest first for dated items, alphabetical for skills. Stable and shared. */
export function sortItems<T extends object>(entity: CollectionEntity, items: T[]): T[] {
  const dateKey: Record<CollectionEntity, string | null> = {
    education: "start_date",
    experiences: "start_date",
    projects: "start_date",
    certifications: "issued_date",
    achievements: "achieved_on",
    skills: null,
  };
  const key = dateKey[entity];
  return [...items].sort((left, right) => {
    const a = left as Row;
    const b = right as Row;
    if (entity === "skills") {
      return (
        String(a.type).localeCompare(String(b.type)) || String(a.name).localeCompare(String(b.name))
      );
    }
    const da = key ? ((a[key] as string | null) ?? "") : "";
    const db = key ? ((b[key] as string | null) ?? "") : "";
    if (da !== db) return da < db ? 1 : -1; // newest first; undated last
    return String(b.created_at).localeCompare(String(a.created_at));
  });
}
