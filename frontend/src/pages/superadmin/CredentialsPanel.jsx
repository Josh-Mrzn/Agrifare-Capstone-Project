import React, { useCallback, useEffect, useState } from 'react';
import { fetchSellerCredentials, reviewCredential } from '../../services/superAdminApi';
import { getErrorMessage } from '../../services/authApi';
import PrivateFileModal from '../../components/PrivateFileModal';

const STATE = {
  pending: { tone: 'warning', label: 'To review' },
  verified: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Rejected' },
};

const DOC_LABEL = {
  BIR: 'BIR Certificate of Registration',
  DTI: 'DTI Business Name',
  SEC: 'SEC Registration',
  MAYORS_PERMIT: "Mayor's or business permit",
  BARANGAY: 'Barangay clearance',
  ORGANIC_CERT: 'Organic certification',
  OTHER: 'Other document',
};

const stateBadge = (status) => {
  const s = STATE[status];
  return <span className={`badge${s ? ` badge-${s.tone}` : ''}`}>{s ? s.label : 'Not submitted'}</span>;
};

/**
 * Where a seller's GCash account and business documents are checked.
 *
 * A GCash account stays hidden from buyers until it is approved here: the
 * server sends no account number and the app offers cash on delivery
 * instead. Decided items stay on the list, so an approval can be checked
 * again later and taken back.
 */
export default function CredentialsPanel() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [reasons, setReasons] = useState({});
  const [viewing, setViewing] = useState(null);
  const [onlyWaiting, setOnlyWaiting] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchSellerCredentials();
      setRows(Array.isArray(res.data) ? res.data : []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load the credentials.'));
      setRows((prev) => prev || []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(userId, body, key) {
    const reason = (reasons[key] || '').trim();
    if (!body.approve && !reason) {
      setError('Write a reason first, so the seller knows what to fix.');
      return;
    }
    setBusy(key);
    setError('');
    try {
      await reviewCredential(userId, { ...body, reason: body.approve ? '' : reason });
      setReasons((r) => ({ ...r, [key]: '' }));
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save that decision.'));
    } finally {
      setBusy('');
    }
  }

  if (!rows) return <div className="panel"><div className="skeleton-rows"><div className="skeleton" /><div className="skeleton" /></div></div>;

  const waiting = rows.filter((r) => r.needsReview).length;
  const shown = onlyWaiting ? rows.filter((r) => r.needsReview) : rows;

  // A render function, not a component: a component defined in here would be
  // a new type on every render, and the reason box would lose focus per key.
  function decision(userId, body, keyName, status) {
    return (
      <div className="cred-decision">
        <label className="sr-only" htmlFor={`reason-${keyName}`}>Reason, needed to reject</label>
        <input
          id={`reason-${keyName}`}
          className="input"
          placeholder="Reason, needed to reject…"
          autoComplete="off"
          value={reasons[keyName] || ''}
          onChange={(e) => setReasons((r) => ({ ...r, [keyName]: e.target.value }))}
        />
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy === keyName} onClick={() => decide(userId, { ...body, approve: false }, keyName)}>
          {status === 'verified' ? 'Revoke' : 'Reject'}
        </button>
        {status !== 'verified' && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy === keyName} onClick={() => decide(userId, { ...body, approve: true }, keyName)}>
            Approve
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="page-actions">
        <div className="chips" role="group" aria-label="Show">
          <button type="button" className="chip" aria-pressed={onlyWaiting} onClick={() => setOnlyWaiting(true)}>
            To review <span className="chip-count">{waiting}</span>
          </button>
          <button type="button" className="chip" aria-pressed={!onlyWaiting} onClick={() => setOnlyWaiting(false)}>
            All sellers <span className="chip-count">{rows.length}</span>
          </button>
        </div>
      </div>

      <div className="live" aria-live="polite">{error && <p className="alert alert-danger">{error}</p>}</div>

      {shown.length === 0 && (
        <section className="panel">
          <div className="empty">
            <p>{onlyWaiting ? 'Nothing is waiting for review.' : 'No seller has submitted a GCash account or a document yet.'}</p>
          </div>
        </section>
      )}

      {shown.map((seller) => (
        <section className="panel" key={seller.userId}>
          <div className="panel-head">
            <div>
              <h2>{seller.name}</h2>
              <p>{seller.email}, ID {seller.userId}{seller.sellerType ? `, ${seller.sellerType}` : ''}</p>
            </div>
            {seller.needsReview && <span className="badge badge-warning">Needs a decision</span>}
          </div>
          <ul className="list">
            {seller.payout && (
              <li className="cred-item">
                <div className="cred-head">
                  <strong>GCash account</strong>
                  {stateBadge(seller.payout.status)}
                </div>
                <dl className="dl">
                  <div><dt>Account name</dt><dd>{seller.payout.accountName || 'Not given'}</dd></div>
                  <div><dt>Number</dt><dd className="num">{seller.payout.accountNumber || 'Not given'}</dd></div>
                </dl>
                {seller.payout.qrImage && (
                  <div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewing({ path: seller.payout.qrImage, title: `GCash QR, ${seller.name}` })}>
                      View QR code
                    </button>
                  </div>
                )}
                {decision(seller.userId, { kind: 'payout' }, `payout-${seller.userId}`, seller.payout.status)}
              </li>
            )}
            {seller.documents.map((doc) => (
              <li className="cred-item" key={doc.type}>
                <div className="cred-head">
                  <strong>{doc.label || DOC_LABEL[doc.type] || doc.type}</strong>
                  {stateBadge(doc.status)}
                </div>
                <dl className="dl">
                  <div><dt>Reference no.</dt><dd>{doc.referenceNo || 'Not given'}</dd></div>
                  {doc.rejectionReason && <div><dt>Rejected because</dt><dd>{doc.rejectionReason}</dd></div>}
                </dl>
                {doc.file && (
                  <div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewing({ path: doc.file, title: `${doc.label || DOC_LABEL[doc.type] || doc.type}, ${seller.name}` })}>
                      View document
                    </button>
                  </div>
                )}
                {decision(seller.userId, { kind: 'document', docType: doc.type }, `${doc.type}-${seller.userId}`, doc.status)}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {viewing && <PrivateFileModal path={viewing.path} title={viewing.title} onClose={() => setViewing(null)} />}
    </>
  );
}
