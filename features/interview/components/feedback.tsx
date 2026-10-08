import { Badge } from "@/components/ui/badge";
import { BAND_TEXT, type AnswerFeedback } from "@/lib/interview/types";

const BAND_VARIANT = { needs_work: "warning", decent: "accent", strong: "success" } as const;
const BAR = { needs_work: "bg-warning", decent: "bg-accent", strong: "bg-success" } as const;

const bandFor = (score: number) => (score >= 75 ? "strong" : score >= 50 ? "decent" : "needs_work");

export function ScoreMeter({ score, name }: { score: number; name: string }) {
  return (
    <div
      role="meter"
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      className="bg-border h-1.5 w-full overflow-hidden rounded-full"
    >
      <div
        className={`h-full rounded-full ${BAR[bandFor(score)]}`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

/** Feedback for one answer: the overall score, then each dimension with the inputs it used. */
export function FeedbackView({ feedback }: { feedback: AnswerFeedback }) {
  return (
    <div className="flex flex-col gap-4" data-testid="feedback">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums" data-testid="answer-score">
            {feedback.overall}
          </span>
          <span className="text-subtle text-sm"> / 100</span>
        </p>
        <Badge variant={BAND_VARIANT[feedback.band]}>{BAND_TEXT[feedback.band]}</Badge>
      </div>
      <p className="text-subtle text-xs">
        This scores how the answer is built. It cannot tell whether a technical answer is correct,
        and it says nothing about how an interviewer would react.
      </p>
      <ul className="flex flex-col gap-4">
        {feedback.dimensions.map((d) => (
          <li key={d.id} data-testid={`dimension-${d.id}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{d.label}</span>
              <span className="text-muted font-mono text-xs tabular-nums">
                {d.applicable ? `${d.score} / 100` : "Not scored"}
              </span>
            </div>
            {d.applicable && d.score !== null && (
              <ScoreMeter score={d.score} name={`${d.label}: ${d.score} out of 100`} />
            )}
            <p className="text-muted mt-1.5 text-xs">{d.summary}</p>
            {d.inputs.length > 0 && (
              <details className="mt-1">
                <summary className="text-accent cursor-pointer text-xs">
                  What this looked at
                </summary>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[11rem_1fr]">
                  {d.inputs.map((input) => (
                    <div key={input.label} className="contents">
                      <dt className="text-subtle">{input.label}</dt>
                      <dd className="break-words">{input.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </li>
        ))}
      </ul>
      {feedback.improve.length > 0 && (
        <div className="border-border rounded-lg border p-3">
          <h4 className="mb-1.5 text-sm font-semibold">What could help most</h4>
          <ul className="text-muted list-disc space-y-1.5 pl-5 text-sm" data-testid="improve">
            {feedback.improve.map((tip) => (
              <li key={tip} className="break-words">
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
