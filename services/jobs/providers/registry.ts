import { DEMO_PROVIDERS } from "@/services/jobs/providers/demo";
import type { JobProvider, JobSourceInfo } from "@/services/jobs/providers/types";

/**
 * Providers the platform can ingest from. Only the bundled demo sources exist today.
 *
 * No third-party job feed is enabled on purpose. Public job-board endpoints are documented
 * for a company's own careers page, not for reuse by an aggregator, so each real source must
 * be reviewed and added one at a time with a stated terms basis (see ROADMAP.md).
 */
export const PROVIDERS: readonly JobProvider[] = [...DEMO_PROVIDERS];

/** Sources a user can add jobs under without a provider: pasted by hand. */
export const MANUAL_SOURCE: JobSourceInfo = {
  key: "manual",
  name: "Added by you",
  kind: "manual",
  termsNote: "Text the user pasted in. Nothing is fetched.",
};

export const ALL_SOURCES: readonly JobSourceInfo[] = [
  ...PROVIDERS.map((p) => p.source),
  MANUAL_SOURCE,
];
