import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * A modal on the native <dialog>: the browser traps focus inside it, makes
 * the page behind inert, and closes it on Escape. Children supply the body
 * and buttons, using .modal-body and .modal-actions.
 */
export default function Modal({ title, onClose, size, children }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${size === 'lg' ? ' modal-lg' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the dialog element itself is a click on the backdrop.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** "Are you sure?" for anything that cannot be undone. */
export function ConfirmDialog({ title, children, confirmLabel, danger = false, busy = false, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-body">{children}</div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
