import type { Application } from "@/db/applications/store";
import type { ProfileSnapshot } from "@/db/profile/store";
import { STATUS_LABELS } from "@/lib/applications/types";
import {
  MAX_GRAPH_JOBS,
  MAX_NODES,
  MAX_SKILLS_PER_JOB,
  type CareerGraph,
  type GraphEdge,
  type GraphNode,
} from "@/lib/graph/types";
import type { Job } from "@/lib/jobs/schemas";
import { normalizeKey, normalizeSkill } from "@/lib/skills/catalog";
import { buildCandidate } from "@/services/matching/candidate";
import { verifiedSnapshot } from "@/services/profile/verified";

export interface GraphInput {
  snapshot: ProfileSnapshot;
  applications: readonly Application[];
  /** Jobs to show, in priority order: the tracked ones first, then the best matches. */
  jobs: readonly Job[];
  now?: Date;
}

const slug = (s: string) => normalizeKey(s).replace(/\s+/g, "-") || "x";

/**
 * Builds the graph from verified items only. Skills the person lacks appear as separate "gap"
 * nodes, clearly typed, and only because a job on the graph asks for them; nothing here adds
 * anything to the profile. Pure and deterministic: the same inputs give the same graph.
 */
export function buildCareerGraph(input: GraphInput): CareerGraph {
  const v = verifiedSnapshot(input.snapshot);
  const candidate = buildCandidate(input.snapshot, input.now);
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const node = (n: GraphNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
    return n.id;
  };
  const edge = (from: string, to: string, kind: GraphEdge["kind"]) => {
    const key = `${from}>${to}>${kind}`;
    if (from === to || edgeKeys.has(key) || !nodes.has(from) || !nodes.has(to)) return;
    edgeKeys.add(key);
    edges.push({ from, to, kind });
  };

  const user = node({
    id: "user:you",
    type: "user",
    label: v.profile?.full_name ?? "You",
    detail: v.profile?.headline ?? null,
    href: "/profile",
  });

  /* ---------- what the person has verified ---------- */
  for (const s of candidate.skills.values()) {
    node({
      id: `skill:${s.key}`,
      type: "skill",
      label: s.name,
      detail: s.level ? `${s.level}` : "used in your work",
      href: "/profile",
    });
  }
  for (const p of v.projects)
    node({
      id: `project:${p.id}`,
      type: "project",
      label: p.name,
      detail: p.role,
      href: "/profile",
    });
  for (const e of v.experiences) {
    node({
      id: `experience:${e.id}`,
      type: "experience",
      label: e.title,
      detail: e.organization,
      href: "/profile",
    });
  }
  for (const e of v.education) {
    node({
      id: `education:${e.id}`,
      type: "education",
      label: e.degree,
      detail: e.institution,
      href: "/profile",
    });
  }
  for (const c of v.certifications) {
    node({
      id: `certification:${c.id}`,
      type: "certification",
      label: c.name,
      detail: c.issuer,
      href: "/profile",
    });
  }

  for (const id of nodes.keys()) {
    const type = nodes.get(id)!.type;
    if (["skill", "project", "experience", "education", "certification"].includes(type)) {
      // Skills hang off the things that used them; everything else hangs off the person.
      if (type !== "skill") edge(user, id, "has");
    }
  }
  for (const s of candidate.skills.values()) {
    const id = `skill:${s.key}`;
    if (s.ref) edge(user, id, "has");
    for (const used of s.usedIn) {
      const from = `${used.entity === "experiences" ? "experience" : "project"}:${used.id}`;
      edge(from, id, "uses");
    }
  }

  /* ---------- jobs, their companies, and the skills they ask for ---------- */
  const jobs = input.jobs.slice(0, MAX_GRAPH_JOBS);
  for (const job of jobs) {
    const jobId = node({
      id: `job:${job.id}`,
      type: "job",
      label: job.title,
      detail: job.company_name,
      href: `/jobs/${job.id}`,
    });
    const companyId = node({
      id: `company:${slug(job.company_name)}`,
      type: "company",
      label: job.company_name,
      detail: null,
      href: null,
    });
    edge(jobId, companyId, "at");

    const seen = new Set<string>();
    for (const raw of job.required_skills) {
      const name = normalizeSkill(raw).name;
      const key = normalizeKey(name);
      if (seen.has(key) || seen.size >= MAX_SKILLS_PER_JOB) continue;
      seen.add(key);
      if (candidate.skills.has(key)) {
        edge(jobId, `skill:${key}`, "requires");
      } else {
        const gapId = node({
          id: `gap:${key}`,
          type: "gap",
          label: name,
          detail: "not in your verified profile",
          href: "/gaps",
        });
        edge(jobId, gapId, "lacks");
      }
    }
  }

  /* ---------- applications and how they went ---------- */
  const jobIds = new Set(jobs.map((j) => j.id));
  for (const a of input.applications) {
    const appId = node({
      id: `application:${a.id}`,
      type: "application",
      label: a.jobTitle,
      detail: a.companyName,
      href: `/applications/${a.id}`,
    });
    edge(user, appId, "applied");
    if (a.jobId && jobIds.has(a.jobId)) edge(appId, `job:${a.jobId}`, "applied");
    const outcomeId = node({
      id: `outcome:${a.status}`,
      type: "outcome",
      label: STATUS_LABELS[a.status],
      detail: null,
      href: "/applications",
    });
    edge(appId, outcomeId, "outcome");
  }

  return trim({ nodes: [...nodes.values()], edges, trimmed: false });
}

/** Drops the least connected skills first if the graph is too big to read. */
function trim(graph: CareerGraph): CareerGraph {
  if (graph.nodes.length <= MAX_NODES) return graph;
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const keep = new Set<string>();
  const droppable = graph.nodes
    .filter((n) => n.type === "skill")
    .sort((a, b) => (degree.get(a.id) ?? 0) - (degree.get(b.id) ?? 0) || a.id.localeCompare(b.id));
  let over = graph.nodes.length - MAX_NODES;
  const dropped = new Set<string>();
  for (const n of droppable) {
    if (over <= 0) break;
    dropped.add(n.id);
    over--;
  }
  for (const n of graph.nodes) if (!dropped.has(n.id)) keep.add(n.id);
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    trimmed: true,
  };
}
