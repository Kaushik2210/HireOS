import type { CareerGraph, LaidOutGraph, NodeType, PositionedNode } from "@/lib/graph/types";

export const GRAPH_WIDTH = 1000;
export const GRAPH_HEIGHT = 720;
const PAD = 60;
/** Nodes closer than this overlap their labels, so they are pushed apart. */
const MIN_GAP = 40;

/** Where each kind of node starts, as a share of the half-width. Only the start: forces do the rest. */
const START_RING: Record<NodeType, number> = {
  user: 0,
  project: 0.22,
  experience: 0.22,
  education: 0.3,
  certification: 0.3,
  skill: 0.5,
  application: 0.42,
  outcome: 0.3,
  job: 0.66,
  gap: 0.78,
  company: 0.9,
};

const TYPE_ORDER: NodeType[] = [
  "project",
  "experience",
  "education",
  "certification",
  "skill",
  "application",
  "outcome",
  "job",
  "gap",
  "company",
];

/**
 * A deterministic force-directed layout (Fruchterman-Reingold). There is no randomness: nodes
 * start on rings by type, in input order, so the same graph always lands in the same place
 * and a reload does not shuffle the picture. The person stays at the centre. Coordinates
 * are finite and inside the canvas, and nodes never sit on top of each other.
 */
export function layoutGraph(
  graph: CareerGraph,
  size: { width: number; height: number } = { width: GRAPH_WIDTH, height: GRAPH_HEIGHT },
  iterations = 220,
): LaidOutGraph {
  const { width, height } = size;
  const n = graph.nodes.length;
  const cx = width / 2;
  const cy = height / 2;
  const x = new Float64Array(n);
  const y = new Float64Array(n);

  const byType = new Map<NodeType, number[]>();
  graph.nodes.forEach((node, i) => byType.set(node.type, [...(byType.get(node.type) ?? []), i]));
  for (const [type, members] of byType) {
    const ring = START_RING[type] * (Math.min(width, height) / 2 - PAD);
    const offset = (TYPE_ORDER.indexOf(type) + 1) * 0.9;
    members.forEach((i, k) => {
      if (type === "user") {
        x[i] = cx;
        y[i] = cy;
        return;
      }
      const angle = (k / members.length) * Math.PI * 2 + offset;
      x[i] = cx + Math.cos(angle) * ring * 1.35;
      y[i] = cy + Math.sin(angle) * ring;
    });
  }

  const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
  const links = graph.edges
    .map((e) => [index.get(e.from)!, index.get(e.to)!] as const)
    .filter(([a, b]) => a !== undefined && b !== undefined);

  if (n > 1) {
    const area = (width - PAD * 2) * (height - PAD * 2);
    const k = Math.sqrt(area / n) * 0.8;
    let temperature = Math.min(width, height) / 8;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);

    for (let step = 0; step < iterations; step++) {
      dx.fill(0);
      dy.fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let ex = x[i]! - x[j]!;
          let ey = y[i]! - y[j]!;
          let d = Math.hypot(ex, ey);
          if (d < 0.01) {
            // Coincident: separate along a direction fixed by the pair, not by chance.
            const a = ((i * 31 + j * 17) % 360) * (Math.PI / 180);
            ex = Math.cos(a);
            ey = Math.sin(a);
            d = 0.01;
          }
          const push = (k * k) / d;
          dx[i]! += (ex / d) * push;
          dy[i]! += (ey / d) * push;
          dx[j]! -= (ex / d) * push;
          dy[j]! -= (ey / d) * push;
        }
      }
      for (const [a, b] of links) {
        const ex = x[a]! - x[b]!;
        const ey = y[a]! - y[b]!;
        const d = Math.max(0.01, Math.hypot(ex, ey));
        const pull = (d * d) / k;
        dx[a]! -= (ex / d) * pull;
        dy[a]! -= (ey / d) * pull;
        dx[b]! += (ex / d) * pull;
        dy[b]! += (ey / d) * pull;
      }
      for (let i = 0; i < n; i++) {
        if (graph.nodes[i]!.type === "user") continue;
        // A gentle pull to the middle keeps unconnected nodes from drifting away.
        dx[i]! += (cx - x[i]!) * 0.02;
        dy[i]! += (cy - y[i]!) * 0.02;
        const d = Math.hypot(dx[i]!, dy[i]!);
        if (d > 0) {
          const move = Math.min(d, temperature);
          x[i]! += (dx[i]! / d) * move;
          y[i]! += (dy[i]! / d) * move;
        }
      }
      temperature *= 0.975;
    }
  }

  // Fit into the canvas with padding, keeping the person where the layout put them relative to the rest.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]!);
    maxX = Math.max(maxX, x[i]!);
    minY = Math.min(minY, y[i]!);
    maxY = Math.max(maxY, y[i]!);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - PAD * 2) / spanX, (height - PAD * 2) / spanY, 1.6);
  const offX = (width - spanX * scale) / 2 - minX * scale;
  const offY = (height - spanY * scale) / 2 - minY * scale;

  for (let i = 0; i < n; i++) {
    x[i] = x[i]! * scale + offX;
    y[i] = y[i]! * scale + offY;
  }

  // Last, in canvas units: no two labels on top of each other, and nothing off the edge.
  const lo = PAD / 2;
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ex = x[i]! - x[j]!;
        const ey = y[i]! - y[j]!;
        const d = Math.hypot(ex, ey);
        if (d >= MIN_GAP) continue;
        const ux = d > 0.01 ? ex / d : Math.cos(i * 7 + j);
        const uy = d > 0.01 ? ey / d : Math.sin(i * 7 + j);
        const shift = (MIN_GAP - d) / 2 + 0.5;
        const pinI = graph.nodes[i]!.type === "user";
        const pinJ = graph.nodes[j]!.type === "user";
        if (!pinI) {
          x[i]! += ux * shift * (pinJ ? 2 : 1);
          y[i]! += uy * shift * (pinJ ? 2 : 1);
        }
        if (!pinJ) {
          x[j]! -= ux * shift * (pinI ? 2 : 1);
          y[j]! -= uy * shift * (pinI ? 2 : 1);
        }
        moved = true;
      }
    }
    for (let i = 0; i < n; i++) {
      x[i] = Math.min(width - lo, Math.max(lo, x[i]!));
      y[i] = Math.min(height - lo, Math.max(lo, y[i]!));
    }
    if (!moved) break;
  }

  const nodes: PositionedNode[] = graph.nodes.map((node, i) => ({
    ...node,
    x: Math.round(x[i]! * 10) / 10,
    y: Math.round(y[i]! * 10) / 10,
  }));
  return { nodes, edges: graph.edges, trimmed: graph.trimmed, width, height };
}
