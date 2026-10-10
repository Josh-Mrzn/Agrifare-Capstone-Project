import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import './RowActionsMenu.css';

/**
 * Kebab menu for a table row.
 *
 * The panel renders in a portal pinned to the button's viewport position, so it
 * escapes the table's `overflow-x: auto` clipping instead of being cut off.
 *
 * `items`: [{ label, icon, onClick, danger?, hidden?, separatorBefore? }]
 */
export default function RowActionsMenu({ items, label = 'Row actions' }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const visible = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const menuW = 210;
    const menuH = visible.length * 38 + 12;

    // Flip above / align right when the menu would spill out of the viewport.
    const top = rect.bottom + menuH > window.innerHeight ? rect.top - menuH - 6 : rect.bottom + 6;
    const left = Math.min(rect.right - menuW, window.innerWidth - menuW - 12);

    setCoords({ top: Math.max(12, top), left: Math.max(12, left) });
  }, [open, visible.length]);

  useEffect(() => {
    if (!open) return;

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
    // Any scroll or resize invalidates the pinned position - just close.
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
        className={`ram-trigger ${open ? 'is-open' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={16} strokeWidth={2.4} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="ram-menu"
            role="menu"
            style={{ top: coords.top, left: coords.left }}
          >
            {visible.map((item) => (
              <React.Fragment key={item.label}>
                {item.separatorBefore && <div className="ram-sep" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  className={`ram-item ${item.danger ? 'is-danger' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                >
                  {item.icon && <item.icon size={15} strokeWidth={2.2} />}
                  <span>{item.label}</span>
                </button>
              </React.Fragment>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
