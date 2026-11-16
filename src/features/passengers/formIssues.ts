// Field-level form errors for the people and profile forms. A validator returns {field, message}[];
// each message shows under its field (<Field issues={…}>, which marks it .invalid), the first bad
// field gets focus on a failed save, and editing a field clears its messages.
import { type RefObject, useCallback, useEffect, useEffectEvent, useState } from 'react';

import { findFocusTarget } from '../../app/focusParam';

export interface FormIssue<F extends string = string> {
  field: F;
  message: string;
}

const FIELD = 'input:not([type=hidden]), select, textarea';

export function useFormIssues<F extends string>(root: RefObject<HTMLElement | null>) {
  const [issues, setIssues] = useState<FormIssue<F>[]>([]);
  const [shown, setShown] = useState(0);
  // Once the messages are rendered: scroll to the first bad field and focus it.
  const focusFirst = useEffectEvent(() => {
    if (!root.current || !issues.length) return;
    const t = findFocusTarget(root.current, issues[0].field);
    const input = t && (t.matches(FIELD) ? t : t.querySelector<HTMLElement>(FIELD));
    (input ?? t)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus({ preventScroll: true });
  });
  useEffect(() => {
    if (shown) focusFirst();
  }, [shown]);
  /** Show these problems (none: clear them). Returns true when there are none. */
  const check = useCallback((next: FormIssue<F>[]) => {
    setIssues(next);
    if (next.length) setShown((n) => n + 1);
    return next.length === 0;
  }, []);
  /** The messages of one field. */
  const of = useCallback((field: F) => issues.filter((i) => i.field === field).map((i) => i.message), [issues]);
  /** A field was edited: its messages go. */
  const clear = useCallback(
    (field: F) => setIssues((is) => (is.some((i) => i.field === field) ? is.filter((i) => i.field !== field) : is)),
    [],
  );
  return { issues, check, of, clear };
}
