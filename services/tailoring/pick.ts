import type { Entry, ResumeDoc } from "@/lib/tailoring/types";

export interface PickBullet {
  key: string;
  label: string;
}

export interface PickItem {
  key: string;
  label: string;
  bullets: PickBullet[];
}

export interface PickSection {
  title: string;
  items: PickItem[];
}

const entryItem = (e: Entry): PickItem => ({
  key: e.ref.id,
  label: e.heading.text,
  bullets: e.bullets.flatMap((b) => {
    const field = b.refs[0]?.fields[0] ?? "";
    const m = /^highlights\.(\d+)$/.exec(field);
    return m ? [{ key: `${e.ref.id}#h${m[1]}`, label: b.text }] : [];
  }),
});

/** Everything the user can leave out, taken from the full (untailored) resume. */
export function pickableSections(master: ResumeDoc): PickSection[] {
  const sections: PickSection[] = [
    {
      title: "Skills",
      items: master.skills.map((s) => ({ key: s.refs[0]!.id, label: s.text, bullets: [] })),
    },
    { title: "Experience", items: master.experience.map(entryItem) },
    { title: "Projects", items: master.projects.map(entryItem) },
    { title: "Education", items: master.education.map(entryItem) },
    { title: "Certifications", items: master.certifications.map(entryItem) },
    { title: "Achievements", items: master.achievements.map(entryItem) },
  ];
  return sections.filter((s) => s.items.length > 0);
}

export const allPickKeys = (sections: PickSection[]): string[] =>
  sections.flatMap((s) => s.items.flatMap((i) => [i.key, ...i.bullets.map((b) => b.key)]));

/** Turns the checked boxes back into what to leave out. Only keys that really exist count. */
export function excludedFrom(sections: PickSection[], keep: readonly string[]): string[] {
  const kept = new Set(keep);
  return allPickKeys(sections).filter((k) => !kept.has(k));
}
