import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Matches the exit keyframes on `.modal-backdrop[data-closing]` in styles.css. */
const EXIT_MS = 150;

const ClosingContext = createContext(false);

/** True while a modal inside `<Presence>` plays its exit; put it on the backdrop as `data-closing`. */
export const useClosing = () => useContext(ClosingContext);

/** Keeps a modal mounted for its exit animation after `show` turns false. */
export function Presence({ show, children }: { show: boolean; children: ReactNode }) {
  const [prevShow, setPrevShow] = useState(show);
  const [leaving, setLeaving] = useState(false);
  if (show !== prevShow) {
    setPrevShow(show);
    setLeaving(!show);
  }

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  if (!show && !leaving) return null;
  return <ClosingContext value={!show}>{children}</ClosingContext>;
}

/** The dimmed overlay behind every modal. Portaled, so a panel's backdrop-filter/transform can't trap it. */
export function Backdrop({ onClose, children }: { onClose?: () => void; children: ReactNode }) {
  const closing = useClosing();
  return createPortal(
    <div className="modal-backdrop" data-closing={closing || undefined} onClick={onClose}>
      {children}
    </div>,
    document.body,
  );
}
