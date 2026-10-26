"use client";

/**
 * "People at this organization": used on the organization form, in the "+ New" organization dialog, and in the
 * "Add people" form on the organization page. Pick existing contacts (type to search) and add new people in rows.
 * Sends one hidden field (__org_people, JSON); saving links the chosen contacts and unlinks removed ones
 * (the contact is kept). Logic: src/lib/org-people.ts.
 */
import { useId, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { cleanDraft, ORG_PEOPLE_FIELD, type NewPerson } from "@/lib/org-people";
import { filterOptions } from "@/lib/quick-create";
import { RELATIONSHIP_GROUP_OPTIONS } from "@/lib/resources";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldGrid, FormField } from "@/components/ui/form-field";
import { Notice } from "@/components/app/page-header";
import { GuardedForm } from "@/components/app/unsaved-changes";
import { SubmitButton } from "@/components/app/submit-button";
import { addOrgPeople } from "@/app/actions/people";
import { cn } from "@/lib/utils";

export type PersonOption = { id: string; label: string; extra?: Record<string, unknown> };

const blank = (): NewPerson => ({ name: "", email: "", phone: "", title: "", relationship_group: "" });

export function OrgPeopleEditor({
  contacts,
  organizations = {},
  organizationId,
  initialLinked = [],
  addOnly = false,
  compact = false,
  excludeGroups = [],
}: {
  /** Every contact (for the search). */
  contacts: PersonOption[];
  /** Organization names by id, to show where a contact works now. */
  organizations?: Record<string, string>;
  organizationId?: string | null;
  /** Contacts linked when the form opened. */
  initialLinked?: string[];
  /** Organization page: only adding (people already linked are listed on the page with Unlink). */
  addOnly?: boolean;
  /** Narrow layout (dialog): two fields per row. */
  compact?: boolean;
  /** Relationship groups not available yet (before database update 0012). */
  excludeGroups?: string[];
}) {
  const [linked, setLinked] = useState<string[]>(initialLinked);
  const [added, setAdded] = useState<NewPerson[]>([blank()]);
  const [initialJson] = useState(() => JSON.stringify(cleanDraft({ linked: initialLinked, added: [] })));
  const byId = useMemo(() => Object.fromEntries(contacts.map((c) => [c.id, c])), [contacts]);
  const groups = RELATIONSHIP_GROUP_OPTIONS.filter((g) => !excludeGroups.includes(g.value));
  const value = JSON.stringify(cleanDraft({ linked, added }));
  const where = (c: PersonOption | undefined) => {
    const org = c?.extra?.organization_id as string | undefined;
    return org && org !== organizationId ? organizations[org] ?? null : null;
  };
  const choosable = contacts.filter((c) => !linked.includes(c.id) && (!addOnly || c.extra?.organization_id !== organizationId || !organizationId));
  const update = (i: number, patch: Partial<NewPerson>) => setAdded((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const uid = useId();

  return (
    <div className="flex flex-col gap-4" data-testid="org-people">
      <input type="hidden" name={ORG_PEOPLE_FIELD} value={value} data-initial={addOnly ? JSON.stringify(cleanDraft({ linked: [], added: [] })) : initialJson} />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-slate-800">{addOnly ? "Add an existing contact" : initialLinked.length ? "Existing contacts" : "Add existing contacts"}</p>
        {linked.length ? (
          <ul className="flex flex-col divide-y divide-slate-100 rounded-md border border-border">
            {linked.map((id) => {
              const c = byId[id];
              const other = where(c);
              return (
                <li key={id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="min-w-0">
                    <span className="clamp-1 font-medium text-slate-900">{c?.label ?? "Contact"}</span>
                    {other ? <span className="clamp-1 text-xs text-amber-800">Moves here from {other}</span> : null}
                  </span>
                  <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => setLinked((l) => l.filter((x) => x !== id))} aria-label={`Remove ${c?.label ?? "contact"}`}>
                    <X /> {initialLinked.includes(id) ? "Unlink" : "Remove"}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <ContactSearch id={`${uid}-search`} options={choosable} where={where} onChoose={(id) => setLinked((l) => [...l, id])} />
        {!addOnly && initialLinked.length ? <p className="text-xs text-muted-foreground">Unlink removes the person from this organization only. The contact is kept.</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-slate-800">New people</p>
        {added.map((p, i) => (
          <div key={i} className="rounded-md border border-border bg-slate-50/60 px-3 pt-3" data-testid="new-person-row">
            <FieldGrid cols={compact ? 2 : 3}>
              <FormField label="Name" htmlFor={`${uid}-n${i}`}>
                <Input id={`${uid}-n${i}`} value={p.name} onChange={(e) => update(i, { name: e.target.value })} aria-label={`New person ${i + 1}: name`} />
              </FormField>
              <FormField label="Email" htmlFor={`${uid}-e${i}`}>
                <Input id={`${uid}-e${i}`} type="email" value={p.email} onChange={(e) => update(i, { email: e.target.value })} aria-label={`New person ${i + 1}: email`} />
              </FormField>
              <FormField label="Phone" htmlFor={`${uid}-p${i}`}>
                <Input id={`${uid}-p${i}`} value={p.phone} onChange={(e) => update(i, { phone: e.target.value })} aria-label={`New person ${i + 1}: phone`} />
              </FormField>
              <FormField label="Job title or role there" htmlFor={`${uid}-t${i}`}>
                <Input id={`${uid}-t${i}`} value={p.title} onChange={(e) => update(i, { title: e.target.value })} aria-label={`New person ${i + 1}: title`} />
              </FormField>
              <FormField label="Relationship group" htmlFor={`${uid}-g${i}`}>
                <NativeSelect id={`${uid}-g${i}`} value={p.relationship_group} onChange={(e) => update(i, { relationship_group: e.target.value })} aria-label={`New person ${i + 1}: relationship group`}>
                  <option value="">Choose</option>
                  {groups.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={<span className="sr-only">Remove row</span>}>
                <Button
                  type="button"
                  variant="ghost"
                  className="justify-self-start"
                  onClick={() => setAdded((rows) => (rows.length === 1 ? [blank()] : rows.filter((_, j) => j !== i)))}
                  aria-label={`Remove new person ${i + 1}`}
                >
                  <X /> Remove row
                </Button>
              </FormField>
            </FieldGrid>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setAdded((rows) => [...rows, blank()])}>
          <Plus /> Add another person
        </Button>
        <p className="text-xs text-muted-foreground">Rows left empty are skipped. Each new person is saved as a contact at this organization.</p>
      </div>
    </div>
  );
}

/** Type to search contacts; choosing one adds it to the list above. */
function ContactSearch({ id, options, where, onChoose }: { id: string; options: PersonOption[]; where: (c: PersonOption) => string | null; onChoose: (id: string) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const shown = filterOptions(options, text).slice(0, 50);
  const choose = (o: PersonOption | undefined) => {
    if (!o) return;
    onChoose(o.id);
    setText("");
    setActive(0);
  };
  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Search contacts to link"
        autoComplete="off"
        value={text}
        placeholder={options.length ? "Type a name to search contacts" : "No other contacts yet"}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            choose(shown[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-white py-1 text-sm shadow-lg">
          {shown.map((o, i) => {
            const other = where(o);
            return (
              <li
                key={o.id}
                role="option"
                aria-selected={i === active}
                className={cn("cursor-pointer px-3 py-1.5", i === active && "bg-teal-50 text-teal-900")}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                <span className="clamp-1">{o.label}</span>
                {other ? <span className="clamp-1 text-xs text-muted-foreground">Now at {other}</span> : null}
              </li>
            );
          })}
          {!shown.length ? <li className="px-3 py-1.5 text-muted-foreground">{text ? `No contact matches "${text}". Add the person under New people.` : "No other contacts yet."}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Organization page: "Add people" form (existing contacts and new people). The form clears after adding. */
export function OrgPeopleAddForm(props: { organizationId: string; contacts: PersonOption[]; organizations: Record<string, string>; excludeGroups?: string[] }) {
  const [key, setKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  return (
    <GuardedForm
      key={key}
      action={addOrgPeople}
      className="flex flex-col gap-3"
      onResult={(r) => {
        const out = r as Awaited<ReturnType<typeof addOrgPeople>>;
        if (out?.ok) {
          setError(null);
          setKey((k) => k + 1);
        } else setError(out?.error ?? "Not saved.");
      }}
    >
      <input type="hidden" name="organization_id" value={props.organizationId} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <OrgPeopleEditor contacts={props.contacts} organizations={props.organizations} organizationId={props.organizationId} addOnly excludeGroups={props.excludeGroups} />
      <SubmitButton className="self-start" data-save-and-leave>
        Add to organization
      </SubmitButton>
    </GuardedForm>
  );
}
