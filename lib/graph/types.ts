/**
 * The career graph: the person, what they have verified, the jobs and companies they are
 * looking at, and how their applications have gone, as nodes joined by edges. It is built on
 * read from the same records as everything else and only shows verified profile items.
 */

export const NODE_TYPES = [
  "user",
  "skill",
  "gap",
  "project",
  "experience",
  "education",
  "certification",
  "job",
  "company",
  "application",
  "outcome",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  user: "You",
  skill: "Skills you have",
  gap: "Skills asked for that you lack",
  project: "Projects",
  experience: "Experience",
  education: "Education",
  certification: "Certifications",
  job: "Jobs",
  company: "Companies",
  application: "Applications",
  outcome: "Outcomes",
};

export const EDGE_KINDS = ["has", "uses", "requires", "lacks", "at", "applied", "outcome"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const EDGE_LABELS: Record<EdgeKind, string> = {
  has: "has",
  uses: "uses",
  requires: "asks for",
  lacks: "asks for (you lack)",
  at: "is at",
  applied: "applied to",
  outcome: "ended as",
};

export interface GraphNode {
  /** Unique and stable: `type:key`. */
  id: string;
  type: NodeType;
  label: string;
  /** A short second line, such as a skill level, a company or a status. */
  detail: string | null;
  /** Where the full record lives in the app, when there is one. */
  href: string | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface CareerGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** True when something was left out to keep the graph readable. */
  trimmed: boolean;
}

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

export interface LaidOutGraph {
  nodes: PositionedNode[];
  edges: GraphEdge[];
  trimmed: boolean;
  width: number;
  height: number;
}

/** Most nodes drawn at once; beyond this the picture stops being readable. */
export const MAX_NODES = 160;
/** Jobs shown: the ones tracked first, then the best matches, up to this many. */
export const MAX_GRAPH_JOBS = 12;
/** Required skills drawn per job. */
export const MAX_SKILLS_PER_JOB = 6;
