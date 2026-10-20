import { useState } from "react";

import { TextAreaField, TextField } from "../components/TextField";
import {
  BASICS_FIELDS,
  LIST_SECTIONS,
  MAX_LENGTH,
  entryName,
  fieldId,
  fieldText,
  inputId,
  stripControl,
  withFieldText,
  type FieldErrors,
  type FieldSpec,
  type ListSection,
  type ProfileData,
  type SectionId,
} from "./model";

type Entry = Record<string, unknown>;

const INPUT_TYPE: Partial<Record<FieldSpec["kind"], string>> = {
  url: "url",
  email: "email",
  tel: "tel",
};

/** Within this many characters of a limit, the field shows how many are left. */
const COUNT_FROM = 20;

function Field({
  id,
  spec,
  entry,
  error,
  disabled,
  onChange,
}: {
  id: string;
  spec: FieldSpec;
  entry: Entry | undefined;
  error: string | undefined;
  disabled?: boolean;
  onChange: (text: string) => void;
}) {
  const value = fieldText(entry, spec);
  const max = MAX_LENGTH[spec.kind];
  const longest = Math.max(
    0,
    ...(spec.kind === "lines" ? value.split("\n") : spec.kind === "csv" ? value.split(",") : [value]).map(
      (piece) => piece.trim().length,
    ),
  );
  const left = max - longest;
  const count =
    spec.kind !== "date" && left <= COUNT_FROM
      ? left >= 0
        ? `${left} ${left === 1 ? "character" : "characters"} left`
        : `${-left} over the limit`
      : undefined;
  const hint = [spec.hint, count].filter(Boolean).join(". ") || undefined;
  const handle = (text: string) => onChange(stripControl(text));

  const common = {
    id: inputId(id),
    label: spec.label,
    hint,
    error,
    disabled,
    className: spec.wide ? "field-wide" : undefined,
    autoComplete: spec.autoComplete ?? "off",
  };
  if (spec.kind === "longtext" || spec.kind === "lines") {
    return (
      <TextAreaField
        {...common}
        value={value}
        rows={spec.kind === "lines" ? 5 : 6}
        onChange={(event) => handle(event.target.value)}
      />
    );
  }
  // A month picker where the browser has one. A value it can't show (a bare year) stays as text,
  // so nothing saved disappears from view.
  const type =
    spec.kind === "date"
      ? value === "" || /^\d{4}-\d{2}(-\d{2})?$/.test(value)
        ? "month"
        : "text"
      : (INPUT_TYPE[spec.kind] ?? "text");
  return (
    <TextField
      {...common}
      type={type}
      value={type === "month" ? value.slice(0, 7) : value}
      onChange={(event) => handle(event.target.value)}
    />
  );
}

function hasError(errors: FieldErrors, section: SectionId, index: number): boolean {
  const prefix = `${section}.${index}.`;
  return Object.keys(errors).some((id) => id.startsWith(prefix));
}

type Props = {
  section: SectionId;
  profile: ProfileData;
  errors: FieldErrors;
  /** The entry open for editing; the others show one summary line each. */
  openEntry: number | null;
  onOpenEntry: (index: number | null) => void;
  onChange: (next: ProfileData, changedFieldId?: string) => void;
  /** Moves focus to an element id after the next render. */
  onFocus: (elementId: string) => void;
  onAnnounce: (message: string) => void;
};

/** Edits one section of the profile. Every other section of `profile` passes through untouched. */
export function SectionEditor(props: Props) {
  if (props.section === "basics") return <BasicsEditor {...props} />;
  const list = LIST_SECTIONS.find((s) => s.id === props.section);
  return list ? <ListEditor {...props} list={list} /> : null;
}

function BasicsEditor({ profile, errors, onChange }: Props) {
  const basics = (profile.basics ?? {}) as Entry;
  return (
    <div className="field-grid">
      {BASICS_FIELDS.map((spec) => {
        const id = fieldId("basics", null, spec.key);
        return (
          <Field
            key={id}
            id={id}
            spec={spec}
            entry={basics}
            error={errors[id]}
            onChange={(text) =>
              onChange(
                { ...profile, basics: withFieldText(basics, spec, text) as ProfileData["basics"] },
                id,
              )
            }
          />
        );
      })}
    </div>
  );
}

function ListEditor({
  list,
  profile,
  errors,
  openEntry,
  onOpenEntry,
  onChange,
  onFocus,
  onAnnounce,
}: Props & { list: ListSection }) {
  const entries = (profile[list.id] ?? []) as Entry[];
  // Entries whose "I still work here" box was unticked while the end date is still empty.
  const [endShown, setEndShown] = useState<Set<number>>(() => new Set());

  const setEntries = (next: Entry[], changedFieldId?: string) =>
    onChange({ ...profile, [list.id]: next } as ProfileData, changedFieldId);

  const add = () => {
    setEntries([...entries, {}]);
    onOpenEntry(entries.length);
    const first = list.fields[0];
    if (first) onFocus(inputId(fieldId(list.id, entries.length, first.key)));
    onAnnounce(`Added ${list.noun} ${entries.length + 1}.`);
  };

  const remove = (index: number) => {
    const name = entryName(list, entries[index] ?? {}, index);
    setEntries(entries.filter((_, i) => i !== index));
    setEndShown(new Set());
    onOpenEntry(null);
    onFocus(`profile-add-${list.id}`);
    onAnnounce(`Removed ${name}. Discard changes to bring it back.`);
  };

  const open = (index: number) => {
    onOpenEntry(index);
    onFocus(`profile-${list.id}-${index}-title`);
  };

  const close = (index: number) => {
    onOpenEntry(null);
    onFocus(`profile-${list.id}-${index}-edit`);
  };

  return (
    <>
      {entries.length === 0 && <p className="profile-empty">No {list.title.toLowerCase()} yet.</p>}
      <ol className="profile-entries">
        {entries.map((entry, index) => {
          const name = entryName(list, entry, index);
          const titleId = `profile-${list.id}-${index}-title`;
          if (openEntry !== index) {
            return (
              <li key={index} className="profile-entry profile-entry-closed">
                <span className="profile-entry-summary">
                  {name}
                  {hasError(errors, list.id, index) && (
                    <span className="profile-entry-flag"> Needs a fix</span>
                  )}
                </span>
                <button
                  type="button"
                  id={`profile-${list.id}-${index}-edit`}
                  className="button button-ghost"
                  onClick={() => open(index)}
                >
                  Edit{" "}
                  <span className="clew-sr-only">{name}</span>
                </button>
              </li>
            );
          }
          const end = typeof entry.endDate === "string" ? entry.endDate : "";
          const current = list.id === "work" && end === "" && !endShown.has(index);
          return (
            <li key={index} className="profile-entry profile-entry-open">
              <h2 id={titleId} tabIndex={-1} className="profile-entry-title">
                {name}
              </h2>
              <div className="field-grid">
                {list.fields.map((spec) => {
                  const id = fieldId(list.id, index, spec.key);
                  if (spec.key === "endDate" && current) return null;
                  return (
                    <Field
                      key={id}
                      id={id}
                      spec={spec}
                      entry={entry}
                      error={errors[id]}
                      onChange={(text) =>
                        setEntries(
                          entries.map((e, i) => (i === index ? withFieldText(e, spec, text) : e)),
                          id,
                        )
                      }
                    />
                  );
                })}
                {list.id === "work" && (
                  <label className="field-check field-wide">
                    <input
                      type="checkbox"
                      checked={current}
                      onChange={(event) => {
                        const next = new Set(endShown);
                        if (event.target.checked) {
                          next.delete(index);
                          setEntries(
                            entries.map((e, i) => (i === index ? { ...e, endDate: "" } : e)),
                            fieldId(list.id, index, "endDate"),
                          );
                        } else {
                          next.add(index);
                        }
                        setEndShown(next);
                      }}
                    />
                    I still work here
                  </label>
                )}
              </div>
              <div className="profile-entry-actions">
                <button type="button" className="button button-secondary" onClick={() => close(index)}>
                  Done{" "}
                  <span className="clew-sr-only">with {name}</span>
                </button>
                <button type="button" className="button button-ghost" onClick={() => remove(index)}>
                  Remove{" "}
                  <span className="clew-sr-only">{name}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        id={`profile-add-${list.id}`}
        className="button button-secondary"
        onClick={add}
      >
        Add a {list.noun}
      </button>
    </>
  );
}
