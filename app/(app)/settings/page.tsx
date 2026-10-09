import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteAccountForm } from "@/features/account/components/delete-account-form";
import { ExportButton } from "@/features/account/components/export-button";
import { signOutEverywhereAction } from "@/features/account/actions";
import { requireUser } from "@/lib/auth/session";
import { describeSecurityEvent, loadSecurityEvents } from "@/services/account/security-events";

export const metadata: Metadata = { title: "Privacy & Data" };
export const dynamic = "force-dynamic";

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

function Section({
  title,
  children,
  tone = "default",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section
      aria-label={title}
      className={`rounded-lg border p-5 ${tone === "danger" ? "border-danger/40" : "border-border"} bg-surface`}
    >
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const events = await loadSecurityEvents(user);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Privacy &amp; Data</h1>
        <p className="text-muted mt-1 text-sm">
          What HireOS keeps about you, and the controls to take it with you or remove it.
        </p>
      </div>

      {user.isDemo && (
        <p className="border-accent/30 bg-accent-soft text-muted rounded-lg border p-3 text-sm">
          <Badge variant="accent" className="mr-2">
            Demo mode
          </Badge>
          You are using a temporary sandbox with sample data, not an account. Nothing here is kept
          after the server restarts.
        </p>
      )}

      <Section title="Download your data">
        <p className="text-muted">
          One JSON file with your profile, resume analyses, jobs you added, tailored documents,
          outreach drafts, applications and their history, interviews, practice sessions and your
          security activity. Original resume files are downloaded one at a time from the Resume
          page.
        </p>
        <ExportButton />
      </Section>

      <Section title="What is kept, and where">
        <ul className="text-muted flex list-disc flex-col gap-1.5 pl-5">
          <li>
            Everything you add is stored under your account and readable only by you. Access is
            enforced in the database, not only in the app.
          </li>
          <li>Resume files are in a private store and never served from this site.</li>
          <li>
            Job postings and resume text are treated as data to read, never as instructions, and
            nothing is sent to anyone: HireOS does not apply, message or email on your behalf.
          </li>
          <li>
            No AI service is called today. If one is added, this page will say what is sent to it.
          </li>
          <li>
            The security log below records the kind of event and the time, never your password,
            email address or any of your content.
          </li>
        </ul>
      </Section>

      {!user.isDemo && (
        <>
          <Section title="Security activity">
            {events.length === 0 ? (
              <p className="text-muted">Nothing recorded yet.</p>
            ) : (
              <ul className="divide-border divide-y" data-testid="security-events">
                {events.map((event, i) => (
                  <li key={`${event.created_at}-${i}`} className="flex justify-between gap-4 py-2">
                    <span
                      className={
                        event.action === "auth.sign_in_failed" ? "text-warning" : undefined
                      }
                    >
                      {describeSecurityEvent(event.action)}
                    </span>
                    <time dateTime={event.created_at} className="text-muted shrink-0">
                      {formatTime(event.created_at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Sessions">
            <p className="text-muted">
              Signed in somewhere you no longer use, or on a shared computer? This ends every
              session on every device, including this one.
            </p>
            <form action={signOutEverywhereAction}>
              <Button type="submit">Sign out everywhere</Button>
            </form>
            <p className="text-muted">
              Two-step sign-in <Badge className="ml-1">Planned</Badge>
            </p>
          </Section>

          <Section title="Delete your account" tone="danger">
            <p className="text-muted">
              This permanently deletes your account and everything stored with it: profile, resumes
              and their files, jobs you added, documents, drafts, applications, interviews and
              practice. It cannot be undone. Download your data first if you want a copy.
            </p>
            <DeleteAccountForm />
          </Section>
        </>
      )}
    </div>
  );
}
