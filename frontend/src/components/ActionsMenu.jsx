import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

/**
 * A "more actions" menu for a table row.
 *
 * The panel renders in a portal pinned to the button's position, so it is not
 * clipped by a table that scrolls sideways.
 *
 * `items`: [{ label, onClick, danger?, hidden?, separatorBefore? }]
 */
export default function ActionsMenu({ items, label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const visible = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const menuW = 210;
    const menuH = visible.length * 36 + 16;

    // Flip above / align right when the menu would spill out of the viewport.
    const top = rect.bottom + menuH > window.innerHeight ? rect.top - menuH - 6 : rect.bottom + 6;
    const left = Math.min(rect.right - menuW, window.innerWidth - menuW - 12);

    setCoords({ top: Math.max(12, top), left: Math.max(12, left) });
    menuRef.current?.querySelector('button')?.focus();
  }, [open, visible.length]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (menuRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    // Scrolling or resizing moves the button out from under the menu.
    const onReflow = () => setOpen(false);

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div ref={menuRef} className="menu" role="menu" style={{ top: coords.top, left: coords.left }}>
            {visible.map((item) => (
              <React.Fragment key={item.label}>
                {item.separatorBefore && <div className="menu-sep" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  className={`menu-item${item.danger ? ' is-danger' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                >
                  {item.label}
                </button>
              </React.Fragment>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
