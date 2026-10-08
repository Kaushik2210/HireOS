"use client";

import { Minus, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EDGE_LABELS,
  NODE_TYPE_LABELS,
  NODE_TYPES,
  type EdgeKind,
  type LaidOutGraph,
  type NodeType,
} from "@/lib/graph/types";

type Shape = "circle" | "ring" | "square" | "diamond";

/** Shape and colour together, so meaning never rests on colour alone. */
const STYLE: Record<NodeType, { shape: Shape; fill: string; stroke: string; r: number }> = {
  user: { shape: "circle", fill: "fill-foreground", stroke: "stroke-foreground", r: 15 },
  skill: { shape: "circle", fill: "fill-success", stroke: "stroke-success", r: 9 },
  gap: { shape: "ring", fill: "fill-transparent", stroke: "stroke-warning", r: 9 },
  project: { shape: "square", fill: "fill-accent", stroke: "stroke-accent", r: 9 },
  experience: { shape: "square", fill: "fill-muted", stroke: "stroke-muted", r: 9 },
  education: { shape: "diamond", fill: "fill-accent", stroke: "stroke-accent", r: 9 },
  certification: { shape: "diamond", fill: "fill-success", stroke: "stroke-success", r: 9 },
  job: { shape: "square", fill: "fill-warning", stroke: "stroke-warning", r: 10 },
  company: { shape: "circle", fill: "fill-muted", stroke: "stroke-muted", r: 7 },
  application: { shape: "diamond", fill: "fill-foreground", stroke: "stroke-foreground", r: 9 },
  outcome: { shape: "ring", fill: "fill-transparent", stroke: "stroke-accent", r: 9 },
};

const EDGE_STYLE: Record<EdgeKind, string> = {
  has: "stroke-border-strong",
  uses: "stroke-border-strong",
  requires: "stroke-success/60",
  lacks: "stroke-warning/70",
  at: "stroke-border",
  applied: "stroke-accent/60",
  outcome: "stroke-accent/60",
};

function Mark({ type, size = 1 }: { type: NodeType; size?: number }) {
  const s = STYLE[type];
  const r = s.r * size;
  const common = `${s.fill} ${s.stroke}`;
  if (s.shape === "square") {
    return (
      <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} strokeWidth={2} className={common} />
    );
  }
  if (s.shape === "diamond") {
    return (
      <rect
        x={-r * 0.8}
        y={-r * 0.8}
        width={r * 1.6}
        height={r * 1.6}
        strokeWidth={2}
        transform="rotate(45)"
        className={common}
      />
    );
  }
  return (
    <circle
      r={r}
      strokeWidth={2}
      strokeDasharray={s.shape === "ring" ? "3 2" : undefined}
      className={common}
    />
  );
}

function Swatch({ type }: { type: NodeType }) {
  return (
    <svg width={20} height={20} viewBox="-12 -12 24 24" aria-hidden="true" className="shrink-0">
      <Mark type={type} size={0.8} />
    </svg>
  );
}

const clip = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The graph as an SVG with filters, zoom and a details panel. Every node can be reached with
 * the keyboard, and the same information is available as a plain list below, so the picture is
 * never the only way to read it.
 */
export function GraphView({ graph }: { graph: LaidOutGraph }) {
  const [hidden, setHidden] = useState<Set<NodeType>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const present = useMemo(
    () =>
      NODE_TYPES.filter((t) => t !== "user").flatMap((t) => {
        const n = graph.nodes.filter((x) => x.type === t).length;
        return n > 0 ? [{ type: t, count: n }] : [];
      }),
    [graph.nodes],
  );

  const visible = useMemo(
    () => graph.nodes.filter((n) => !hidden.has(n.type)),
    [graph.nodes, hidden],
  );
  const visibleIds = useMemo(() => new Set(visible.map((n) => n.id)), [visible]);
  const edges = useMemo(
    () => graph.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to)),
    [graph.edges, visibleIds],
  );
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const focus = selected && visibleIds.has(selected) ? selected : null;
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (focus) {
      set.add(focus);
      for (const e of edges) {
        if (e.from === focus) set.add(e.to);
        if (e.to === focus) set.add(e.from);
      }
    }
    return set;
  }, [focus, edges]);

  const connections = (id: string) =>
    graph.edges.flatMap((e) =>
      e.from === id
        ? [{ edge: e, other: byId.get(e.to)!, outgoing: true }]
        : e.to === id
          ? [{ edge: e, other: byId.get(e.from)!, outgoing: false }]
          : [],
    );
  const selectedNode = focus ? byId.get(focus)! : null;

  const toggle = (type: NodeType) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="border-border bg-surface rounded-lg border p-3">
        <legend className="text-subtle px-1 font-mono text-[10px] tracking-wide uppercase">
          Show
        </legend>
        <ul className="flex flex-wrap gap-x-4 gap-y-2" data-testid="filters">
          {present.map(({ type, count }) => (
            <li key={type}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!hidden.has(type)} onChange={() => toggle(type)} />
                <Swatch type={type} />
                <span>
                  {NODE_TYPE_LABELS[type]} <span className="text-muted">({count})</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="border-border bg-surface relative overflow-hidden rounded-lg border">
          <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
            <p className="text-subtle text-xs" aria-live="polite">
              {visible.length} items, {edges.length} connections
              {focus
                ? ". Showing what is connected to your selection."
                : ". Select an item to see what connects to it."}
            </p>
            <div className="flex items-center gap-1" role="group" aria-label="Zoom">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Zoom out"
                disabled={zoom <= 1}
                onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
              >
                <Minus />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Zoom in"
                disabled={zoom >= 3}
                onClick={() => setZoom((z) => Math.min(3, z + 0.5))}
              >
                <Plus />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Reset view"
                onClick={() => {
                  setZoom(1);
                  setSelected(null);
                }}
              >
                <RotateCcw />
              </Button>
            </div>
          </div>
          <div
            className="max-h-[70vh] overflow-auto"
            tabIndex={0}
            role="region"
            aria-label="Career graph"
          >
            <svg
              viewBox={`0 0 ${graph.width} ${graph.height}`}
              style={{ width: `${zoom * 100}%`, minWidth: zoom === 1 ? undefined : "100%" }}
              className="block h-auto"
              data-testid="graph-svg"
            >
              <g>
                {edges.map((e) => {
                  const a = byId.get(e.from)!;
                  const b = byId.get(e.to)!;
                  const lit =
                    !focus ||
                    (neighbours.has(e.from) &&
                      neighbours.has(e.to) &&
                      (e.from === focus || e.to === focus));
                  return (
                    <line
                      key={`${e.from}>${e.to}>${e.kind}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      strokeWidth={lit && focus ? 2 : 1}
                      strokeDasharray={e.kind === "lacks" ? "4 3" : undefined}
                      opacity={lit ? 1 : 0.12}
                      className={EDGE_STYLE[e.kind]}
                    />
                  );
                })}
              </g>
              <g>
                {visible.map((n) => {
                  const dim = focus !== null && !neighbours.has(n.id);
                  const isSelected = n.id === focus;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x} ${n.y})`}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      aria-label={`${NODE_TYPE_LABELS[n.type]}: ${n.label}${n.detail ? `, ${n.detail}` : ""}. Press Enter to see what it connects to.`}
                      data-testid={`node-${n.type}`}
                      data-node-id={n.id}
                      opacity={dim ? 0.2 : 1}
                      className="[&:focus-visible>circle.halo]:stroke-accent cursor-pointer focus-visible:outline-none"
                      onClick={() => setSelected(isSelected ? null : n.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(isSelected ? null : n.id);
                        }
                      }}
                    >
                      <circle
                        r={STYLE[n.type].r + 7}
                        className="halo fill-transparent stroke-transparent"
                        strokeWidth={2}
                      />
                      {isSelected && (
                        <circle
                          r={STYLE[n.type].r + 5}
                          className="stroke-foreground fill-transparent"
                          strokeWidth={2}
                        />
                      )}
                      <Mark type={n.type} />
                      <text
                        y={STYLE[n.type].r + 14}
                        textAnchor="middle"
                        className="fill-foreground text-[11px]"
                        style={{
                          paintOrder: "stroke",
                          stroke: "var(--background)",
                          strokeWidth: 3,
                        }}
                      >
                        {clip(n.label)}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        </div>

        <aside
          aria-label="Selected item"
          className="border-border bg-surface rounded-lg border p-4"
          data-testid="details"
        >
          {selectedNode ? (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-subtle flex items-center gap-1.5 font-mono text-[10px] tracking-wide uppercase">
                  <Swatch type={selectedNode.type} /> {NODE_TYPE_LABELS[selectedNode.type]}
                </p>
                <h2 className="mt-1 text-sm font-semibold break-words">{selectedNode.label}</h2>
                {selectedNode.detail && (
                  <p className="text-muted text-xs break-words">{selectedNode.detail}</p>
                )}
              </div>
              <ul className="flex flex-col gap-1.5 text-sm" data-testid="connections">
                {connections(selectedNode.id).map(({ edge, other, outgoing }) => (
                  <li key={`${edge.from}>${edge.to}>${edge.kind}`} className="break-words">
                    <span className="text-muted text-xs">
                      {outgoing ? EDGE_LABELS[edge.kind] : `${EDGE_LABELS[edge.kind]} (from)`}{" "}
                    </span>
                    <button
                      type="button"
                      className="text-accent text-left hover:underline"
                      onClick={() => setSelected(other.id)}
                    >
                      {other.label}
                    </button>
                  </li>
                ))}
                {connections(selectedNode.id).length === 0 && (
                  <li className="text-muted text-xs">Nothing is connected to this yet.</li>
                )}
              </ul>
              <div className="flex flex-wrap gap-2">
                {selectedNode.href && (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={selectedNode.href} prefetch={false}>
                      Open
                    </Link>
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  Clear selection
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted text-sm">
              Select an item to see what connects to it, and where to open it. Skills with a dashed
              ring are asked for by a job on the graph and are not in your verified profile.
            </p>
          )}
        </aside>
      </div>

      <details className="border-border bg-surface rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">View as a list</summary>
        <table className="mt-3 w-full text-left text-sm" data-testid="graph-list">
          <thead>
            <tr className="text-subtle font-mono text-[10px] tracking-wide uppercase">
              <th scope="col" className="pb-1.5 font-normal">
                Item
              </th>
              <th scope="col" className="pb-1.5 font-normal">
                Kind
              </th>
              <th scope="col" className="pb-1.5 font-normal">
                Connected to
              </th>
            </tr>
          </thead>
          <tbody>
            {graph.nodes.map((n) => (
              <tr key={n.id} className="border-border border-t align-top">
                <th scope="row" className="py-1.5 font-normal break-words">
                  {n.label}
                </th>
                <td className="text-muted py-1.5">{NODE_TYPE_LABELS[n.type]}</td>
                <td className="text-muted py-1.5 break-words">
                  {connections(n.id)
                    .map((c) => c.other.label)
                    .join(", ") || "Nothing yet"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
