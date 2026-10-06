"use client";

import { ExternalLink, Pencil, Plus } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteItemAction, saveItemAction } from "@/features/profile/actions";
import { EntityDialog } from "@/features/profile/components/entity-dialog";
import { EntityForm, toFormValues } from "@/features/profile/components/entity-form";
import { SECTIONS, type ItemSummary } from "@/features/profile/config";
import { SKILL_TYPES, SKILL_TYPE_LABELS } from "@/lib/profile/constants";
import type { CollectionEntity, CollectionItem } from "@/lib/profile/schemas";

type AnyItem = CollectionItem<CollectionEntity>;

function ItemDialog({
  entity,
  item,
  trigger,
}: {
  entity: CollectionEntity;
  item?: AnyItem;
  trigger: React.ReactNode;
}) {
  const config = SECTIONS[entity];
  const editing = Boolean(item);
  return (
    <EntityDialog
      title={editing ? `Edit ${config.singular}` : `Add ${config.singular}`}
      trigger={trigger}
    >
      {(close) => (
        <EntityForm
          idPrefix={`${entity}-${item?.id ?? "new"}`}
          fields={config.fields}
          schema={config.schema}
          values={toFormValues(
            config.fields,
            config.defaults,
            item as unknown as Record<string, unknown> | undefined,
          )}
          submitLabel={editing ? "Save changes" : "Add"}
          skillHints={entity === "skills"}
          onSubmit={(values) => saveItemAction(entity, item?.id ?? null, values)}
          onDelete={item ? () => deleteItemAction(entity, item.id) : undefined}
          onDone={close}
        />
      )}
    </EntityDialog>
  );
}

function ItemCard({ entity, item }: { entity: CollectionEntity; item: AnyItem }) {
  const summary: ItemSummary = (SECTIONS[entity].summarize as (i: AnyItem) => ItemSummary)(item);
  return (
    <li className="border-border bg-surface-raised rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium">{summary.title}</h4>
          {summary.subtitle && <p className="text-muted text-sm">{summary.subtitle}</p>}
          {summary.meta && <p className="text-subtle mt-0.5 text-xs">{summary.meta}</p>}
        </div>
        <ItemDialog
          entity={entity}
          item={item}
          trigger={
            <Button variant="ghost" size="icon" aria-label={`Edit ${summary.title}`} title="Edit">
              <Pencil />
            </Button>
          }
        />
      </div>
      {summary.description && <p className="text-muted mt-2 text-sm">{summary.description}</p>}
      {summary.bullets && summary.bullets.length > 0 && (
        <ul className="text-muted mt-2 list-disc space-y-1 pl-5 text-sm">
          {summary.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      )}
      {summary.chips && summary.chips.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Technologies">
          {summary.chips.map((chip) => (
            <li key={chip}>
              <Badge>{chip}</Badge>
            </li>
          ))}
        </ul>
      )}
      {summary.link && (
        <a
          href={summary.link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent mt-3 inline-flex items-center gap-1 text-xs hover:underline"
        >
          {summary.link.label}
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      )}
    </li>
  );
}

function SkillGroups({ items }: { items: CollectionItem<"skills">[] }) {
  return (
    <div className="flex flex-col gap-4">
      {SKILL_TYPES.map((type) => {
        const group = items.filter((s) => s.type === type);
        if (group.length === 0) return null;
        return (
          <div key={type}>
            <h4 className="text-subtle mb-2 font-mono text-[10px] tracking-wide uppercase">
              {SKILL_TYPE_LABELS[type]}
            </h4>
            <ul className="flex flex-wrap gap-2">
              {group.map((skill) => (
                <li key={skill.id}>
                  <ItemDialog
                    entity="skills"
                    item={skill as AnyItem}
                    trigger={
                      <button
                        type="button"
                        title={`${skill.level}${skill.years !== null ? `, ${skill.years} years` : ""}. Click to edit.`}
                        className="border-border-strong bg-surface-raised hover:bg-surface-hover rounded-md border px-2.5 py-1 text-sm transition-colors"
                      >
                        {skill.name}
                        <span className="text-subtle ml-1.5 text-xs">{skill.level}</span>
                      </button>
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function CollectionSection({
  entity,
  items,
}: {
  entity: CollectionEntity;
  items: AnyItem[];
}) {
  const config = SECTIONS[entity];
  const addButton = (
    <Button variant="secondary" size="sm">
      <Plus /> Add
    </Button>
  );

  return (
    <section
      id={entity}
      aria-labelledby={`${entity}-heading`}
      className="border-border bg-surface scroll-mt-20 rounded-lg border p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 id={`${entity}-heading`} className="text-sm font-semibold">
            {config.title}
            <span className="text-subtle ml-2 font-mono text-xs font-normal">{items.length}</span>
          </h3>
          <p className="text-muted mt-1 text-sm">{config.description}</p>
        </div>
        {items.length > 0 && (
          <ItemDialog
            entity={entity}
            trigger={
              <Button variant="secondary" size="sm" aria-label={`Add ${config.singular}`}>
                <Plus /> Add
              </Button>
            }
          />
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Plus}
          title={config.emptyTitle}
          description={config.emptyDescription}
          action={<ItemDialog entity={entity} trigger={addButton} />}
        />
      ) : entity === "skills" ? (
        <SkillGroups items={items as CollectionItem<"skills">[]} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <ItemCard key={item.id} entity={entity} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
