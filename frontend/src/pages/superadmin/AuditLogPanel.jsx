import React, { useCallback, useEffect, useState } from 'react';
import { fetchAuditLogs } from '../../services/superAdminApi';
import { formatDate, formatTime, formatDateTime } from '../../utils/format';

const ACTIONS = {
  CREATE_USER: 'Account created',
  UPDATE_USER: 'Account edited',
  SUSPEND_USER: 'Account suspended',
  ACTIVATE_USER: 'Account reinstated',
  APPROVE_SELLER: 'Seller approved',
  REJECT_SELLER: 'Seller rejected',
  DELETE_USER: 'Account deleted',
};

const TONE = {
  SUSPEND_USER: 'warning',
  DELETE_USER: 'danger',
  REJECT_SELLER: 'danger',
  APPROVE_SELLER: 'success',
  CREATE_USER: 'success',
  ACTIVATE_USER: 'success',
};

/** What happened, to whom, in words. */
function sentence(log) {
  const who = log.targetName || log.targetEmail || `account ${log.targetId}`;
  const role = log.targetRole ? `${log.targetRole} ` : '';
  switch (log.action) {
    case 'CREATE_USER': return `${who} was added as a new ${role}account.`;
    case 'UPDATE_USER': return `${who}'s account details were changed.`;
    case 'SUSPEND_USER': return `${who} was suspended and can no longer sign in.`;
    case 'ACTIVATE_USER': return `${who} can sign in again.`;
    case 'APPROVE_SELLER': return `${who} was approved as a seller.`;
    case 'REJECT_SELLER': return `${who}'s seller application was rejected. ${log.details?.replace(/^Seller application rejected:\s*/, 'Reason: ') || ''}`;
    case 'DELETE_USER': return `${who} was removed from AgriFair.`;
    default: return `${who}: ${log.action.replace(/_/g, ' ').toLowerCase()}.`;
  }
}

/** "Today", "Yesterday" or the date: the heading entries are grouped under. */
function dayLabel(value) {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return formatDate(d);
}

function groupByDay(logs) {
  const groups = [];
  for (const log of logs) {
    const label = dayLabel(log.createdAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(log);
    else groups.push({ label, items: [log] });
  }
  return groups;
}

export default function AuditLogPanel() {
  const [logs, setLogs] = useState(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (nextPage, filter, append) => {
    setLoading(true);
    try {
      const res = await fetchAuditLogs({ page: nextPage, limit: 25, action: filter || undefined });
      const data = res.data || {};
      setLogs((prev) => (append ? [...(prev || []), ...(data.logs || [])] : data.logs || []));
      setPage(data.page || 1);
      setPages(data.totalPages || 1);
    } catch {
      if (!append) setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1, action, false);
  }, [load, action]);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Audit log</h2>
          <p>Every change a Super Admin made to an account.</p>
        </div>
        <label className="sr-only" htmlFor="audit-filter">Show</label>
        <select id="audit-filter" className="select audit-filter" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All changes</option>
          {Object.entries(ACTIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>

      {!logs ? (
        <div className="skeleton-rows"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
      ) : logs.length === 0 ? (
        <div className="empty"><p>{action ? 'No changes of this kind yet.' : 'Nothing has been recorded yet.'}</p></div>
      ) : (
        <>
          {groupByDay(logs).map((group) => (
            <div key={group.label} className="audit-day">
              <h3 className="audit-day-label">{group.label}</h3>
              <ul className="list">
                {group.items.map((log) => (
                  <li key={log.id || log._id} className="list-row audit-row">
                    <span className="list-row-main">
                      <strong>{sentence(log)}</strong>
                      <span>
                        <span className={`badge${TONE[log.action] ? ` badge-${TONE[log.action]}` : ''}`}>{ACTIONS[log.action] || log.action}</span>
                        {' '}by {log.adminName || 'a Super Admin'}
                      </span>
                    </span>
                    <time className="muted num" dateTime={log.createdAt} title={formatDateTime(log.createdAt)}>
                      {formatTime(log.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {page < pages && (
            <div className="panel-foot">
              <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => load(page + 1, action, true)}>
                {loading ? 'Loading…' : 'Show older entries'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
