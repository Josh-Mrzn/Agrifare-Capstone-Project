import API from './authApi';

/**
 * /api/analytics. `base` is one of:
 *   /analytics/seller                      the signed-in seller
 *   /analytics/platform                    the marketplace (Super Admin)
 *   /analytics/platform/sellers/:id        one seller, seen by a Super Admin
 */
export const fetchSection = (base, section, params, signal) =>
  API.get(`${base}/${section}`, { params, signal });

export const fetchOptions = (base) => API.get(`${base}/options`);

export const fetchBuyerProfile = (buyerUserId) =>
  API.get(`/analytics/platform/buyers/${buyerUserId}`);

/**
 * Downloads a report through the API (so the sign-in token goes with it) and
 * hands the file to the browser under the name the server chose.
 */
export async function downloadReport(base, report, format, params) {
  const res = await API.get(`${base}/export/${report}`, {
    params: { ...params, format },
    responseType: 'blob',
  });
  const disposition = res.headers['content-disposition'] || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || `agrifair-${report}.${format}`;
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/** Errors from a blob request arrive as a Blob; read the JSON message out of it. */
export async function blobErrorMessage(err, fallback) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.error || parsed.message || fallback;
    } catch {
      return fallback;
    }
  }
  return data?.error || data?.message || fallback;
}
