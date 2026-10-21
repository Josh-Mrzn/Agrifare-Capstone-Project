import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import PrivateFileModal from '../../../components/PrivateFileModal';
import Modal from '../../../components/Modal';
import DeliveryMap from './DeliveryMap';
import { fetchRiders, assignRider } from '../../../services/riderApi';
import {
  updateOrderStatus,
  reviewOrderPayment,
  uploadSellerDeliveryProof,
  decideCancellation,
  recordRefund,
  correctCod,
  resolveProblem,
} from '../../../services/clientApi';
import { getErrorMessage } from '../../../services/authApi';
import { peso, formatDateTime, quantityLabel } from '../../../utils/format';
import { STATUS_LABEL, statusBadge, PAYMENT_LABEL, paymentBadge, METHOD_LABEL } from '../orderStatus';

const BUYER_CONFIRM_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;

const isGcash = (method) => /gcash/i.test(method || '');
const isCod = (method) => !isGcash(method) && method !== 'PayMongo';

const ASSIGNMENT_LABEL = {
  assigned: 'waiting for them to accept',
  accepted: 'accepted',
  declined: 'declined',
};

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
      if (order.paymentMethod === 'PayMongo' && order.paymentStatus !== 'paid') {
        return {
          text: 'Waiting for the buyer to pay online (PayMongo sandbox). It is marked paid automatically, then you can accept it.',
          actions: [{ to: 'confirmed', label: 'Accept order', blocked: true }, { to: 'cancelled', label: 'Decline', ghost: true }],
        };
      }
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
          text: d.assignmentStatus === 'declined'
            ? `Your rider declined this delivery${d.declineReason ? `: ${d.declineReason}` : ''}. Choose someone else under Delivery.`
            : 'Choose which of your riders delivers it, under Delivery.',
          actions: [{ to: 'shipped', label: 'Send out', blocked: true }, { to: 'cancelled', label: 'Cancel order', ghost: true }],
        };
      }
      if (storefront && d.riderUserId != null && d.assignmentStatus === 'assigned') {
        return {
          text: 'Waiting for your rider to accept this delivery in their app.',
          actions: [{ to: 'shipped', label: 'Send out', blocked: true }, { to: 'cancelled', label: 'Cancel order', ghost: true }],
        };
      }
      return {
        text: 'Send it out when it leaves your place. The buyer can follow it on the map.',
        actions: [{ to: 'shipped', label: 'Send out' }, { to: 'cancelled', label: 'Cancel order', ghost: true }],
      };
    case 'shipped':
      if (storefront) {
        return d.riderUserId != null
          ? { text: 'Your rider marks it delivered from their app, with a photo at the door' + (isCod(order.paymentMethod) ? ' and the cash they collected.' : '.') }
          : { text: 'Upload a photo from the door to mark it delivered.', upload: true };
      }
      return { text: 'Mark it delivered once it arrives.', actions: [{ to: 'delivered', label: 'Mark delivered' }] };
    case 'delivered': {
      if (!storefront) {
        return { text: 'Complete the sale to count it in your sales.', actions: [{ to: 'completed', label: 'Complete sale' }] };
      }
      if (order.paymentStatus !== 'paid') {
        return {
          text: isCod(order.paymentMethod)
            ? 'The cash collected does not match the amount due. Correct it under Payment once you have checked with your rider.'
            : 'This order is not marked paid, so it cannot be completed yet.',
        };
      }
      if (order.complaint?.status === 'open') {
        return { text: 'The buyer reported a problem. Resolve it first; the order cannot be completed while it is open.' };
      }
      const since = d.deliveredAt ? Date.now() - new Date(d.deliveredAt).getTime() : 0;
      const canClose = since >= BUYER_CONFIRM_DAYS * DAY;
      const from = d.deliveredAt ? formatDateTime(new Date(new Date(d.deliveredAt).getTime() + BUYER_CONFIRM_DAYS * DAY)) : '';
      return {
        text: canClose
          ? 'The buyer has not confirmed yet. It has been 3 days, so you can complete the sale. It also completes by itself 7 days after delivery.'
          : `Waiting for the buyer to confirm in the app that it arrived. If they do not, you can complete it from ${from}; it completes by itself 7 days after delivery.`,
        actions: [{ to: 'completed', label: 'Complete sale', blocked: !canClose }],
      };
    }
    case 'completed':
      return { text: 'Done. This order is counted in your sales.' };
    case 'cancelled':
      return {
        text: `Cancelled${order.statusReason ? `: ${order.statusReason}` : '.'} Any stock it reserved went back to your inventory.`
          + (order.paymentStatus === 'refund_due' ? ' The buyer paid, so record the refund under Payment once you have sent it.' : ''),
      };
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
          <span className="status-pair">
            <span className="muted">Delivery</span>
            <span className={statusBadge(order.status)}>{STATUS_LABEL[order.status] || order.status}</span>
            <span className="muted">Payment</span>
            <span className={paymentBadge(order.paymentStatus)}>{PAYMENT_LABEL[order.paymentStatus] || 'Unpaid'}</span>
          </span>
        </div>
        <p className="muted">
          Placed {formatDateTime(order.orderDate)}
          {storefront ? ' in the app' : ', recorded by you'}
        </p>
      </div>

      <div className="live" aria-live="polite">{error && <p className="alert alert-danger">{error}</p>}</div>

      <div className="detail-grid">
        <div className="stack">
          <RequestsPanel order={order} busy={busy} act={act} />

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
              {(order.lines || [order]).map((line) => (
                <div className="line-item" key={line._id}>
                  <span className="cell-main">
                    <strong>{line.productName}{line.status === 'cancelled' && order.status !== 'cancelled' ? ' (cancelled)' : ''}</strong>
                    <span>{quantityLabel(line)} at {peso(line.unitPrice)}{line.weightKg > 1 ? ' a sack' : ' a kilo'}</span>
                  </span>
                  <span className="num">{peso(line.subtotal ?? line.total)}</span>
                </div>
              ))}
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
  const cod = isCod(order.paymentMethod);
  const [cash, setCash] = useState('');
  return (
    <div className="form-grid">
      <label className="field">
        <span className="field-label">Who received it? <span className="optional">(optional)</span></span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
      </label>
      {cod && (
        <label className="field">
          <span className="field-label">Cash the courier collected (₱)</span>
          <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} placeholder={String(order.total)} />
          <span className="field-hint">Due: {peso(order.total)}. It counts as paid only if it matches.</span>
        </label>
      )}
      <div>
        <label className={`btn btn-primary${busy || (cod && cash === '') ? ' is-disabled' : ''}`}>
          {busy ? 'Uploading…' : cod && cash === '' ? 'Enter the cash first' : 'Upload delivery photo'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            disabled={busy || (cod && cash === '')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) act(() => uploadSellerDeliveryProof(order._id, file, note, cod ? cash : undefined), 'Could not upload the photo.');
            }}
          />
        </label>
      </div>
    </div>
  );
}

function DeliverySection({ order, busy, act, onView }) {
  const d = order.delivery || {};
  const open = ['pending', 'confirmed', 'processing'].includes(order.status);
  const [riders, setRiders] = useState([]);

  useEffect(() => {
    if (!open || order.source !== 'storefront') return;
    fetchRiders()
      .then((res) => setRiders(Array.isArray(res.data) ? res.data.filter((r) => r.status !== 'suspended') : []))
      .catch(() => setRiders([]));
  }, [open, order.source]);

  const carrier = d.riderUserId != null
    ? `${d.courierName || 'Your rider'} (your rider, ${ASSIGNMENT_LABEL[d.assignmentStatus] || 'accepted'})`
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
          {d.assignmentStatus === 'declined' && d.declineReason && (
            <div><dt>Last rider</dt><dd>Declined: {d.declineReason}</dd></div>
          )}
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
              <span className="field-hint">The rider sees only the orders you assign to them, and accepts them in their app.</span>
            </label>
          )
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
  // Only a GCash receipt waiting to be checked is reviewed by hand. Cash is
  // recorded by whoever collected it at the door; PayMongo confirms itself.
  const canReview = gcash && order.status !== 'cancelled' && order.paymentStatus === 'proof_sent';
  const cod = isCod(order.paymentMethod);
  const codMismatch = cod && order.cashCollected != null && order.paymentStatus === 'unpaid';
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
            <div><dt>Method</dt><dd>{METHOD_LABEL[order.paymentMethod] || order.paymentMethod}</dd></div>
            {order.paymentReference && <div><dt>Reference</dt><dd className="num">{order.paymentReference}</dd></div>}
            {['paid', 'refund_due', 'refunded'].includes(order.paymentStatus) && order.paidAt && (
              <div><dt>Received</dt><dd>{peso(order.amountPaid)} on {formatDateTime(order.paidAt)}</dd></div>
            )}
            {cod && order.cashCollected != null && (
              <div><dt>Cash collected</dt><dd>{peso(order.cashCollected)}</dd></div>
            )}
            {order.paymentStatus === 'refunded' && (
              <div><dt>Refunded</dt><dd>{peso(order.refundAmount)}{order.refund?.reference ? `, ref ${order.refund.reference}` : ''}</dd></div>
            )}
          </dl>

          {order.paymentMethod === 'PayMongo' && order.paymentStatus === 'unpaid' && order.status !== 'cancelled' && (
            <p className="muted">PayMongo marks this paid by itself when the buyer pays. It cannot be marked by hand.</p>
          )}
          {cod && order.paymentStatus === 'unpaid' && order.cashCollected == null && order.status !== 'cancelled' && (
            <p className="muted">Paid at the door. Your rider records the cash when they mark it delivered.</p>
          )}
          {codMismatch && <CodCorrection order={order} busy={busy} act={act} />}
          {order.paymentStatus === 'refund_due' && <RefundForm order={order} busy={busy} act={act} />}

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
          <div className="panel-head"><h3>Payment history</h3></div>
          <ul className="list">
            {history.map((h, i) => (
              <li key={i} className="list-row">
                <span className="list-row-main">
                  <strong>{historyLabel(h)}</strong>
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
            <span className="muted">{formatDateTime(h.changedAt)}{h.by && h.by !== 'seller' ? `, by the ${h.by === 'system' ? 'system' : h.by}` : ''}</span>
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

function historyLabel(h) {
  const amount = peso(h.amount);
  switch (h.kind) {
    case 'resubmit': return 'Buyer sent a new receipt';
    case 'paymongo': return h.status === 'paid' ? `Paid online through PayMongo, ${amount}` : `Paid online after cancelling, ${amount} owed back`;
    case 'cod': return h.status === 'paid' ? `Cash collected, ${amount}` : `Cash collected did not match: ${amount}`;
    case 'correction': return h.status === 'paid' ? `Cash corrected to ${amount}, paid` : `Cash corrected to ${amount}`;
    case 'cancellation': return 'Order cancelled, refund owed';
    case 'refund': return `Refund of ${amount} recorded`;
    default:
      return h.status === 'paid' ? `Transfer of ${amount} confirmed` : h.status === 'rejected' ? 'Marked not received' : h.status;
  }
}

/** A buyer's cancellation request or reported problem, waiting on the seller. */
function RequestsPanel({ order, busy, act }) {
  const [note, setNote] = useState('');
  const requested = order.cancellation?.status === 'requested';
  const problem = order.complaint?.status === 'open';
  if (!requested && !problem) return null;

  if (requested) {
    const paid = ['paid', 'proof_sent'].includes(order.paymentStatus);
    return (
      <section className="panel request-panel">
        <div className="panel-head"><h3>The buyer asked to cancel</h3></div>
        <div className="panel-body stack">
          <p>&ldquo;{order.cancellation.reason}&rdquo;{order.cancellation.requestedAt ? `, ${formatDateTime(order.cancellation.requestedAt)}` : ''}</p>
          <p className="muted">
            Approving cancels the order and returns any stock.{paid ? ' The buyer has paid (or sent a receipt), so the payment becomes a refund you record once sent.' : ''}
            {' '}Declining keeps the order; tell the buyer why.
          </p>
          <label className="field">
            <span className="field-label">Note to the buyer <span className="optional">(required to decline)</span></span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" disabled={busy || !note.trim()} onClick={() => act(() => decideCancellation(order._id, false, note), 'Could not record your answer.')}>
              Decline request
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => act(() => decideCancellation(order._id, true, note), 'Could not cancel the order.')}>
              Approve and cancel
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel request-panel">
      <div className="panel-head"><h3>The buyer reported a problem</h3></div>
      <div className="panel-body stack">
        <p>&ldquo;{order.complaint.reason}&rdquo;{order.complaint.note ? ` ${order.complaint.note}` : ''}</p>
        <p className="muted">The order cannot complete while this is open. Sort it out with the buyer (Messages), then say what was done.</p>
        <label className="field">
          <span className="field-label">How it was resolved</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Replaced the torn sack…" autoComplete="off" />
        </label>
        <div>
          <button type="button" className="btn btn-primary" disabled={busy || !note.trim()} onClick={() => act(() => resolveProblem(order._id, note), 'Could not resolve it.')}>
            Mark resolved
          </button>
        </div>
      </div>
    </section>
  );
}

function CodCorrection({ order, busy, act }) {
  const [amount, setAmount] = useState(String(order.total));
  const [note, setNote] = useState('');
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => correctCod(order._id, Number(amount), note), 'Could not correct the amount.');
      }}
    >
      <p className="alert alert-warning">
        Your rider recorded {peso(order.cashCollected)}, but {peso(order.total)} was due. Check with them, then record what you actually received.
        The first figure stays in the history.
      </p>
      <label className="field">
        <span className="field-label">Cash actually received (₱)</span>
        <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Why it changed</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Rider handed over the rest the next day…" autoComplete="off" />
      </label>
      <div><button type="submit" className="btn btn-primary" disabled={busy || !note.trim() || amount === ''}>Save correction</button></div>
    </form>
  );
}

function RefundForm({ order, busy, act }) {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const owed = order.amountPaid;
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => recordRefund(order._id, { amount: amount === '' ? undefined : Number(amount), reference, note }), 'Could not record the refund.');
      }}
    >
      <p className="alert alert-danger">
        This order was cancelled after the buyer paid {owed ? peso(owed) : ''}. Send the money back, then record it here.
      </p>
      <label className="field">
        <span className="field-label">Amount refunded (₱)</span>
        <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(owed || 0)} />
        <span className="field-hint">Leave empty if it is the full amount.</span>
      </label>
      <label className="field">
        <span className="field-label">GCash reference of the refund</span>
        <input className="input num" value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label className="field">
        <span className="field-label">Note <span className="optional">(required if less, or no reference)</span></span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
      </label>
      <div><button type="submit" className="btn btn-primary" disabled={busy}>Record refund</button></div>
    </form>
  );
}
