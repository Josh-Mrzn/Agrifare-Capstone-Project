import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Boxes, PackageX, Wallet } from 'lucide-react';
import { fetchInventorySummary, restockProduct, adjustStock, fetchStockMovements } from '../../../services/clientApi';
import { getErrorMessage } from '../../../services/authApi';
import Modal from '../../../components/Modal';
import ActionsMenu from '../../../components/ActionsMenu';
import { number, wholePeso, formatDate, formatDateTime } from '../../../utils/format';

function stockState(p) {
  if (p.stock <= 0) return { label: 'Sold out', tone: 'danger' };
  if (p.stock <= p.lowStockThreshold) return { label: 'Low', tone: 'warning' };
  return { label: 'OK', tone: 'success' };
}

const MOVEMENT_LABEL = {
  RESTOCK: 'Added',
  SALE: 'Sold',
  RETURN: 'Returned',
  ADJUSTMENT: 'Count corrected',
  DAMAGE: 'Damaged or spoiled',
};

export default function InventoryTab() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { kind: 'add' | 'correct' | 'history', product }

  const load = useCallback(async () => {
    try {
      const res = await fetchInventorySummary();
      setSummary(res.data);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load your inventory.'));
      setSummary({ products: [], totalStock: 0, lowStockCount: 0, outOfStockCount: 0, stockValue: 0 });
    }
  }, []);

  useEffect(() => {
    // load() sets state only after its await, which this rule cannot see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!summary) {
    return (
      <>
        <div className="skeleton" style={{ height: 96 }} />
        <div className="panel"><div className="skeleton-rows"><div className="skeleton" /><div className="skeleton" /></div></div>
      </>
    );
  }

  const close = () => setDialog(null);
  const saved = async () => {
    setDialog(null);
    await load();
  };

  return (
    <>
      {error && <p className="alert alert-danger" role="alert">{error}</p>}

      <div className="stats">
        <div className="stat">
          <span className="stat-icon"><Boxes size={19} aria-hidden="true" /></span>
          <span className="stat-label">Rice in stock</span>
          <span className="stat-value">{number(summary.totalStock)}<small>kg</small></span>
          <span className="stat-note">Across {summary.products.length} product{summary.products.length === 1 ? '' : 's'}</span>
        </div>
        <div className="stat stat--gold">
          <span className="stat-icon"><AlertTriangle size={19} aria-hidden="true" /></span>
          <span className="stat-label">Running low</span>
          <span className="stat-value">{number(summary.lowStockCount)}</span>
          <span className="stat-note">At or below your warning level</span>
        </div>
        <div className="stat">
          <span className="stat-icon"><PackageX size={19} aria-hidden="true" /></span>
          <span className="stat-label">Sold out</span>
          <span className="stat-value">{number(summary.outOfStockCount)}</span>
          <span className="stat-note">Buyers cannot order these</span>
        </div>
        <div className="stat stat--gold">
          <span className="stat-icon"><Wallet size={19} aria-hidden="true" /></span>
          <span className="stat-label">Stock value</span>
          <span className="stat-value">{wholePeso(summary.stockValue)}</span>
          <span className="stat-note">At your list prices</span>
        </div>
      </div>

      <section className="panel">
        {summary.products.length === 0 ? (
          <div className="empty">
            <strong>No products yet</strong>
            <p>Add a product under Products first. Its stock is managed here.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="is-num">In stock</th>
                  <th className="is-num">Warn below</th>
                  <th>Level</th>
                  <th>Last added</th>
                  <th className="is-actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {summary.products.map((p) => {
                  const state = stockState(p);
                  return (
                    <tr key={p._id}>
                      <td className="is-primary"><strong>{p.name}</strong></td>
                      <td data-label="In stock" className="is-num">{number(p.stock)} kg</td>
                      <td data-label="Warn below" className="is-num muted">{number(p.lowStockThreshold)} kg</td>
                      <td data-label="Level"><span className={`badge badge-${state.tone}`}>{state.label}</span></td>
                      <td data-label="Last added" className="muted">{formatDate(p.lastRestockedAt, 'Never')}</td>
                      <td className="is-actions">
                        <span className="row-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: 'add', product: p })}>
                            Add stock
                          </button>
                          <ActionsMenu
                            label={`More actions for ${p.name}`}
                            items={[
                              { label: 'Correct the count', onClick: () => setDialog({ kind: 'correct', product: p }) },
                              { label: 'Stock history', onClick: () => setDialog({ kind: 'history', product: p }) },
                            ]}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog?.kind === 'add' && <AddStock product={dialog.product} onClose={close} onSaved={saved} />}
      {dialog?.kind === 'correct' && <CorrectStock product={dialog.product} onClose={close} onSaved={saved} />}
      {dialog?.kind === 'history' && <StockHistory product={dialog.product} onClose={close} />}
    </>
  );
}

function AddStock({ product, onClose, onSaved }) {
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!(Number(qty) >= 1)) {
      setError('Enter at least 1 kg.');
      return;
    }
    setSaving(true);
    try {
      await restockProduct(product._id, Number(qty), note);
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not add the stock.'));
      setSaving(false);
    }
  }

  return (
    <Modal title={`Add stock: ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          <p>Record rice you received: a harvest, a delivery from a supplier, or a return.</p>
          <label className="field">
            <span className="field-label">Kilos to add</span>
            <input className="input" type="number" inputMode="numeric" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
            <span className="field-hint num">
              {Number(qty) > 0
                ? `${number(product.stock)} kg now, ${number(Number(product.stock) + Number(qty))} kg after`
                : `${number(product.stock)} kg in stock now`}
            </span>
          </label>
          <label className="field">
            <span className="field-label">Note <span className="optional">(optional)</span></span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Harvest from the north field…" autoComplete="off" />
          </label>
          {error && <p className="alert alert-danger" role="alert">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add stock'}</button>
        </div>
      </form>
    </Modal>
  );
}

function CorrectStock({ product, onClose, onSaved }) {
  const [qty, setQty] = useState('');
  const [type, setType] = useState('ADJUSTMENT');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!Number(qty)) {
      setError('Enter how many kilos to add or remove, for example -5.');
      return;
    }
    setSaving(true);
    try {
      await adjustStock(product._id, Number(qty), type, note);
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not correct the stock.'));
      setSaving(false);
    }
  }

  return (
    <Modal title={`Correct stock: ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          <p>For when the real count differs from AgriFair: spoilage, loss, or a miscount. Sales are recorded automatically.</p>
          <div className="form-grid-2">
            <label className="field">
              <span className="field-label">Change in kilos</span>
              <input className="input" type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="-5" />
              <span className="field-hint num">
                {Number(qty)
                  ? `${number(product.stock)} kg now, ${number(Number(product.stock) + Number(qty))} kg after`
                  : 'Negative removes stock.'}
              </span>
            </label>
            <label className="field">
              <span className="field-label">Reason</span>
              <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="ADJUSTMENT">Miscount</option>
                <option value="DAMAGE">Damaged or spoiled</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field-label">Note <span className="optional">(optional)</span></span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
          </label>
          {error && <p className="alert alert-danger" role="alert">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save correction'}</button>
        </div>
      </form>
    </Modal>
  );
}

function StockHistory({ product, onClose }) {
  const [movements, setMovements] = useState(null);

  useEffect(() => {
    fetchStockMovements(product._id)
      .then((res) => setMovements(res.data || []))
      .catch(() => setMovements([]));
  }, [product._id]);

  return (
    <Modal title={`Stock history: ${product.name}`} size="lg" onClose={onClose}>
      <div className="modal-body">
        {!movements && <div className="skeleton-rows"><div className="skeleton" /><div className="skeleton" /></div>}
        {movements?.length === 0 && <p className="muted">No stock changes recorded yet.</p>}
        {movements?.length > 0 && (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr><th>When</th><th>What</th><th className="is-num">Change</th><th className="is-num">After</th><th>Note</th></tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m._id}>
                    <td className="is-primary">{formatDateTime(m.createdAt)}</td>
                    <td data-label="What">{MOVEMENT_LABEL[m.type] || m.type}</td>
                    <td data-label="Change" className={`is-num ${m.quantity < 0 ? 'text-danger' : 'text-success'}`}>
                      {m.quantity > 0 ? '+' : ''}{number(m.quantity)} kg
                    </td>
                    <td data-label="After" className="is-num">{number(m.resultingStock)} kg</td>
                    <td data-label="Note" className="muted">{m.note || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
