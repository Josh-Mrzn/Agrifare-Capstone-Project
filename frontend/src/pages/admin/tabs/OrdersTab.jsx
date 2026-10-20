import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import OrderDetailView from '../components/OrderDetailView';
import Modal from '../../../components/Modal';
import { fetchMyOrders, fetchMyProducts, recordSale } from '../../../services/clientApi';
import { getErrorMessage } from '../../../services/authApi';
import { wholePeso, peso, number, formatDate, quantityLabel } from '../../../utils/format';
import { STATUS_LABEL, statusBadge, PAYMENT_LABEL, paymentBadge, METHOD_LABEL, groupSellerOrders } from '../orderStatus';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'New' },
  { id: 'active', label: 'In progress', statuses: ['confirmed', 'processing', 'shipped'] },
  { id: 'delivered', label: 'Delivered', statuses: ['delivered'] },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const matches = (filter, order) => {
  if (filter.id === 'all') return true;
  return (filter.statuses || [filter.id]).includes(order.status);
};

export default function OrdersTab() {
  const [params, setParams] = useSearchParams();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [filterId, setFilterId] = useState('all');
  const [recording, setRecording] = useState(false);

  // The open order is in the URL (?tab=orders&order=…), so notifications
  // can link straight to it and Back returns to the list.
  const openId = params.get('order');
  const open = (id) => setParams(id ? { tab: 'orders', order: id } : { tab: 'orders' });

  const load = useCallback(async () => {
    try {
      const res = await fetchMyOrders();
      const list = res.data?.orders || res.data || [];
      setOrders(Array.isArray(list) ? groupSellerOrders(list) : []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load your orders.'));
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    // load() sets state only after its await, which this rule cannot see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filter = FILTERS.find((f) => f.id === filterId);
  const shown = useMemo(() => (orders || []).filter((o) => matches(filter, o)), [orders, filter]);
  // A notification may link to any line of the order.
  const selected = (orders || []).find((o) => o.ids.includes(openId));

  if (orders === null) {
    return <div className="panel"><div className="skeleton-rows"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div></div>;
  }

  if (selected) {
    return <OrderDetailView order={selected} onBack={() => open(null)} onChanged={load} />;
  }

  return (
    <>
      <div className="page-actions">
        <div className="chips" role="group" aria-label="Show orders">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={filterId === f.id} onClick={() => setFilterId(f.id)}>
              {f.label} <span className="chip-count">{orders.filter((o) => matches(f, o)).length}</span>
            </button>
          ))}
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => setRecording(true)}>
          <Plus size={16} aria-hidden="true" /> Record a sale
        </button>
      </div>

      {error && <p className="alert alert-danger" role="alert">{error}</p>}

      <section className="panel">
        {shown.length === 0 ? (
          <div className="empty">
            {orders.length === 0 ? (
              <>
                <strong>No orders yet</strong>
                <p>Orders placed in the app appear here. Use Record a sale for rice you sold in person.</p>
              </>
            ) : (
              <p>No {filter.label.toLowerCase()} orders.</p>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Rice</th>
                  <th>Payment</th>
                  <th>Delivery</th>
                  <th className="is-num">Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o._id} className="is-clickable" onClick={() => open(o._id)}>
                    <td className="is-primary">
                      <span className="cell-main">
                        <button type="button" className="row-link" onClick={(e) => { e.stopPropagation(); open(o._id); }}>
                          {o.orderNumber}
                        </button>
                        <span>{o.customerName}</span>
                      </span>
                    </td>
                    <td data-label="Rice">
                      <span className="cell-main">
                        <span className="text-strong">{o.lines.length > 1 ? o.lines.map((l) => l.productName).join(', ') : o.productName}</span>
                        <span>{o.lines.length > 1 ? `${o.lines.length} lines` : quantityLabel(o)}</span>
                      </span>
                    </td>
                    <td data-label="Payment">
                      <span className="cell-main">
                        <span className={paymentBadge(o.paymentStatus)}>{PAYMENT_LABEL[o.paymentStatus] || 'Unpaid'}</span>
                        <span>{METHOD_LABEL[o.paymentMethod] || o.paymentMethod}</span>
                      </span>
                    </td>
                    <td data-label="Delivery">
                      <span className="cell-main">
                        <span className={statusBadge(o.status)}>{STATUS_LABEL[o.status] || o.status}</span>
                        {o.cancellation?.status === 'requested' && <span className="text-danger">Cancellation requested</span>}
                        {o.complaint?.status === 'open' && <span className="text-danger">Problem reported</span>}
                      </span>
                    </td>
                    <td data-label="Total" className="is-num">{wholePeso(o.total)}</td>
                    <td data-label="Date" className="muted">{formatDate(o.orderDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {recording && (
        <RecordSale
          onClose={() => setRecording(false)}
          onSaved={async () => {
            setRecording(false);
            await load();
          }}
        />
      )}
    </>
  );
}

const EMPTY_SALE = {
  productId: '',
  customerName: '',
  customerContact: '',
  deliveryAddress: '',
  quantity: 1,
  unitPrice: '',
  deliveryFee: 0,
  paymentMethod: 'Cash/COD',
  orderDate: new Date().toISOString().slice(0, 10),
  status: 'completed',
  notes: '',
};

/** A sale made in person, so it counts in stock and in the reports. */
function RecordSale({ onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(EMPTY_SALE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMyProducts()
      .then((res) => setProducts(res.data?.products || res.data || []))
      .catch(() => setProducts([]));
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const product = products.find((p) => p._id === form.productId);
  const total = (Number(form.quantity) || 0) * (Number(form.unitPrice) || 0) + (Number(form.deliveryFee) || 0);

  async function submit(e) {
    e.preventDefault();
    if (!form.productId || !form.customerName.trim() || !(Number(form.quantity) >= 1)) {
      setError('Choose the rice, enter the customer and at least 1 kg.');
      return;
    }
    setSaving(true);
    try {
      await recordSale({
        ...form,
        quantity: Number(form.quantity),
        unitPrice: form.unitPrice === '' ? undefined : Number(form.unitPrice),
        deliveryFee: Number(form.deliveryFee) || 0,
      });
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not record this sale.'));
      setSaving(false);
    }
  }

  return (
    <Modal title="Record a sale" size="lg" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          <p>For rice sold in person or over the phone. It is taken from your stock and counted in your sales.</p>
          <div className="form-grid-2">
            <label className="field span-all">
              <span className="field-label">Rice</span>
              <select
                className="select"
                value={form.productId}
                onChange={(e) => {
                  const chosen = products.find((p) => p._id === e.target.value);
                  setForm((f) => ({ ...f, productId: e.target.value, unitPrice: chosen ? chosen.price : '' }));
                }}
              >
                <option value="">Choose a product</option>
                {products.map((p) => (
                  <option key={p._id} value={p._id}>{p.name} ({number(p.stock)} kg in stock)</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Customer name</span>
              <input className="input" value={form.customerName} onChange={set('customerName')} autoComplete="off" />
            </label>
            <label className="field">
              <span className="field-label">Mobile number <span className="optional">(optional)</span></span>
              <input className="input" type="tel" inputMode="tel" value={form.customerContact} onChange={set('customerContact')} autoComplete="off" />
            </label>
          </div>
          <div className="form-grid-3">
            <label className="field">
              <span className="field-label">Kilos sold</span>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                min="1"
                max={product?.stock || undefined}
                value={form.quantity}
                onChange={set('quantity')}
              />
            </label>
            <label className="field">
              <span className="field-label">Price per kg (₱)</span>
              <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.unitPrice} onChange={set('unitPrice')} />
            </label>
            <label className="field">
              <span className="field-label">Delivery fee (₱)</span>
              <input className="input" type="number" inputMode="decimal" min="0" step="1" value={form.deliveryFee} onChange={set('deliveryFee')} />
            </label>
            <label className="field">
              <span className="field-label">Paid with</span>
              <select className="select" value={form.paymentMethod} onChange={set('paymentMethod')}>
                <option value="Cash/COD">Cash</option>
                <option value="GCash">GCash</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Date</span>
              <input className="input" type="date" value={form.orderDate} onChange={set('orderDate')} />
            </label>
            <label className="field">
              <span className="field-label">Status</span>
              <select className="select" value={form.status} onChange={set('status')}>
                <option value="completed">Done, handed over</option>
                <option value="confirmed">Accepted, not delivered yet</option>
                <option value="pending">Not accepted yet</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field-label">Delivery address <span className="optional">(optional)</span></span>
            <input className="input" value={form.deliveryAddress} onChange={set('deliveryAddress')} autoComplete="off" />
          </label>
          <p className="sale-total">Total <strong className="num">{peso(total)}</strong></p>
          {error && <p className="alert alert-danger" role="alert">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Record sale'}</button>
        </div>
      </form>
    </Modal>
  );
}
