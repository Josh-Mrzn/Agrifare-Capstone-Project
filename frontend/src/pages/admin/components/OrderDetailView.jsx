import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import PrivateFileModal from '../../../components/PrivateFileModal';
import Modal from '../../../components/Modal';
import DeliveryMap from './DeliveryMap';
import { fetchRiders, assignRider } from '../../../services/riderApi';
import {
  updateOrderStatus,
  reviewOrderPayment,
  setOrderCourier,
  uploadSellerDeliveryProof,
} from '../../../services/clientApi';
import { getErrorMessage } from '../../../services/authApi';
import { peso, formatDateTime, quantityLabel } from '../../../utils/format';
import { STATUS_LABEL, statusBadge, PAYMENT_LABEL, paymentBadge } from '../orderStatus';

const BUYER_CONFIRM_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;

const isGcash = (method) => /gcash/i.test(method || '');

/**
 * What happens next on this order, and what (if anything) is in the way.
 * Mirrors backend/src/services/orderRules.js: the server enforces the same
 * rules, this only explains them before the seller clicks.
 */
function nextStep(order) {
  const storefront = order.source === 'storefront';
  const d = order.delivery || {};
  const hasCarrier = d.riderUserId != null || Boolean(d.courierName && d.courierReference);

  switch (order.status) {
    case 'pending':
      if (isGcash(order.paymentMethod) && order.paymentStatus !== 'paid') {
        return {
          text: 'Check the GCash payment below first. You can accept the order once the money has arrived.',
          actions: [{ to: 'confirmed', label: 'Accept order', blocked: true }, { to: 'cancelled', label: 'Decline', ghost: true }],
        };
      }
      return {
        text: 'Accepting takes the rice out of your stock and tells the buyer.',
        actions: [{ to: 'confirmed', label: 'Accept order' }, { to: 'cancelled', label: 'Decline', ghost: true }],
      };
    case 'confirmed':
      return {
        text: 'Pack the rice, then mark it as being prepared.',
        actions: [{ to: 'processing', label: 'Start preparing' }, { to: 'cancelled', label: 'Cancel order', ghost: true }],
      };
    case 'processing':
      if (storefront && !hasCarrier) {
        return {
          text: 'Choose who delivers it under Delivery: one of your riders, or a courier with its tracking number.',
          actions: [{ to: 'shipped', label: 'Send out', blocked: true }, { to: 'cancelled', label: 'Cancel order', ghost: true }],
        };
      }
      return {
        text: 'Send it out when it leaves your place. The buyer can follow it on the map.',
        actions: [{ to: 'shipped', label: 'Send out' }, { to: 'cancelled', label: 'Cancel order', ghost: true }],
      };
    case 'shipped':
      if (storefront) {
        return {
          text: d.riderUserId != null
            ? 'Your rider marks it delivered by taking a photo at the door. If the photo is with you instead, upload it here.'
            : 'Upload a photo from the door to mark it delivered.',
          upload: true,
        };
      }
      return { text: 'Mark it delivered once it arrives.', actions: [{ to: 'delivered', label: 'Mark delivered' }] };
    case 'delivered': {
      if (!storefront) {
        return { text: 'Complete the sale to count it in your sales.', actions: [{ to: 'completed', label: 'Complete sale' }] };
      }
      const since = d.deliveredAt ? Date.now() - new Date(d.deliveredAt).getTime() : 0;
      const canClose = since >= BUYER_CONFIRM_DAYS * DAY;
      const from = d.deliveredAt ? formatDateTime(new Date(new Date(d.deliveredAt).getTime() + BUYER_CONFIRM_DAYS * DAY)) : '';
      return {
        text: canClose
          ? 'The buyer has not confirmed yet. It has been 3 days, so you can complete the sale.'
          : `Waiting for the buyer to confirm in the app that it arrived. If they do not, you can complete it from ${from}.`,
        actions: [{ to: 'completed', label: 'Complete sale', blocked: !canClose }],
      };
    }
    case 'completed':
      return { text: 'Done. This order is counted in your sales.' };
    case 'cancelled':
      return { text: `Cancelled${order.statusReason ? `: ${order.statusReason}` : '.'} Any stock it reserved went back to your inventory.` };
    default:
      return { text: '' };
  }
}

export default function OrderDetailView({ order, onBack, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  async function act(fn, fallback) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(getErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  const step = nextStep(order);
  const storefront = order.source === 'storefront';

  return (
    <div className="detail">
      <div className="detail-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Orders
        </button>
        <div className="detail-title">
          <h2>{order.orderNumber}</h2>
          <span className={statusBadge(order.status)}>{STATUS_LABEL[order.status] || order.status}</span>
        </div>
        <p className="muted">
          Placed {formatDateTime(order.orderDate)}
          {storefront ? ' in the app' : ', recorded by you'}
        </p>
      </div>

      <div className="live" aria-live="polite">{error && <p className="alert alert-danger">{error}</p>}</div>

      <div className="detail-grid">
        <div className="stack">
          <section className="panel order-next">
            <div className="panel-head"><h3>Next step</h3></div>
            <div className="panel-body stack">
              <p>{step.text}</p>
              {step.actions && (
                <div className="form-actions order-actions">
                  {step.actions.map((a) => (
                    <button
                      key={a.to}
                      type="button"
                      className={`btn ${a.ghost ? 'btn-secondary' : 'btn-primary'}`}
                      disabled={busy || a.blocked}
                      onClick={() => (a.to === 'cancelled'
                        ? setCancelling(true)
                        : act(() => updateOrderStatus(order._id, a.to), 'Could not update the order.'))}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              {step.upload && <DeliveryPhotoUpload order={order} busy={busy} act={act} />}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Rice</h3></div>
            <div className="panel-body">
              <div className="line-item">
                <span className="cell-main">
                  <strong>{order.productName}</strong>
                  <span>{quantityLabel(order)} at {peso(order.unitPrice)}{order.weightKg > 1 ? ' a sack' : ' a kilo'}</span>
                </span>
                <span className="num">{peso(order.subtotal ?? order.total)}</span>
              </div>
              {order.notes && <p className="order-note">Buyer&rsquo;s note: {order.notes}</p>}
            </div>
          </section>

          <DeliverySection order={order} busy={busy} act={act} onView={setViewing} />

          {['shipped', 'delivered'].includes(order.status) && (
            <DeliveryMap orderId={order._id} canUpdate={order.status === 'shipped'} />
          )}

          <History order={order} />
        </div>

        <PaymentSection order={order} busy={busy} act={act} onView={setViewing} />
      </div>

      {cancelling && (
        <CancelDialog
          order={order}
          onClose={() => setCancelling(false)}
          onConfirm={(reason) => act(async () => {
            await updateOrderStatus(order._id, 'cancelled', reason);
            setCancelling(false);
          }, 'Could not cancel this order.')}
          busy={busy}
        />
      )}

      {viewing && <PrivateFileModal path={viewing.path} title={viewing.title} onClose={() => setViewing(null)} />}
    </div>
  );
}

function DeliveryPhotoUpload({ order, busy, act }) {
  const [note, setNote] = useState('');
  return (
    <div className="form-grid">
      <label className="field">
        <span className="field-label">Who received it? <span className="optional">(optional)</span></span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
      </label>
      <div>
        <label className={`btn btn-primary${busy ? ' is-disabled' : ''}`}>
          {busy ? 'Uploading…' : 'Upload delivery photo'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) act(() => uploadSellerDeliveryProof(order._id, file, note), 'Could not upload the photo.');
            }}
          />
        </label>
      </div>
    </div>
  );
}

function DeliverySection({ order, busy, act, onView }) {
  const d = order.delivery || {};
  const open = !['delivered', 'completed', 'cancelled'].includes(order.status);
  const [riders, setRiders] = useState([]);
  const [mode, setMode] = useState(d.courierName && d.riderUserId == null ? 'courier' : 'rider');
  const [courier, setCourier] = useState({
    courierName: d.riderUserId == null ? d.courierName || '' : '',
    courierContact: d.riderUserId == null ? d.courierContact || '' : '',
    courierReference: d.courierReference || '',
  });

  useEffect(() => {
    if (!open || order.source !== 'storefront') return;
    fetchRiders()
      .then((res) => setRiders(Array.isArray(res.data) ? res.data.filter((r) => r.status !== 'suspended') : []))
      .catch(() => setRiders([]));
  }, [open, order.source]);

  const setC = (key) => (e) => setCourier((c) => ({ ...c, [key]: e.target.value }));
  const carrier = d.riderUserId != null
    ? `${d.courierName || 'Your rider'} (your rider)`
    : d.courierName
      ? `${d.courierName}${d.courierReference ? `, tracking ${d.courierReference}` : ''}`
      : '';

  return (
    <section className="panel">
      <div className="panel-head"><h3>Delivery</h3></div>
      <div className="panel-body stack">
        <dl className="dl">
          <div><dt>Deliver to</dt><dd>{order.customerName}</dd></div>
          {order.customerContact && (
            <div><dt>Mobile</dt><dd><a className="link" href={`tel:${order.customerContact}`}>{order.customerContact}</a></dd></div>
          )}
          {order.deliveryAddress && <div><dt>Address</dt><dd>{order.deliveryAddress}</dd></div>}
          <div><dt>Carried by</dt><dd>{carrier || <span className="muted">Not chosen yet</span>}</dd></div>
          {d.deliveredAt && <div><dt>Delivered</dt><dd>{formatDateTime(d.deliveredAt)}{d.deliveryNote ? `, ${d.deliveryNote}` : ''}</dd></div>}
        </dl>

        {d.proofOfDelivery && (
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onView({ path: d.proofOfDelivery, title: `Delivery photo, ${order.orderNumber}` })}>
              View delivery photo
            </button>
          </div>
        )}

        {open && order.source === 'storefront' && (
          <div className="carrier">
            <div className="tabs" role="tablist" aria-label="Who delivers">
              <button type="button" role="tab" className="tab" aria-selected={mode === 'rider'} onClick={() => setMode('rider')}>Your rider</button>
              <button type="button" role="tab" className="tab" aria-selected={mode === 'courier'} onClick={() => setMode('courier')}>Courier</button>
            </div>

            {mode === 'rider' && (
              order.status === 'pending' ? (
                <p className="muted">Confirm the order first, then choose who delivers it.</p>
              ) : riders.length === 0 ? (
                <p className="muted">You have no delivery people yet. Add one under Delivery.</p>
              ) : (
                <label className="field">
                  <span className="field-label">Rider</span>
                  <select
                    className="select"
                    value={d.riderUserId ?? ''}
                    disabled={busy}
                    onChange={(e) => act(
                      () => assignRider(order._id, e.target.value === '' ? null : Number(e.target.value)),
                      'Could not assign that rider.',
                    )}
                  >
                    <option value="">Nobody yet</option>
                    {riders.map((r) => (
                      <option key={r.userId} value={r.userId}>
                        {r.name}{r.activated ? '' : ' (not signed in yet)'}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">The rider sees only the orders you assign to them.</span>
                </label>
              )
            )}

            {mode === 'courier' && (
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(() => setOrderCourier(order._id, courier), 'Could not save the courier.');
                }}
              >
                <div className="form-grid-3">
                  <label className="field">
                    <span className="field-label">Courier</span>
                    <input className="input" value={courier.courierName} onChange={setC('courierName')} placeholder="LBC, J&T, Lalamove…" autoComplete="off" />
                  </label>
                  <label className="field">
                    <span className="field-label">Tracking or booking no.</span>
                    <input className="input" value={courier.courierReference} onChange={setC('courierReference')} autoComplete="off" spellCheck={false} />
                  </label>
                  <label className="field">
                    <span className="field-label">Driver&rsquo;s mobile <span className="optional">(optional)</span></span>
                    <input className="input" type="tel" inputMode="tel" value={courier.courierContact} onChange={setC('courierContact')} autoComplete="off" />
                  </label>
                </div>
                <div>
                  <button type="submit" className="btn btn-secondary" disabled={busy}>Save courier</button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function PaymentSection({ order, busy, act, onView }) {
  const [reference, setReference] = useState(order.paymentReference || '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const gcash = isGcash(order.paymentMethod);
  // GCash: once there is a receipt to check. Cash: once the rice is on its
  // way, which is when the money is actually handed over.
  const canReview = order.status !== 'cancelled' && order.paymentStatus !== 'paid'
    && (gcash ? Boolean(order.paymentProof) : ['shipped', 'delivered', 'completed'].includes(order.status));
  const history = order.paymentHistory || [];

  const markPaid = (e) => {
    e.preventDefault();
    act(() => reviewOrderPayment(order._id, {
      paid: true,
      reference,
      amount: amount === '' ? undefined : Number(amount),
      note,
    }), 'Could not record the payment.');
  };

  return (
    <aside className="stack">
      <section className="panel">
        <div className="panel-head">
          <h3>Payment</h3>
          <span className={paymentBadge(order.paymentStatus)}>{PAYMENT_LABEL[order.paymentStatus] || 'Unpaid'}</span>
        </div>
        <div className="panel-body stack">
          <dl className="dl totals">
            <div><dt>Rice</dt><dd className="num">{peso(order.subtotal ?? order.total)}</dd></div>
            <div><dt>Delivery</dt><dd className="num">{peso(order.deliveryFee || 0)}</dd></div>
            <div className="totals-sum"><dt>Total</dt><dd className="num">{peso(order.total)}</dd></div>
            <div><dt>Method</dt><dd>{order.paymentMethod === 'Cash/COD' ? 'Cash on delivery' : order.paymentMethod}</dd></div>
            {order.paymentReference && <div><dt>Reference</dt><dd className="num">{order.paymentReference}</dd></div>}
            {order.paymentStatus === 'paid' && (
              <div><dt>Received</dt><dd>{peso(order.amountPaid)} on {formatDateTime(order.paidAt)}</dd></div>
            )}
          </dl>

          {order.paymentProof && (
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onView({ path: order.paymentProof, title: `GCash receipt, ${order.orderNumber}` })}>
                View GCash receipt
              </button>
            </div>
          )}

          {order.paymentStatus === 'rejected' && order.paymentNote && (
            <p className="alert alert-danger">Marked not received: {order.paymentNote}</p>
          )}

          {canReview && !rejecting && (
            <form className="form-grid" onSubmit={markPaid}>
              {gcash && (
                <p className="alert alert-warning">
                  Open your own GCash app and find this transfer before confirming. A screenshot can be edited.
                </p>
              )}
              <label className="field">
                <span className="field-label">{gcash ? 'GCash reference no.' : 'Reference'} {!gcash && <span className="optional">(optional)</span>}</span>
                <input className="input num" value={reference} onChange={(e) => setReference(e.target.value)} inputMode={gcash ? 'numeric' : undefined} autoComplete="off" spellCheck={false} />
              </label>
              <label className="field">
                <span className="field-label">Amount received (₱)</span>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={String(order.total)}
                />
                <span className="field-hint">Leave empty if it is the full amount.</span>
              </label>
              {amount !== '' && Number(amount) < Number(order.total) && (
                <label className="field">
                  <span className="field-label">Why is it less?</span>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
                </label>
              )}
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRejecting(true)}>Not received</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>Mark as paid</button>
              </div>
            </form>
          )}

          {rejecting && (
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                act(() => reviewOrderPayment(order._id, { paid: false, note }), 'Could not record that.');
              }}
            >
              <label className="field">
                <span className="field-label">Tell the buyer what was wrong</span>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nothing arrived in my GCash…" autoComplete="off" />
              </label>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setRejecting(false)}>Back</button>
                <button type="submit" className="btn btn-danger" disabled={busy || !note.trim()}>Mark not received</button>
              </div>
            </form>
          )}
        </div>
      </section>

      {history.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h3>Payment checks</h3></div>
          <ul className="list">
            {history.map((h, i) => (
              <li key={i} className="list-row">
                <span className="list-row-main">
                  <strong>{h.status === 'paid' ? `Transfer of ${peso(h.amount)} confirmed` : 'Marked not received'}</strong>
                  <span>
                    {formatDateTime(h.at)}
                    {h.reference ? `, ref ${h.reference}` : ''}
                    {h.note ? `, ${h.note}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function History({ order }) {
  if (!order.statusHistory?.length) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h3>History</h3></div>
      <ol className="timeline">
        {[...order.statusHistory].reverse().map((h, i) => (
          <li key={`${h.status}-${i}`}>
            <strong>{STATUS_LABEL[h.status] || h.status}</strong>
            <span className="muted">{formatDateTime(h.changedAt)}</span>
            {h.reason && <span>{h.reason}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function CancelDialog({ order, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Cancel ${order.orderNumber}?`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) onConfirm(reason.trim());
        }}
      >
        <div className="modal-body">
          <p>The buyer sees your reason in the app. Any stock this order reserved goes back to your inventory.</p>
          <label className="field">
            <span className="field-label">Reason</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sold out of this variety…" autoComplete="off" />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Keep order</button>
          <button type="submit" className="btn btn-danger" disabled={busy || !reason.trim()}>Cancel order</button>
        </div>
      </form>
    </Modal>
  );
}
