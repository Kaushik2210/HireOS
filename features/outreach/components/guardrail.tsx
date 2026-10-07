import { ShieldCheck } from "lucide-react";

/** The standing promise on every outreach page: words only, sent by the person. */
export function Guardrail() {
  return (
    <p className="border-border text-muted flex items-start gap-2 rounded-lg border p-3 text-xs">
      <ShieldCheck className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        HireOS only writes drafts. It never connects to LinkedIn or your email, and never sends,
        scrapes, connects or messages anyone for you. You copy a draft and send it yourself.
        Everything it says about you comes from your verified profile.
      </span>
    </p>
  );
}
