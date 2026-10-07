import { DEMO_AGGREGATOR_JOBS, DEMO_BOARD_JOBS } from "@/db/seed/demo-jobs";
import type { JobProvider } from "@/services/jobs/providers/types";

/** A fictional careers board. Static data, no network. */
export const demoBoardProvider: JobProvider = {
  source: {
    key: "demo",
    name: "Demo Careers Board",
    kind: "demo",
    termsNote: "Fictional data bundled with HireOS. No network access.",
  },
  fetchJobs: async () => DEMO_BOARD_JOBS,
};

/** A fictional aggregator that repeats some board jobs, so de-duplication is visible. */
export const demoAggregatorProvider: JobProvider = {
  source: {
    key: "demo-aggregator",
    name: "Demo Job Aggregator",
    kind: "demo",
    termsNote: "Fictional data bundled with HireOS. No network access.",
  },
  fetchJobs: async () => DEMO_AGGREGATOR_JOBS,
};

export const DEMO_PROVIDERS: readonly JobProvider[] = [demoBoardProvider, demoAggregatorProvider];
