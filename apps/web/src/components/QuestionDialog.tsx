import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type Choice = {
  /** What `ask` resolves to when this button is picked. */
  value: string;
  /** Names the action, never "OK" (design: Dialog and Drawer). */
  label: string;
  primary?: boolean;
};

export type Question = { title: string; body?: ReactNode; choices: Choice[] };

type Pending = Question & { resolve: (value: string | null) => void };

/** A native modal <dialog>: the browser traps focus and Escape cancels it. */
// eslint-disable-next-line react-refresh/only-export-components -- private to useQuestion below
function QuestionDialog({ pending, onClose }: { pending: Pending; onClose: (value: string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="question-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose(null);
      }}
    >
      <h2 id="question-title" className="dialog-title">
        {pending.title}
      </h2>
      {pending.body && <div className="dialog-body">{pending.body}</div>}
      <div className="dialog-actions">
        {pending.choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={`button ${choice.primary ? "button-primary" : "button-secondary"}`}
            onClick={() => onClose(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </dialog>
  );
}

/** `ask(question)` opens a dialog and resolves to the picked choice's value, or null when the
 *  person presses Escape. Focus goes back to whatever had it before. */
export function useQuestion(): [(question: Question) => Promise<string | null>, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);
  const opener = useRef<Element | null>(null);

  const ask = useCallback(
    (question: Question) =>
      new Promise<string | null>((resolve) => {
        opener.current = document.activeElement;
        setPending({ ...question, resolve });
      }),
    [],
  );

  const close = (value: string | null) => {
    pending?.resolve(value);
    setPending(null);
    if (opener.current instanceof HTMLElement && opener.current.isConnected) {
      opener.current.focus();
    }
  };

  return [ask, pending ? <QuestionDialog pending={pending} onClose={close} /> : null];
}
