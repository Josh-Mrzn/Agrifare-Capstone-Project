import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import API from '../services/authApi';
import Modal from './Modal';

/**
 * Shows a file that lives behind `/api/files`, in place.
 *
 * These are deliberately not served statically, so they need the session
 * token to read: a plain <a href> or <img src> sends no Authorization header
 * and comes back 403. Fetched as a blob through the same API client as every
 * other call, and shown here rather than in a new tab, because checking a
 * receipt is part of deciding about the order.
 */
export default function PrivateFileModal({ path, title, onClose }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!path) return undefined;
    let objectUrl = '';
    let cancelled = false;

    // The API client is mounted at /api, and these paths already include it.
    API.get(path.replace(/^\/api/, ''), { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setFile({ url: objectUrl, pdf: res.data.type === 'application/pdf' });
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.status === 403 ? 'You do not have access to this file.' : 'Could not load this file.');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return (
    <Modal title={title} size="lg" onClose={onClose}>
      <div className="modal-body file-view">
        {error && <p className="alert alert-danger">{error}</p>}
        {!error && !file && <div className="skeleton" style={{ height: 360 }} />}
        {file?.pdf && <iframe src={file.url} title={title} />}
        {file && !file.pdf && <img src={file.url} alt={title} />}
      </div>
      {file && (
        <div className="modal-actions">
          <a className="btn btn-secondary" href={file.url} download>
            <Download size={16} aria-hidden="true" /> Download
          </a>
        </div>
      )}
    </Modal>
  );
}
