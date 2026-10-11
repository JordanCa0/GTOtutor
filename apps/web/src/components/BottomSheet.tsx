import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { XIcon } from './icons';

/** Dragged past this share of its height, or flicked faster than FLICK px/ms, the sheet closes. */
const CLOSE_SHARE = 0.25;
const FLICK = 0.11;

/**
 * The phone layout's panel: slides up over the table and is dragged, tapped or Escaped away. It stays
 * mounted while closed (moved off-screen and inert) so what's inside keeps its state between openings.
 * Open and close are a CSS transition on `transform`, so a quick re-tap or a drag reverses it mid-way.
 */
export function BottomSheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; t: number; id: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal-backdrop') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const offset = (e: ReactPointerEvent) => {
    const dy = e.clientY - drag.current!.y;
    // Upward drags meet growing resistance instead of a hard stop.
    return dy >= 0 ? dy : -Math.sqrt(-dy) * 2;
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // One finger at a time, and leave the close button's own tap alone.
    if (drag.current || (e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    sheetRef.current!.style.transition = 'none';
  };
  const onMove = (e: ReactPointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    sheetRef.current!.style.transform = `translateY(${offset(e)}px)`;
  };
  const onUp = (e: ReactPointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    const dy = offset(e);
    const velocity = dy / Math.max(1, e.timeStamp - drag.current.t);
    drag.current = null;
    const sheet = sheetRef.current!;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > sheet.offsetHeight * CLOSE_SHARE || velocity > FLICK) onClose();
  };

  return (
    <>
      <div className="sheet-backdrop" data-open={open} onClick={onClose} aria-hidden />
      <section ref={sheetRef} className="sheet" data-open={open} role="dialog" aria-modal={open} aria-label={label} tabIndex={-1} inert={!open}>
        <div className="sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span className="sheet-handle" aria-hidden />
          <button className="icon-btn sheet-close" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </section>
    </>
  );
}
