import { useEffect, useState } from 'react';
import { fetchSection } from '../../services/analyticsApi';
import { getErrorMessage } from '../../services/authApi';

/**
 * Loads one analytics section for the current filters. A change of filters
 * aborts the request still in flight, so a slow answer for the old range can
 * never overwrite the new one. While the new answer loads, the previous one
 * stays on screen (dimmed) instead of the page collapsing to skeletons.
 */
export default function useAnalytics(base, section, params) {
  const [nonce, setNonce] = useState(0);
  const key = `${base}|${section}|${JSON.stringify(params)}|${nonce}`;
  const [state, setState] = useState({ key: null, data: null, error: '' });

  useEffect(() => {
    const controller = new AbortController();
    fetchSection(base, section, params, controller.signal)
      .then((res) => setState({ key, data: res.data, error: '' }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({ key, data: null, error: getErrorMessage(err, 'Could not load these analytics.') });
      });
    return () => controller.abort();
    // `key` already covers base, section, params and retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return {
    data: state.data,
    error: state.key === key ? state.error : '',
    loading: state.key !== key,
    reload: () => setNonce((n) => n + 1),
  };
}
