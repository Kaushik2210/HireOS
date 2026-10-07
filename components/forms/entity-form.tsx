"use client";

import { useState } from "react";
import { Controller } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { FormField, FormMessage, Input, Select, Textarea } from "@/components/ui/form-field";
import type { FieldDef } from "@/components/forms/field-types";
import { ListField } from "@/components/forms/list-field";
import { useActionForm } from "@/hooks/use-action-form";
import type { ActionResult } from "@/lib/action-result";
import { SKILL_CATALOG, findCatalogSkill } from "@/lib/skills/catalog";

type Values = Record<string, unknown>;

/** Null becomes "" so inputs stay controlled-friendly; the schema turns "" back into null. */
export function toFormValues(
  fields: FieldDef[],
  defaults: Values,
  item?: Record<string, unknown>,
): Values {
  const values: Values = { ...defaults };
  for (const field of fields) {
    const raw = item ? item[field.name] : defaults[field.name];
    if (field.kind === "list" || field.kind === "checkboxes") values[field.name] = raw ?? [];
    else if (field.kind === "checkbox") values[field.name] = Boolean(raw);
    else values[field.name] = raw ?? "";
  }
  return values;
}

interface EntityFormProps {
  idPrefix: string;
  fields: FieldDef[];
  schema: z.ZodType;
  values: Values;
  submitLabel: string;
  onSubmit: (values: Values) => Promise<ActionResult>;
  onDone: () => void;
  onDelete?: () => Promise<ActionResult>;
  /** Enables skill-name suggestions and automatic category selection. */
  skillHints?: boolean;
}

const FULL_WIDTH = new Set(["textarea", "list", "checkboxes", "checkbox"]);

export function EntityForm({
  idPrefix,
  fields,
  schema,
  values,
  submitLabel,
  onSubmit,
  onDone,
  onDelete,
  skillHints,
}: EntityFormProps) {
  const {
    form,
    onSubmit: submit,
    pending,
    formError,
  } = useActionForm(schema as z.ZodType<Values, Values>, onSubmit, values, onDone);
  const { register, control, formState, setValue, getFieldState } = form;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!onDelete) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await onDelete();
    setDeleting(false);
    if (result.ok) onDone();
    else setDeleteError(result.error);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `${idPrefix}-${field.name}`;
          const error = formState.errors[field.name]?.message as string | undefined;
          const span = FULL_WIDTH.has(field.kind) ? "sm:col-span-2" : undefined;

          if (field.kind === "checkbox") {
            return (
              <label key={field.name} className={`flex items-center gap-2 text-sm ${span}`}>
                <input type="checkbox" className="accent-accent size-4" {...register(field.name)} />
                {field.label}
              </label>
            );
          }

          if (field.kind === "checkboxes") {
            return (
              <fieldset key={field.name} className={`flex flex-col gap-1.5 ${span}`}>
                <legend className="mb-1.5 text-sm font-medium">{field.label}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {field.options.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        value={option.value}
                        className="accent-accent size-4"
                        {...register(field.name)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                {error && (
                  <p role="alert" className="text-danger text-xs">
                    {error}
                  </p>
                )}
              </fieldset>
            );
          }

          return (
            <div key={field.name} className={span}>
              <FormField id={id} label={field.label} hint={field.hint} error={error}>
                {(a11y) => {
                  switch (field.kind) {
                    case "textarea":
                      return (
                        <Textarea
                          {...a11y}
                          rows={field.rows}
                          placeholder={field.placeholder}
                          {...register(field.name)}
                        />
                      );
                    case "select":
                      return (
                        <Select
                          {...a11y}
                          {...register(field.name, {
                            setValueAs: (v) => (v === "" && field.allowEmpty ? null : v),
                          })}
                        >
                          {field.allowEmpty && <option value="">Not set</option>}
                          {field.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      );
                    case "list":
                      return (
                        <Controller
                          control={control}
                          name={field.name}
                          render={({ field: f }) => (
                            <ListField
                              {...a11y}
                              mode={field.mode}
                              value={(f.value as string[]) ?? []}
                              onChange={f.onChange}
                            />
                          )}
                        />
                      );
                    case "number":
                      return (
                        <Input
                          {...a11y}
                          type="number"
                          step="any"
                          inputMode="decimal"
                          {...register(field.name, {
                            setValueAs: (v) => (v === "" || v == null ? null : Number(v)),
                          })}
                        />
                      );
                    case "month":
                      return (
                        <Input
                          {...a11y}
                          type="month"
                          placeholder={field.placeholder}
                          {...register(field.name)}
                        />
                      );
                    default: {
                      const isSkillName = skillHints && field.name === "name";
                      const reg = register(field.name);
                      return (
                        <Input
                          {...a11y}
                          type="text"
                          placeholder={field.placeholder}
                          list={isSkillName ? `${idPrefix}-skill-suggestions` : undefined}
                          autoComplete="off"
                          {...reg}
                          onBlur={(e) => {
                            void reg.onBlur(e);
                            if (isSkillName && !getFieldState("type").isDirty) {
                              const hit = findCatalogSkill(e.target.value);
                              if (hit) setValue("type", hit.type);
                            }
                          }}
                        />
                      );
                    }
                  }
                }}
              </FormField>
            </div>
          );
        })}
      </div>

      {skillHints && (
        <datalist id={`${idPrefix}-skill-suggestions`}>
          {SKILL_CATALOG.map((s) => (
            <option key={s.slug} value={s.name} />
          ))}
        </datalist>
      )}

      {deleteError && <FormMessage tone="error">{deleteError}</FormMessage>}

      <div className="flex items-center justify-between gap-2 pt-2">
        <div>
          {onDelete &&
            (confirmingDelete ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={remove}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Confirm delete"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            ))}
        </div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
