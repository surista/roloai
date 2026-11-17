import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

const MESSAGE = 'You have unsaved changes. Leave and discard them?';

/**
 * Asks before unsaved edits are thrown away: in-app navigation (links, Back buttons, the
 * browser's Back) gets a confirm; closing or reloading the tab gets the browser's own prompt.
 * Returns `allowLeave`, for a navigation the owner has already confirmed (e.g. after Delete).
 */
export function useUnsavedChangesGuard(dirty: boolean): () => void {
  const allowed = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowed.current && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(MESSAGE)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return () => {
    allowed.current = true;
  };
}
