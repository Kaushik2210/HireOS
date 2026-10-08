// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { buildDemoApplications } from "@/db/applications/demo-seed";
import { MemoryJobStore } from "@/db/jobs/memory-store";
import { MemoryProfileStore } from "@/db/profile/memory-store";
import { DEMO_PERSONAS } from "@/db/seed/demo-personas";
import { MAX_GRAPH_JOBS, MAX_NODES, MAX_SKILLS_PER_JOB, NODE_TYPES } from "@/lib/graph/types";
import { DEFAULT_JOB_QUERY, type Job } from "@/lib/jobs/schemas";
import { buildCareerGraph } from "@/services/graph/build";
import { GRAPH_HEIGHT, GRAPH_WIDTH, layoutGraph } from "@/services/graph/layout";
import { NOW, makeJob, snapshotFrom } from "../fixtures/matching";

const jobs: Job[] = [];
beforeAll(async () => {
  const store = new MemoryJobStore();
  for (let page = 1; page <= 3; page++) {
    jobs.push(...(await store.search("x", { ...DEFAULT_JOB_QUERY, page })).jobs);
  }
});

const persona = (id: string) => new MemoryProfileStore(id).getSnapshot("u");
let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

describe("buildCareerGraph", () => {
  it("puts the person at the centre of what they have verified", async () => {
    const snap = await persona("asha");
    const g = buildCareerGraph({ snapshot: snap, applications: [], jobs: [], now: NOW });
    const types = new Set(g.nodes.map((n) => n.type));
    for (const t of [
      "user",
      "skill",
      "project",
      "experience",
      "education",
      "certification",
    ] as const) {
      expect(types.has(t), t).toBe(true);
    }
    const user = g.nodes.find((n) => n.type === "user")!;
    expect(user.label).toBe(snap.profile!.full_name);
    // The person is joined to every project, role, degree and certification.
    for (const n of g.nodes.filter((x) =>
      ["project", "experience", "education", "certification"].includes(x.type),
    )) {
      expect(
        g.edges.some((e) => e.from === user.id && e.to === n.id && e.kind === "has"),
        n.label,
      ).toBe(true);
    }
  });

  it("joins projects and roles to the skills they used", async () => {
    const snap = await persona("asha");
    const g = buildCareerGraph({ snapshot: snap, applications: [], jobs: [], now: NOW });
    const project = g.nodes.find((n) => n.label === "Campus Placement Tracker")!;
    const used = g.edges
      .filter((e) => e.from === project.id && e.kind === "uses")
      .map((e) => g.nodes.find((n) => n.id === e.to)!.label);
    expect(used).toEqual(expect.arrayContaining(["Django", "PostgreSQL", "Python"]));
  });

  it("only draws verified items", async () => {
    const snap = await snapshotFrom({
      skills: [
        ["Python", "advanced"],
        ["Docker", "advanced", false],
      ],
      projects: [
        { name: "Verified App", tech: ["Python"] },
        { name: "Pending App", tech: ["Docker"], confirmed: false },
      ],
    });
    const g = buildCareerGraph({ snapshot: snap, applications: [], jobs: [], now: NOW });
    const labels = g.nodes.map((n) => n.label);
    expect(labels).toContain("Verified App");
    expect(labels).not.toContain("Pending App");
    expect(labels).not.toContain("Docker");
  });

  it("draws a job, its company and the skills it asks for, marking the ones you lack as gaps", async () => {
    const snap = await persona("asha");
    const job = jobs.find(
      (j) => j.title === "Backend Engineer" && j.company_name === "Helix Ledger",
    )!;
    const g = buildCareerGraph({ snapshot: snap, applications: [], jobs: [job], now: NOW });
    const jobNode = g.nodes.find((n) => n.id === `job:${job.id}`)!;
    expect(jobNode.href).toBe(`/jobs/${job.id}`);
    const out = (kind: string) =>
      g.edges
        .filter((e) => e.from === jobNode.id && e.kind === kind)
        .map((e) => g.nodes.find((n) => n.id === e.to)!);
    expect(out("at").map((n) => n.label)).toEqual(["Helix Ledger"]);
    expect(out("requires").map((n) => n.label)).toEqual(
      expect.arrayContaining(["Python", "Django"]),
    );
    expect(out("requires").every((n) => n.type === "skill")).toBe(true);
    const gaps = out("lacks");
    expect(gaps.map((n) => n.label)).toEqual(expect.arrayContaining(["Docker", "CI/CD"]));
    expect(gaps.every((n) => n.type === "gap" && n.detail === "not in your verified profile")).toBe(
      true,
    );
    // A gap is not something you have.
    expect(g.edges.some((e) => e.from === "user:you" && e.to.startsWith("gap:"))).toBe(false);
  });

  it("shares a company and a skill node between jobs, and limits how many jobs and skills are drawn", async () => {
    const snap = await persona("asha");
    const many = Array.from({ length: 20 }, (_, i) =>
      makeJob({
        id: id(),
        title: `Role ${i}`,
        company_name: "Same Co",
        required_skills: ["Python", "SQL", "Docker", "Redis", "Kafka", "Go", "Rust", "Swift"],
      }),
    );
    const g = buildCareerGraph({ snapshot: snap, applications: [], jobs: many, now: NOW });
    expect(g.nodes.filter((n) => n.type === "job")).toHaveLength(MAX_GRAPH_JOBS);
    expect(g.nodes.filter((n) => n.type === "company")).toHaveLength(1);
    const skillEdges = g.edges.filter(
      (e) => e.from === `job:${many[0]!.id}` && (e.kind === "requires" || e.kind === "lacks"),
    );
    expect(skillEdges).toHaveLength(MAX_SKILLS_PER_JOB);
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length);
  });

  it("draws applications joined to their job and to how they ended", async () => {
    const snap = await persona("asha");
    const jobList = jobs.slice(0, 40);
    const apps = buildDemoApplications(jobList, NOW, id).map((b) => b.application);
    const tracked = apps.map((a) => jobList.find((j) => j.id === a.jobId)!);
    const g = buildCareerGraph({ snapshot: snap, applications: apps, jobs: tracked, now: NOW });
    expect(g.nodes.filter((n) => n.type === "application")).toHaveLength(apps.length);
    const outcomes = g.nodes
      .filter((n) => n.type === "outcome")
      .map((n) => n.label)
      .sort();
    expect(outcomes).toEqual(
      [
        ...new Set(
          apps.map(
            (a) =>
              (
                ({
                  interview: "Interview",
                  applied: "Applied",
                  shortlisted: "Shortlisted",
                  rejected: "Rejected",
                  discovered: "Discovered",
                }) as Record<string, string>
              )[a.status]!,
          ),
        ),
      ].sort(),
    );
    for (const a of apps) {
      const node = `application:${a.id}`;
      expect(g.edges.some((e) => e.from === node && e.kind === "outcome")).toBe(true);
      expect(
        g.edges.some((e) => e.from === node && e.kind === "applied" && e.to === `job:${a.jobId}`),
      ).toBe(true);
      expect(g.edges.some((e) => e.from === "user:you" && e.to === node)).toBe(true);
    }
  });

  it("never has an edge to a node that is not there, a duplicate edge, or a self-loop", async () => {
    for (const p of DEMO_PERSONAS) {
      const snap = await persona(p.id);
      const apps = buildDemoApplications(jobs, NOW, id).map((b) => b.application);
      const g = buildCareerGraph({
        snapshot: snap,
        applications: apps,
        jobs: jobs.slice(0, 20),
        now: NOW,
      });
      const ids = new Set(g.nodes.map((n) => n.id));
      const seen = new Set<string>();
      for (const e of g.edges) {
        expect(ids.has(e.from) && ids.has(e.to), `${p.id} ${e.from} > ${e.to}`).toBe(true);
        expect(e.from).not.toBe(e.to);
        const key = `${e.from}>${e.to}>${e.kind}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      for (const n of g.nodes) expect(NODE_TYPES).toContain(n.type);
    }
  });

  it("trims the least connected skills when it would be too big, and says so", async () => {
    const skills = Array.from(
      { length: 200 },
      (_, i) => [`Custom Skill ${i}`, "beginner"] as [string, "beginner"],
    );
    const snap = await snapshotFrom({ skills });
    const g = buildCareerGraph({ snapshot: snap, applications: [], jobs: [], now: NOW });
    expect(g.nodes.length).toBeLessThanOrEqual(MAX_NODES);
    expect(g.trimmed).toBe(true);
    expect(
      g.edges.every(
        (e) => g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to),
      ),
    ).toBe(true);
    expect(
      buildCareerGraph({ snapshot: await persona("asha"), applications: [], jobs: [], now: NOW })
        .trimmed,
    ).toBe(false);
  });

  it("is deterministic and handles an empty profile", async () => {
    const snap = await persona("meera");
    const a = buildCareerGraph({
      snapshot: snap,
      applications: [],
      jobs: jobs.slice(0, 5),
      now: NOW,
    });
    expect(
      buildCareerGraph({ snapshot: snap, applications: [], jobs: jobs.slice(0, 5), now: NOW }),
    ).toEqual(a);
    const empty = buildCareerGraph({
      snapshot: await snapshotFrom({}),
      applications: [],
      jobs: [],
      now: NOW,
    });
    expect(empty.nodes.map((n) => n.type)).toEqual(["user"]);
  });
});

describe("layoutGraph", () => {
  async function sample() {
    const snap = await persona("asha");
    const apps = buildDemoApplications(jobs, NOW, id).map((b) => b.application);
    return buildCareerGraph({
      snapshot: snap,
      applications: apps,
      jobs: jobs.slice(0, 12),
      now: NOW,
    });
  }

  it("gives every node a finite place inside the canvas, and keeps the edges", async () => {
    const graph = await sample();
    const laid = layoutGraph(graph);
    expect(laid.nodes).toHaveLength(graph.nodes.length);
    expect(laid.edges).toEqual(graph.edges);
    for (const n of laid.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y), n.id).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(GRAPH_WIDTH);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(GRAPH_HEIGHT);
    }
  });

  it("is deterministic: the same graph always lands in the same place", async () => {
    const graph = await sample();
    expect(layoutGraph(graph)).toEqual(layoutGraph(graph));
  });

  it("never puts two nodes on top of each other", async () => {
    const laid = layoutGraph(await sample());
    let closest = Infinity;
    for (let i = 0; i < laid.nodes.length; i++) {
      for (let j = i + 1; j < laid.nodes.length; j++) {
        closest = Math.min(
          closest,
          Math.hypot(laid.nodes[i]!.x - laid.nodes[j]!.x, laid.nodes[i]!.y - laid.nodes[j]!.y),
        );
      }
    }
    expect(closest).toBeGreaterThan(30);
  });

  it("keeps the person near the middle of the picture", async () => {
    const laid = layoutGraph(await sample());
    const user = laid.nodes.find((n) => n.type === "user")!;
    expect(Math.abs(user.x - GRAPH_WIDTH / 2)).toBeLessThan(GRAPH_WIDTH * 0.2);
    expect(Math.abs(user.y - GRAPH_HEIGHT / 2)).toBeLessThan(GRAPH_HEIGHT * 0.2);
  });

  it("pulls connected nodes closer than unconnected ones, on average", async () => {
    const laid = layoutGraph(await sample());
    const at = new Map(laid.nodes.map((n) => [n.id, n]));
    const linked = laid.edges.map((e) =>
      Math.hypot(at.get(e.from)!.x - at.get(e.to)!.x, at.get(e.from)!.y - at.get(e.to)!.y),
    );
    let all = 0;
    let pairs = 0;
    for (let i = 0; i < laid.nodes.length; i++)
      for (let j = i + 1; j < laid.nodes.length; j++) {
        all += Math.hypot(laid.nodes[i]!.x - laid.nodes[j]!.x, laid.nodes[i]!.y - laid.nodes[j]!.y);
        pairs++;
      }
    expect(linked.reduce((a, b) => a + b, 0) / linked.length).toBeLessThan(all / pairs);
  });

  it("handles a graph of one node and an empty graph", () => {
    const one = layoutGraph({
      nodes: [{ id: "user:you", type: "user", label: "You", detail: null, href: null }],
      edges: [],
      trimmed: false,
    });
    expect(one.nodes).toHaveLength(1);
    expect(Number.isFinite(one.nodes[0]!.x)).toBe(true);
    expect(layoutGraph({ nodes: [], edges: [], trimmed: false }).nodes).toEqual([]);
  });
});
