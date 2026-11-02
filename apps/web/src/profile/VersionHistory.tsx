import { useEffect, useRef } from "react";

import {
  BASICS_FIELDS,
  LIST_SECTIONS,
  entryName,
  fieldText,
  versionDate,
  type ProfileVersion,
  type VersionSummary,
} from "./model";

export function VersionHistory({
  versions,
  onView,
}: {
  versions: VersionSummary[];
  onView: (id: string) => void;
}) {
  return (
    <section aria-labelledby="profile-history-title" className="profile-history">
      <h2 id="profile-history-title">History</h2>
      {versions.length === 0 ? (
        <p className="profile-history-empty">Each time you save, Clew keeps a copy here.</p>
      ) : (
        <ol className="profile-history-list">
          {versions.map((version) => {
            const number = version.number;
            return (
              <li key={version.id}>
                <button
                  type="button"
                  className="profile-history-item"
                  onClick={() => onView(version.id)}
                >
                  <span className="profile-history-name">
                    Version {number}
                    {version.is_current && <span className="profile-history-current"> (current)</span>}
                  </span>
                  <span className="profile-history-meta">
                    {versionDate(version.created_at)}
                    {version.change_summary && ` · ${version.change_summary}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** A read-only look at one saved version, with the way to restore it. */
export function VersionView({
  version,
  number,
  onRestore,
  onClose,
}: {
  version: ProfileVersion;
  number: number;
  onRestore: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const basics = (version.data.basics ?? {}) as Record<string, unknown>;
  const filledBasics = BASICS_FIELDS.map((spec) => [spec, fieldText(basics, spec)] as const).filter(
    ([, text]) => text.trim(),
  );

  return (
    <dialog
      ref={ref}
      className="dialog dialog-wide"
      aria-labelledby="version-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="version-title" className="dialog-title">
        Version {number}
      </h2>
      <p className="dialog-meta">
        Saved {versionDate(version.created_at)}
        {version.change_summary && ` · ${version.change_summary}`}
      </p>
      <div className="dialog-body version-body">
        <h3>Basics</h3>
        {filledBasics.length === 0 ? (
          <p>Nothing filled in.</p>
        ) : (
          <dl className="version-basics">
            {filledBasics.map(([spec, text]) => (
              <div key={spec.key}>
                <dt>{spec.label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        )}
        {LIST_SECTIONS.map((section) => {
          const entries = (version.data[section.id] ?? []) as Record<string, unknown>[];
          if (entries.length === 0) return null;
          return (
            <div key={section.id}>
              <h3>{section.title}</h3>
              <ul>
                {entries.map((entry, index) => (
                  <li key={index}>{entryName(section, entry, index)}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="dialog-actions">
        <button type="button" className="button button-secondary" onClick={onClose}>
          Close
        </button>
        {!version.is_current && (
          <button type="button" className="button button-primary" onClick={onRestore}>
            Restore this version
          </button>
        )}
      </div>
    </dialog>
  );
}
