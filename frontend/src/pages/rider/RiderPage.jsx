import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Navigation, LogOut, Phone, RefreshCw } from 'lucide-react';
import logoImg from '../../assets/logo.png';
import { peso, quantityLabel } from '../../utils/format';
import {
  fetchMyDeliveries,
  pushMyLocation,
  uploadDeliveryProof,
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
  confirmed: 'Accepted',
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

  const watchRef = useRef(null);
  const lastPushRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetchMyDeliveries();
      setDeliveries(Array.isArray(res.data) ? res.data : []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load your deliveries.'));
    } finally {
      setLoading(false);
    }
  }, []);

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

  async function markDelivered(orderId, file) {
    if (!file) return;

    setBusy(orderId);
    setError('');
    try {
      await uploadDeliveryProof(orderId, file, notes[orderId] || '');
      if (sharingId === orderId) stopSharing();
      setNotes((n) => ({ ...n, [orderId]: '' }));
      setNotice('Delivered. The shop and the buyer can both see the photo.');
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not upload that photo.'));
    } finally {
      setBusy('');
    }
  }

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

        <div className="live" aria-live="polite">
          {error && <p className="alert alert-danger">{error}</p>}
          {notice && <p className="alert alert-success">{notice}</p>}
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : deliveries.length === 0 ? (
          <section className="panel">
            <div className="empty">
              <strong>Nothing assigned to you</strong>
              <p>When your shop assigns you an order, it appears here.</p>
            </div>
          </section>
        ) : (
          deliveries.map((d) => {
            const done = Boolean(d.proofOfDelivery);
            const sharing = sharingId === d.orderId;
            const cash = d.paymentMethod?.toLowerCase().includes('cash');

            return (
              <section className="panel rider-card" key={d.orderId}>
                <div className="panel-head">
                  <div>
                    <h2>{d.orderNumber}</h2>
                    <p>{d.productName}, {quantityLabel(d)}</p>
                  </div>
                  <span className={`badge${done ? ' badge-success' : ' badge-info'}`}>
                    {done ? 'Delivered' : STATUS_TEXT[d.status] || d.status}
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

                  <p className={`alert ${d.paymentStatus === 'paid' ? 'alert-success' : cash ? 'alert-warning' : 'alert-info'}`}>
                    {d.paymentStatus === 'paid'
                      ? 'Already paid. Collect nothing.'
                      : cash
                        ? `Collect ${peso(d.total)} in cash.`
                        : 'GCash payment not confirmed yet. Collect nothing; the shop will sort it out.'}
                  </p>

                  {done ? (
                    <p className="muted">Photo uploaded{d.deliveryNote ? `. Received by ${d.deliveryNote}` : ''}.</p>
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

                      <label className="field">
                        <span className="field-label">Who received it? <span className="optional">(optional)</span></span>
                        <input
                          className="input"
                          value={notes[d.orderId] || ''}
                          autoComplete="off"
                          onChange={(e) => setNotes((n) => ({ ...n, [d.orderId]: e.target.value }))}
                        />
                      </label>

                      {d.status === 'shipped' ? (
                        <>
                          <label className={`btn btn-primary btn-lg btn-block${busy === d.orderId ? ' is-disabled' : ''}`}>
                            <Camera size={18} aria-hidden="true" />
                            {busy === d.orderId ? 'Uploading…' : 'Take photo at the door'}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              disabled={busy === d.orderId}
                              onChange={(e) => markDelivered(d.orderId, e.target.files?.[0])}
                            />
                          </label>
                          <p className="field-hint">The photo marks the order delivered. The shop and the buyer can both see it.</p>
                        </>
                      ) : (
                        <p className="field-hint">The shop has not sent this order out yet. You can take the photo once it is marked out for delivery.</p>
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
