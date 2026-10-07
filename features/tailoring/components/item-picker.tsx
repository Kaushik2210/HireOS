import { Button } from "@/components/ui/button";
import type { PickSection } from "@/services/tailoring/pick";

/**
 * A plain GET form: what to include lives in the URL, so a choice survives a reload and
 * needs no JavaScript. Unchecked items are left out of the resume (never deleted).
 */
export function ItemPicker({
  jobId,
  sections,
  excluded,
}: {
  jobId: string;
  sections: PickSection[];
  excluded: ReadonlySet<string>;
}) {
  return (
    <form
      method="get"
      action={`/jobs/${jobId}/tailor`}
      aria-label="Choose what to include"
      className="border-border bg-surface rounded-lg border p-4"
    >
      <input type="hidden" name="f" value="1" />
      <h3 className="mb-1 text-sm font-semibold">Choose what to include</h3>
      <p className="text-muted mb-3 text-xs">
        Untick anything you want left out of this version. It stays in your profile.
      </p>
      <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
        {sections.map((section) => (
          <fieldset key={section.title} className="min-w-0">
            <legend className="text-subtle mb-1 font-mono text-[10px] tracking-wide uppercase">
              {section.title}
            </legend>
            <ul className="flex flex-col gap-1.5">
              {section.items.map((item) => (
                <li key={item.key}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="keep"
                      value={item.key}
                      defaultChecked={!excluded.has(item.key)}
                      className="mt-1"
                    />
                    <span className="break-words">{item.label}</span>
                  </label>
                  {item.bullets.length > 0 && (
                    <details className="mt-1 ml-6">
                      <summary className="text-accent cursor-pointer text-xs">
                        {item.bullets.length} bullet{item.bullets.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-1 flex flex-col gap-1">
                        {item.bullets.map((b) => (
                          <li key={b.key}>
                            <label className="flex items-start gap-2 text-xs">
                              <input
                                type="checkbox"
                                name="keep"
                                value={b.key}
                                defaultChecked={!excluded.has(b.key)}
                                className="mt-0.5"
                              />
                              <span className="text-muted break-words">{b.label}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
      <div className="mt-4">
        <Button type="submit" variant="secondary" size="sm">
          Update preview
        </Button>
      </div>
    </form>
  );
}
