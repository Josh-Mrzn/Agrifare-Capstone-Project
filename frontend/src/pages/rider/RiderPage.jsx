import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Navigation, LogOut, Phone, RefreshCw } from 'lucide-react';
import logoImg from '../../assets/logo.png';
import { peso, quantityLabel } from '../../utils/format';
import {
  fetchMyDeliveries,
  pushMyLocation,
  uploadDeliveryProof,
  acceptDelivery,
  declineDelivery,
  startDelivery,
  markDelivered as sendDelivered,
} from '../../services/riderApi';
import { clearSession, getSessionUser } from '../../utils/auth';
import { getErrorMessage } from '../../services/authApi';
import './RiderPage.css';

/**
 * The delivery person's whole app.
 *
 * Built for a phone browser rather than a second Flutter build: a rider needs
 * a list, a map link, a location switch and a camera, and a web page reaches
 * every phone without anybody installing anything.
 *
 * They see only the orders assigned to them. Working for the seller is not
 * enough on its own - assignment is what opens one.
 */

const STATUS_TEXT = {
  confirmed: 'Confirmed by the shop',
  processing: 'Being packed',
  shipped: 'On the way',
  delivered: 'Delivered',
};

/** How often the position is sent while sharing is on. */
const PUSH_EVERY_MS = 15000;

export default function RiderPage() {
  const navigate = useNavigate();
  const user = getSessionUser();

  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sharingId, setSharingId] = useState(null);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState({});
  const [cash, setCash] = useState({});
  const [declining, setDeclining] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [scope, setScope] = useState('active');

  const watchRef = useRef(null);
  const lastPushRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetchMyDeliveries(scope);
      setDeliveries(Array.isArray(res.data) ? res.data : []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load your deliveries.'));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  /** Stops the watch when the page goes away, or the phone keeps reporting. */
  useEffect(() => () => stopSharing(), []);

  function stopSharing() {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setSharingId(null);
  }

  /**
   * Follows the phone and sends the position while driving.
   *
   * Throttled rather than sent on every fix: a phone reports far more often
   * than a delivery moves, and the buyer's map polls every fifteen seconds
   * anyway.
   */
  function startSharing(orderId) {
    if (!navigator.geolocation) {
      setError('This phone cannot share a location.');
      return;
    }

    stopSharing();
    setError('');
    setSharingId(orderId);
    lastPushRef.current = 0;

    watchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastPushRef.current < PUSH_EVERY_MS) return;
        lastPushRef.current = now;

        try {
          await pushMyLocation(orderId, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        } catch (err) {
          setError(getErrorMessage(err, 'Could not send your position.'));
          stopSharing();
        }
      },
      () => {
        setError('Location permission was denied.');
        stopSharing();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  /** Runs one rider action, then reloads the list. */
  async function run(orderId, fn, done, fallback) {
    setBusy(orderId);
    setError('');
    setNotice('');
    try {
      await fn();
      if (done) setNotice(done);
      await load();
      return true;
    } catch (err) {
      setError(getErrorMessage(err, fallback));
      return false;
    } finally {
      setBusy('');
    }
  }

  const uploadProof = (orderId, file) => file && run(
    orderId,
    () => uploadDeliveryProof(orderId, file, notes[orderId] || ''),
    'Photo saved. Now mark it as delivered.',
    'Could not upload that photo.',
  );

  const finish = (d) => run(
    d.orderId,
    async () => {
      await sendDelivered(d.orderId, { cashCollected: d.isCod ? cash[d.orderId] : undefined, note: notes[d.orderId] || '' });
      if (sharingId === d.orderId) stopSharing();
    },
    'Delivered. The shop and the buyer have been told.',
    'Could not mark it delivered. Check your signal and try again; it is safe to press again.',
  );

  function signOut() {
    stopSharing();
    clearSession();
    navigate('/login');
  }

  /** Opens the point in whatever map app the phone has. */
  const mapLink = (point) =>
    point?.lat != null ? `https://www.google.com/maps?q=${point.lat},${point.lng}` : null;

  return (
    <div className="rider">
      <header className="rider-head">
        <div className="rider-brand">
          <img src={logoImg} alt="" width="28" height="28" />
          <div>
            <strong>{user?.name || 'Rider'}</strong>
            <span>AgriFair delivery</span>
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" onClick={load} aria-label="Refresh deliveries">
          <RefreshCw size={18} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={signOut} aria-label="Sign out">
          <LogOut size={18} aria-hidden="true" />
        </button>
      </header>

      <main className="rider-main">
        <h1>Your deliveries</h1>
        <div className="chips" role="group" aria-label="Show deliveries">
          <button type="button" className="chip" aria-pressed={scope === 'active'} onClick={() => { setLoading(true); setScope('active'); }}>To do</button>
          <button type="button" className="chip" aria-pressed={scope === 'history'} onClick={() => { setLoading(true); setScope('history'); }}>Delivered</button>
        </div>

        <div className="live" aria-live="polite">
          {error && <p className="alert alert-danger">{error}</p>}
          {notice && <p className="alert alert-success">{notice}</p>}
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : deliveries.length === 0 ? (
          <section className="panel">
            <div className="empty">
              <strong>{scope === 'history' ? 'Nothing delivered yet' : 'Nothing assigned to you'}</strong>
              <p>{scope === 'history' ? 'Orders you deliver are listed here.' : 'When your shop assigns you an order, it appears here.'}</p>
            </div>
          </section>
        ) : (
          deliveries.map((d) => {
            const done = ['delivered', 'completed'].includes(d.status);
            const sharing = sharingId === d.orderId;
            const waiting = d.assignmentStatus === 'assigned';

            return (
              <section className="panel rider-card" key={d.orderId}>
                <div className="panel-head">
                  <div>
                    <h2>{d.orderNumber}</h2>
                    <p>{(d.items || [d]).map((i) => `${quantityLabel(i)} ${i.productName}`).join(', ')}</p>
                  </div>
                  <span className={`badge${done ? ' badge-success' : waiting ? ' badge-warning' : ' badge-info'}`}>
                    {done ? 'Delivered' : waiting ? 'New: accept or decline' : STATUS_TEXT[d.status] || d.status}
                  </span>
                </div>

                <div className="panel-body stack">
                  <div className="rider-leg">
                    <span className="rider-leg-label">Pick up at {d.shopName || 'the shop'}</span>
                    <p>{d.pickup.address || 'The shop has not added an address yet.'}</p>
                    {mapLink(d.pickup) && (
                      <a className="link" href={mapLink(d.pickup)} target="_blank" rel="noreferrer">Open in Maps</a>
                    )}
                  </div>

                  <div className="rider-leg">
                    <span className="rider-leg-label">Deliver to {d.customerName}</span>
                    <p>{d.deliveryAddress}</p>
                    {d.dropoff.precision === 'approximate' && (
                      <p className="muted">The map pin is the barangay, not the house. Follow the address and landmark.</p>
                    )}
                    <div className="rider-links">
                      {mapLink(d.dropoff) && (
                        <a className="link" href={mapLink(d.dropoff)} target="_blank" rel="noreferrer">Open in Maps</a>
                      )}
                      {d.customerContact && (
                        <a className="link" href={`tel:${d.customerContact}`}>
                          <Phone size={14} aria-hidden="true" /> Call {d.customerContact}
                        </a>
                      )}
                    </div>
                  </div>

                  {d.notes && <p className="rider-note">Buyer&rsquo;s note: {d.notes}</p>}

                  <p className={`alert ${d.amountToCollect > 0 ? 'alert-warning' : 'alert-success'}`}>
                    {d.amountToCollect > 0
                      ? `Collect ${peso(d.amountToCollect)} in cash.`
                      : d.isCod && d.cashCollected != null
                        ? `You recorded ${peso(d.cashCollected)} collected.`
                        : 'Already paid. Collect nothing.'}
                  </p>

                  {waiting ? (
                    declining === d.orderId ? (
                      <form
                        className="rider-actions"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (await run(d.orderId, () => declineDelivery(d.orderId, declineReason), 'Declined. The shop will choose someone else.', 'Could not decline.')) {
                            setDeclining(null);
                            setDeclineReason('');
                          }
                        }}
                      >
                        <label className="field">
                          <span className="field-label">Why can you not take it?</span>
                          <input className="input" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} autoComplete="off" />
                        </label>
                        <button type="submit" className="btn btn-danger btn-lg btn-block" disabled={!declineReason.trim() || busy === d.orderId}>Decline delivery</button>
                        <button type="button" className="btn btn-ghost btn-block" onClick={() => setDeclining(null)}>Back</button>
                      </form>
                    ) : (
                      <div className="rider-actions">
                        <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy === d.orderId}
                          onClick={() => run(d.orderId, () => acceptDelivery(d.orderId), 'Accepted. The shop has been told.', 'Could not accept it.')}>
                          Accept delivery
                        </button>
                        <button type="button" className="btn btn-secondary btn-block" onClick={() => setDeclining(d.orderId)}>Decline</button>
                      </div>
                    )
                  ) : done ? (
                    <p className="muted">Delivered{d.deliveredAt ? ` ${new Date(d.deliveredAt).toLocaleString('en-PH')}` : ''}{d.deliveryNote ? `. Received by ${d.deliveryNote}` : ''}.</p>
                  ) : (
                    <div className="rider-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-lg btn-block"
                        aria-pressed={sharing}
                        onClick={() => (sharing ? stopSharing() : startSharing(d.orderId))}
                      >
                        <Navigation size={18} aria-hidden="true" />
                        {sharing ? 'Sharing location. Tap to stop' : 'Share my location'}
                      </button>

                      {d.status === 'processing' && (
                        <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy === d.orderId}
                          onClick={() => run(d.orderId, () => startDelivery(d.orderId), 'On the way. The buyer has been told.', 'Could not start the delivery.')}>
                          Picked up. Start delivery
                        </button>
                      )}
                      {d.status === 'confirmed' && (
                        <p className="field-hint">The shop is still preparing this order. Start the delivery once they have packed it.</p>
                      )}

                      {d.status === 'shipped' && (
                        <>
                          <label className="field">
                            <span className="field-label">Who received it? <span className="optional">(optional)</span></span>
                            <input
                              className="input"
                              value={notes[d.orderId] || ''}
                              autoComplete="off"
                              onChange={(e) => setNotes((n) => ({ ...n, [d.orderId]: e.target.value }))}
                            />
                          </label>
                          <label className={`btn ${d.proofOfDelivery ? 'btn-secondary' : 'btn-primary'} btn-lg btn-block${busy === d.orderId ? ' is-disabled' : ''}`}>
                            <Camera size={18} aria-hidden="true" />
                            {busy === d.orderId ? 'Working…' : d.proofOfDelivery ? 'Retake photo' : '1. Take photo at the door'}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              disabled={busy === d.orderId}
                              onChange={(e) => { uploadProof(d.orderId, e.target.files?.[0]); e.target.value = ''; }}
                            />
                          </label>
                          {d.isCod && (
                            <label className="field">
                              <span className="field-label">Cash you collected (₱)</span>
                              <input className="input" type="number" inputMode="decimal" min="0" step="0.01"
                                value={cash[d.orderId] ?? ''} placeholder={String(d.total)}
                                onChange={(e) => setCash((c) => ({ ...c, [d.orderId]: e.target.value }))} />
                              <span className="field-hint">Due: {peso(d.total)}. Enter what you actually received.</span>
                            </label>
                          )}
                          <button type="button" className="btn btn-primary btn-lg btn-block"
                            disabled={!d.proofOfDelivery || busy === d.orderId || (d.isCod && (cash[d.orderId] ?? '') === '')}
                            onClick={() => finish(d)}>
                            2. Mark as delivered
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
