import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X, ImagePlus, Wheat } from 'lucide-react';
import {
  fetchMyProducts,
  createProduct,
  updateProduct,
  removeProduct,
  duplicateProduct,
} from '../../../services/clientApi';
import { API_ORIGIN, getErrorMessage } from '../../../services/authApi';
import Modal, { ConfirmDialog } from '../../../components/Modal';
import ActionsMenu from '../../../components/ActionsMenu';
import { peso, number } from '../../../utils/format';

const RICE_VARIETIES = [
  'Jasmine',
  'Sinandomeng',
  'Brown Rice',
  'Black Rice',
  'Red Rice',
  'Glutinous (Malagkit)',
  'Other',
];

const SACK_SIZES = [1, 5, 10, 25, 50];

const EMPTY_FORM = {
  name: '',
  variety: RICE_VARIETIES[0],
  description: '',
  price: '',
  stock: '',
  lowStockThreshold: 20,
  status: 'active',
  weightTiers: [],
  existingImages: [],
  newImageFiles: [],
};

/** What a buyer sees, in one word. */
function availability(p) {
  if (p.status === 'inactive') return { label: 'Hidden', tone: '' };
  if (Number(p.stock) <= 0) return { label: 'Sold out', tone: 'danger' };
  if (Number(p.stock) <= Number(p.lowStockThreshold ?? 20)) return { label: 'Low stock', tone: 'warning' };
  return { label: 'For sale', tone: 'success' };
}

export default function ProductListTab() {
  const [products, setProducts] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null); // null | 'new' | product
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchMyProducts();
      const list = res.data?.products || res.data || [];
      setProducts(Array.isArray(list) ? list : []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load your products.'));
      setProducts([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => (products || []).filter((p) => {
    const matches = !search || p.name.toLowerCase().includes(search.trim().toLowerCase());
    const state = availability(p).label;
    const passes = filter === 'all'
      || (filter === 'sale' && state === 'For sale')
      || (filter === 'attention' && (state === 'Low stock' || state === 'Sold out'))
      || (filter === 'hidden' && state === 'Hidden');
    return matches && passes;
  }), [products, search, filter]);

  async function run(fn, fallback) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(getErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  const confirmDelete = async () => {
    await run(() => removeProduct(deleting._id), 'Could not delete this product.');
    setDeleting(null);
  };

  if (products === null) {
    return <div className="panel"><div className="skeleton-rows"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div></div>;
  }

  const counts = {
    all: products.length,
    sale: products.filter((p) => availability(p).label === 'For sale').length,
    attention: products.filter((p) => ['Low stock', 'Sold out'].includes(availability(p).label)).length,
    hidden: products.filter((p) => p.status === 'inactive').length,
  };

  return (
    <>
      <div className="page-actions">
        <div className="chips" role="group" aria-label="Show">
          {[
            ['all', 'All'], ['sale', 'For sale'], ['attention', 'Low or sold out'], ['hidden', 'Hidden'],
          ].map(([id, label]) => (
            <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label} <span className="chip-count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden="true" /> Add product
        </button>
      </div>

      {error && <p className="alert alert-danger" role="alert">{error}</p>}

      <section className="panel">
        <div className="panel-head">
          <label className="sr-only" htmlFor="product-search">Search products</label>
          <input
            id="product-search"
            className="input search-input"
            type="search"
            placeholder="Search by name…"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            {products.length === 0 ? (
              <>
                <strong>No products yet</strong>
                <p>Add your first rice listing. Buyers see it in the app once it has stock.</p>
                <button className="btn btn-primary" type="button" onClick={() => setEditing('new')}>Add product</button>
              </>
            ) : (
              <p>No products match.</p>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="is-num">Price</th>
                  <th className="is-num">Stock</th>
                  <th>Status</th>
                  <th className="is-actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const state = availability(p);
                  return (
                    <tr key={p._id}>
                      <td className="is-primary">
                        <div className="product-cell">
                          {p.images?.[0]
                            ? <img src={`${API_ORIGIN}${p.images[0]}`} alt="" width="40" height="40" loading="lazy" />
                            : <span className="product-thumb-empty" aria-hidden="true"><Wheat size={18} /></span>}
                          <span className="cell-main">
                            <strong>{p.name}</strong>
                            <span>{p.variety}</span>
                          </span>
                        </div>
                      </td>
                      <td data-label="Price" className="is-num">{peso(p.price)} / kg</td>
                      <td data-label="Stock" className="is-num">{number(p.stock)} kg</td>
                      <td data-label="Status">
                        <span className={`badge${state.tone ? ` badge-${state.tone}` : ''}`}>{state.label}</span>
                      </td>
                      <td className="is-actions">
                        <span className="row-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(p)}>
                            Edit
                          </button>
                          <ActionsMenu
                            label={`More actions for ${p.name}`}
                            items={[
                              {
                                label: p.status === 'inactive' ? 'Show to buyers' : 'Hide from buyers',
                                onClick: () => run(
                                  () => updateProduct(p._id, { status: p.status === 'inactive' ? 'active' : 'inactive' }),
                                  'Could not update this product.',
                                ),
                              },
                              { label: 'Duplicate', onClick: () => run(() => duplicateProduct(p._id), 'Could not duplicate this product.') },
                              { label: 'Delete', danger: true, separatorBefore: true, onClick: () => setDeleting(p) },
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

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete product"
          danger
          busy={busy}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        >
          <p>Buyers will no longer see it. Orders already placed keep their details. This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function ProductForm({ product, onClose, onSaved }) {
  const [form, setForm] = useState(() => (product
    ? {
      name: product.name || '',
      variety: product.variety || RICE_VARIETIES[0],
      description: product.description || '',
      price: product.price ?? '',
      stock: product.stock ?? '',
      lowStockThreshold: product.lowStockThreshold ?? 20,
      status: product.status || 'active',
      weightTiers: product.weightTiers || [],
      existingImages: product.images || [],
      newImageFiles: [],
    }
    : EMPTY_FORM));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const imageCount = form.existingImages.length + form.newImageFiles.length;

  function addImages(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (imageCount + files.length > 5) {
      setError('A product can have up to 5 photos.');
      return;
    }
    const withPreview = files.map((file) => Object.assign(file, { preview: URL.createObjectURL(file) }));
    setForm((f) => ({ ...f, newImageFiles: [...f.newImageFiles, ...withPreview] }));
  }

  function addTier() {
    const used = form.weightTiers.map((t) => Number(t.weightKg));
    const next = SACK_SIZES.find((w) => !used.includes(w)) || '';
    setForm((f) => ({ ...f, weightTiers: [...f.weightTiers, { weightKg: next, discountPercent: 0 }] }));
  }

  const setTier = (idx, key, value) => setForm((f) => ({
    ...f,
    weightTiers: f.weightTiers.map((t, i) => (i === idx ? { ...t, [key]: value } : t)),
  }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || !form.description.trim() || !form.price || form.stock === '') {
      setError('Fill in the name, description, price and stock.');
      return;
    }
    if (imageCount === 0) {
      setError('Add at least one photo. Buyers choose rice by how it looks.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        weightTiers: form.weightTiers
          .filter((t) => t.weightKg)
          .map((t) => ({ weightKg: Number(t.weightKg), discountPercent: Number(t.discountPercent) || 0 })),
      };
      if (product) await updateProduct(product._id, payload);
      else await createProduct(payload);
      await onSaved();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save this product.'));
      setSaving(false);
    }
  }

  return (
    <Modal title={product ? `Edit ${product.name}` : 'Add a product'} size="lg" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          <div className="form-grid-2">
            <label className="field">
              <span className="field-label">Product name</span>
              <input className="input" value={form.name} onChange={set('name')} placeholder="Premium Jasmine…" autoComplete="off" />
            </label>
            <label className="field">
              <span className="field-label">Variety</span>
              <select className="select" value={form.variety} onChange={set('variety')}>
                {RICE_VARIETIES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="field span-all">
              <span className="field-label">Description</span>
              <textarea className="textarea" rows={2} value={form.description} onChange={set('description')} placeholder="Grain, aroma, where it was grown…" />
            </label>
          </div>

          <div className="form-grid-3">
            <label className="field">
              <span className="field-label">Price per kg (₱)</span>
              <input className="input" type="number" inputMode="decimal" min="1" step="0.01" value={form.price} onChange={set('price')} />
            </label>
            <label className="field">
              <span className="field-label">{product ? 'Stock (kg)' : 'Starting stock (kg)'}</span>
              <input className="input" type="number" inputMode="numeric" min="0" value={form.stock} onChange={set('stock')} />
              {product && <span className="field-hint">To record a harvest or a loss, use Inventory instead.</span>}
            </label>
            <label className="field">
              <span className="field-label">Warn me below (kg)</span>
              <input className="input" type="number" inputMode="numeric" min="0" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />
            </label>
          </div>

          <fieldset className="field">
            <legend className="field-label">Sack sizes and bulk discounts</legend>
            <span className="field-hint">Buyers can always buy by the kilo. Add bigger sacks, with a discount if you offer one.</span>
            {form.weightTiers.length > 0 && (
              <ul className="tier-list">
                {form.weightTiers.map((t, idx) => {
                  const each = (Number(form.price) || 0) * (Number(t.weightKg) || 0) * (1 - (Number(t.discountPercent) || 0) / 100);
                  return (
                    <li key={idx} className="tier-row">
                      <label className="sr-only" htmlFor={`tier-w-${idx}`}>Sack size</label>
                      <select id={`tier-w-${idx}`} className="select" value={t.weightKg} onChange={(e) => setTier(idx, 'weightKg', e.target.value)}>
                        <option value="">Size</option>
                        {SACK_SIZES.map((w) => <option key={w} value={w}>{w} kg</option>)}
                      </select>
                      <label className="tier-discount">
                        <input
                          className="input"
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max="100"
                          value={t.discountPercent}
                          onChange={(e) => setTier(idx, 'discountPercent', e.target.value)}
                          aria-label="Discount percent"
                        />
                        <span>% off</span>
                      </label>
                      <span className="tier-price num">{each > 0 ? `${peso(each)} a sack` : ''}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        aria-label="Remove this sack size"
                        onClick={() => setForm((f) => ({ ...f, weightTiers: f.weightTiers.filter((_, i) => i !== idx) }))}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addTier}>Add a sack size</button>
            </div>
          </fieldset>

          <fieldset className="field">
            <legend className="field-label">Photos <span className="optional">({imageCount} of 5)</span></legend>
            <div className="thumbs">
              {form.existingImages.map((src, idx) => (
                <div className="thumb" key={src}>
                  <img src={`${API_ORIGIN}${src}`} alt={`Photo ${idx + 1}`} width="88" height="88" />
                  <button
                    type="button"
                    aria-label={`Remove photo ${idx + 1}`}
                    onClick={() => setForm((f) => ({ ...f, existingImages: f.existingImages.filter((_, i) => i !== idx) }))}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}
              {form.newImageFiles.map((file, idx) => (
                <div className="thumb" key={file.preview}>
                  <img src={file.preview} alt={`New photo ${idx + 1}`} width="88" height="88" />
                  <button
                    type="button"
                    aria-label={`Remove new photo ${idx + 1}`}
                    onClick={() => setForm((f) => ({ ...f, newImageFiles: f.newImageFiles.filter((_, i) => i !== idx) }))}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}
              {imageCount < 5 && (
                <label className="thumb thumb-add">
                  <ImagePlus size={20} aria-hidden="true" />
                  <span>Add</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addImages} />
                </label>
              )}
            </div>
          </fieldset>

          <label className="check">
            <input
              type="checkbox"
              checked={form.status !== 'inactive'}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked ? 'active' : 'inactive' }))}
            />
            Show this product to buyers
          </label>

          {error && <p className="alert alert-danger" role="alert">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : product ? 'Save changes' : 'Add product'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
