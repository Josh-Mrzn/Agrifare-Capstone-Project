import React, { useEffect, useState } from 'react';
import API from '../services/authApi';

/**
 * An image from behind /api/files, fetched with the session token. A plain
 * <img src> sends no Authorization header, so the server refuses it.
 */
export default function PrivateImage({ path, alt, className }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!path) return undefined;
    let objectUrl = '';
    let cancelled = false;

    API.get(path.replace(/^\/api/, ''), { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!url) return <span className={`skeleton ${className || ''}`} aria-hidden="true" />;
  return <img src={url} alt={alt} className={className} />;
}
