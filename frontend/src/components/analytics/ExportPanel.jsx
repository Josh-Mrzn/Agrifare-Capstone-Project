import React, { useState } from 'react';
import { Download, Mail } from 'lucide-react';
import { downloadReport, blobErrorMessage } from '../../services/analyticsApi';
import { emailReport } from '../../services/clientApi';
import { getErrorMessage } from '../../services/authApi';
import { Panel } from './parts';
import { rangeLabel } from './format';

/**
 * Downloads, built on the server from the same calculations and the same
 * filters as the screen. Large reports are produced server-side and streamed
 * as a file, never assembled in the browser.
 */
export default function ExportPanel({ base, reports, params, period, canEmail }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  async function download(report, format) {
    setBusy(`${report}:${format}`);
    setMsg(null);
    try {
      const name = await downloadReport(base, report, format, params);
      setMsg({ ok: true, text: `Downloaded ${name}.` });
    } catch (err) {
      setMsg({ ok: false, text: await blobErrorMessage(err, 'Could not create that report.') });
    } finally {
      setBusy('');
    }
  }

  async function email(report) {
    setBusy(`${report}:email`);
    setMsg(null);
    try {
      const res = await emailReport(report, params);
      setMsg({ ok: true, text: `PDF sent to ${res.data?.to || 'your email'}.` });
    } catch (err) {
      setMsg({ ok: false, text: getErrorMessage(err, 'Could not send the report.') });
    } finally {
      setBusy('');
    }
  }

  return (
    <Panel
      title="Reports and exports"
      subtitle={period ? `For ${rangeLabel(period.from, period.to)}, with the filters above. Amounts in Philippine pesos, times in Philippine time.` : undefined}
    >
      <ul className="an-reports">
        {reports.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.title}</strong>
              <span>{r.text}</span>
            </div>
            <div className="an-report-actions">
              {['csv', 'xlsx', 'pdf'].map((f) => (
                <button key={f} type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => download(r.id, f)} aria-label={`Download ${r.title} as ${f.toUpperCase()}`}>
                  {busy === `${r.id}:${f}` ? <span className="spinner" aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
                  {f.toUpperCase()}
                </button>
              ))}
              {canEmail && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => email(r.id)} aria-label={`Email ${r.title} as PDF`}>
                  {busy === `${r.id}:email` ? <span className="spinner" aria-hidden="true" /> : <Mail size={13} aria-hidden="true" />}
                  Email
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {msg && <p className={`alert ${msg.ok ? 'alert-success' : 'alert-danger'} an-export-msg`} role="status">{msg.text}</p>}
    </Panel>
  );
}
