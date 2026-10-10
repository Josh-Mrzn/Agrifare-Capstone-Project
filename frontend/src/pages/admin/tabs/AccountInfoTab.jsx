import React, { useCallback, useEffect, useState } from 'react';
import { X, ImagePlus } from 'lucide-react';
import { fetchMe, updateAccount } from '../../../services/userApi';
import { API_ORIGIN, getErrorMessage } from '../../../services/authApi';
import PrivateImage from '../../../components/PrivateImage';
import {
  ProfileForm, PasswordForm, NotificationsForm, SignInHistory, FormStatus,
} from '../../../components/account/AccountForms';
import { initialsOf, formatDate } from '../../../utils/format';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'business', label: 'Business' },
  { id: 'documents', label: 'Documents' },
  { id: 'payment', label: 'GCash' },
  { id: 'delivery', label: 'Pickup and delivery' },
  { id: 'security', label: 'Password and sign-ins' },
  { id: 'alerts', label: 'Notifications' },
];

const PAYOUT = {
  unset: { tone: '', label: 'GCash not set up', text: 'Not set up yet. Buyers can only pay you cash on delivery.' },
  pending: { tone: 'warning', label: 'GCash under review', text: 'Waiting for the AgriFair team to check it. Cash on delivery still works meanwhile.' },
  verified: { tone: 'success', label: 'GCash verified', text: 'Verified. Buyers can pay you by GCash.' },
  rejected: { tone: 'danger', label: 'GCash not approved', text: 'Not approved. Fix the details below and save again.' },
};

export default function AccountInfoTab() {
  const [section, setSection] = useState('profile');
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetchMe();
      setMe(res.data);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load your account.'));
    }
  }, []);

  useEffect(() => {
    // load() sets state only after its await, which this rule cannot see.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (error) return <p className="alert alert-danger">{error}</p>;
  if (!me) return <div className="skeleton" style={{ height: 320 }} />;

  const payout = PAYOUT[me.payout?.status] || PAYOUT.unset;

  return (
    <>
      <section className="panel account-id">
        <span className="avatar avatar-lg">
          {me.avatarUrl ? <img src={`${API_ORIGIN}${me.avatarUrl}`} alt="" /> : initialsOf(me.name, me.email)}
        </span>
        <div className="cell-main">
          <strong className="account-name">{me.sellerProfile?.businessName || me.name}</strong>
          <span>{me.email}{me.createdAt ? `, seller since ${formatDate(me.createdAt)}` : ''}</span>
        </div>
        <span className={`badge${payout.tone ? ` badge-${payout.tone}` : ''}`}>{payout.label}</span>
      </section>

      <div className="tabs" role="tablist" aria-label="Account sections">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" className="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {section === 'profile' && (
        <Section title="Profile" text="How buyers and the AgriFair team see you.">
          <ProfileForm me={me} onSaved={load} withPhoto />
        </Section>
      )}
      {section === 'business' && <BusinessSection me={me} onSaved={load} />}
      {section === 'documents' && <DocumentsSection me={me} onSaved={load} />}
      {section === 'payment' && <PaymentSection me={me} onSaved={load} state={payout} />}
      {section === 'delivery' && <DeliverySection me={me} onSaved={load} />}
      {section === 'security' && (
        <>
          <Section title="Password" text="At least 6 characters. You stay signed in after changing it.">
            <PasswordForm />
          </Section>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Recent sign-ins</h2>
                <p>If you see one you do not recognise, change your password.</p>
              </div>
            </div>
            <SignInHistory />
          </section>
        </>
      )}
      {section === 'alerts' && (
        <Section title="Notifications" text="What the bell at the top tells you about.">
          <NotificationsForm me={me} onSaved={load} />
        </Section>
      )}
    </>
  );
}

function Section({ title, text, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {text && <p>{text}</p>}
        </div>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/** Saves through updateAccount and reports back; shared by the sections below. */
function useSave(onSaved, okText, failText) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const save = async (data) => {
    setSaving(true);
    setStatus(null);
    try {
      await updateAccount(data);
      setStatus({ ok: true, text: okText });
      await onSaved();
      return true;
    } catch (err) {
      setStatus({ ok: false, text: getErrorMessage(err, failText) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { saving, status, setStatus, save };
}

const SELLER_TYPES = [
  { id: 'farmer', label: 'Farmer: I grow the rice I sell' },
  { id: 'cooperative', label: 'Cooperative: we farm as a group' },
  { id: 'trader', label: 'Trader: I buy and resell in bulk' },
  { id: 'retailer', label: 'Retailer: I sell from a shop or stall' },
];

function BusinessSection({ me, onSaved }) {
  const sp = me.sellerProfile || {};
  const [form, setForm] = useState({
    sellerType: me.sellerType || 'farmer',
    businessName: sp.businessName || '',
    businessAddress: sp.businessAddress || '',
    farmName: sp.farmName || '',
    farmLocation: sp.farmLocation || '',
    farmSize: sp.farmSize || '',
  });
  const [photos, setPhotos] = useState(sp.farmPhotos || []);
  const [newPhotos, setNewPhotos] = useState([]);
  const { saving, status, save } = useSave(onSaved, 'Business details saved.', 'Could not save your business details.');
  const farms = form.sellerType === 'farmer' || form.sellerType === 'cooperative';
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const ok = await save({
      sellerType: form.sellerType,
      sellerProfile: {
        businessName: form.businessName,
        businessAddress: form.businessAddress,
        farmName: farms ? form.farmName : '',
        farmLocation: farms ? form.farmLocation : '',
        farmSize: farms ? form.farmSize : '',
        farmPhotos: photos,
      },
      farmPhotoFiles: newPhotos,
    });
    if (ok) setNewPhotos([]);
  }

  return (
    <Section title="Business" text="Shown to buyers on your shop page.">
      <form className="form-grid" onSubmit={submit}>
        <div className="form-grid-2">
          <label className="field">
            <span className="field-label">What kind of seller are you?</span>
            <select className="select" value={form.sellerType} onChange={set('sellerType')}>
              {SELLER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Business name</span>
            <input className="input" value={form.businessName} onChange={set('businessName')} placeholder="As registered with DTI or SEC" autoComplete="organization" />
          </label>
          <label className="field span-all">
            <span className="field-label">Business address</span>
            <input className="input" value={form.businessAddress} onChange={set('businessAddress')} autoComplete="street-address" />
          </label>
        </div>

        {farms && (
          <>
            <div className="form-grid-3">
              <label className="field">
                <span className="field-label">Farm name</span>
                <input className="input" value={form.farmName} onChange={set('farmName')} autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">Location</span>
                <input className="input" value={form.farmLocation} onChange={set('farmLocation')} placeholder="Town, province" autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">Size</span>
                <input className="input" value={form.farmSize} onChange={set('farmSize')} placeholder="5 hectares" autoComplete="off" />
              </label>
            </div>
            <fieldset className="field">
              <legend className="field-label">Farm photos <span className="optional">(up to 5)</span></legend>
              <div className="thumbs">
                {photos.map((src, i) => (
                  <div className="thumb" key={src}>
                    <img src={`${API_ORIGIN}${src}`} alt={`Farm photo ${i + 1}`} width="88" height="88" />
                    <button type="button" aria-label={`Remove farm photo ${i + 1}`} onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}>
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {newPhotos.map((f, i) => (
                  <div className="thumb" key={f.preview}>
                    <img src={f.preview} alt={`New farm photo ${i + 1}`} width="88" height="88" />
                    <button type="button" aria-label={`Remove new farm photo ${i + 1}`} onClick={() => setNewPhotos((p) => p.filter((_, j) => j !== i))}>
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {photos.length + newPhotos.length < 5 && (
                  <label className="thumb thumb-add">
                    <ImagePlus size={20} aria-hidden="true" />
                    <span>Add</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      hidden
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        e.target.value = '';
                        setNewPhotos((prev) => [...prev, ...files.map((f) => Object.assign(f, { preview: URL.createObjectURL(f) }))].slice(0, 5 - photos.length));
                      }}
                    />
                  </label>
                )}
              </div>
            </fieldset>
          </>
        )}

        <FormStatus status={status} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save business details'}</button>
        </div>
      </form>
    </Section>
  );
}

const DOC_TYPES = [
  { id: 'BIR', label: 'BIR Certificate of Registration', hint: 'Form 2303' },
  { id: 'DTI', label: 'DTI Business Name', hint: 'Sole proprietors' },
  { id: 'SEC', label: 'SEC Registration', hint: 'Corporations and partnerships' },
  { id: 'MAYORS_PERMIT', label: "Mayor's or business permit", hint: 'From your city or municipality' },
  { id: 'BARANGAY', label: 'Barangay clearance', hint: 'From your barangay hall' },
  { id: 'ORGANIC_CERT', label: 'Organic certification', hint: 'Only if you sell rice as organic' },
];

const DOC_STATE = {
  pending: { tone: 'warning', label: 'Under review' },
  verified: { tone: 'success', label: 'Verified' },
  rejected: { tone: 'danger', label: 'Rejected' },
};

function DocumentsSection({ me, onSaved }) {
  const [type, setType] = useState(DOC_TYPES[0].id);
  const [referenceNo, setReferenceNo] = useState('');
  const [file, setFile] = useState(null);
  const { saving, status, setStatus, save } = useSave(onSaved, 'Uploaded. The AgriFair team will review it.', 'Could not upload that document.');
  const byType = Object.fromEntries((me.documents || []).map((d) => [d.type, d]));

  async function submit(e) {
    e.preventDefault();
    if (!file) {
      setStatus({ ok: false, text: 'Choose the file to upload.' });
      return;
    }
    const ok = await save({ documentFile: file, documentMeta: { type, referenceNo } });
    if (ok) {
      setFile(null);
      setReferenceNo('');
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Business documents</h2>
            <p>Proof that you may sell rice. Stored privately; buyers only see a verified badge, never the file.</p>
          </div>
        </div>
        <ul className="list">
          {DOC_TYPES.map((d) => {
            const doc = byType[d.id];
            const state = doc ? DOC_STATE[doc.status] : null;
            return (
              <li key={d.id} className="list-row">
                <span className="list-row-main">
                  <strong>{d.label}</strong>
                  <span>{doc?.rejectionReason ? `Rejected: ${doc.rejectionReason}` : d.hint}</span>
                </span>
                <span className={`badge${state ? ` badge-${state.tone}` : ''}`}>{state ? state.label : 'Not uploaded'}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <Section title="Upload a document">
        <form className="form-grid" onSubmit={submit}>
          <div className="form-grid-3">
            <label className="field">
              <span className="field-label">Document</span>
              <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
                {DOC_TYPES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Reference no. <span className="optional">(optional)</span></span>
              <input className="input" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} placeholder="TIN or permit number" autoComplete="off" />
            </label>
            <label className="field">
              <span className="field-label">File</span>
              <input
                className="input input-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <span className="field-hint">A photo or a PDF.</span>
            </label>
          </div>
          <FormStatus status={status} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Uploading…' : 'Upload for review'}</button>
          </div>
        </form>
      </Section>
    </>
  );
}

function PaymentSection({ me, onSaved, state }) {
  const payout = me.payout || {};
  const [form, setForm] = useState({
    method: payout.method || 'gcash',
    accountName: payout.accountName || '',
    accountNumber: payout.accountNumber || '',
  });
  const [qrFile, setQrFile] = useState(null);
  const [qrPreview, setQrPreview] = useState('');
  const { saving, status, setStatus, save } = useSave(onSaved, 'Saved. The AgriFair team will check it before buyers see it.', 'Could not save your GCash details.');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.accountName.trim()) {
      setStatus({ ok: false, text: 'Enter the name on your GCash account exactly.' });
      return;
    }
    if (!form.accountNumber.trim() && !qrFile && !payout.qrImage) {
      setStatus({ ok: false, text: 'Add your GCash number or upload your QR code.' });
      return;
    }
    if (await save({ payout: form, paymentQrFile: qrFile })) setQrFile(null);
  }

  return (
    <Section title="GCash" text="Buyers pay straight to your own GCash. AgriFair never holds your money.">
      <form className="form-grid" onSubmit={submit}>
        <p className={`alert alert-${state.tone || 'info'}`}>
          {state.text}
          {payout.status === 'rejected' && payout.rejectionReason ? ` Reason: ${payout.rejectionReason}` : ''}
        </p>

        <div className="payout-grid">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">GCash number</span>
              <input className="input" type="tel" inputMode="tel" value={form.accountNumber} onChange={set('accountNumber')} placeholder="0917 123 4567" autoComplete="off" />
            </label>
            <label className="field">
              <span className="field-label">Account name</span>
              <input className="input" value={form.accountName} onChange={set('accountName')} autoComplete="off" />
              <span className="field-hint">Exactly as GCash shows it. Buyers check this name before they send money.</span>
            </label>
          </div>

          <div className="field">
            <span className="field-label">QR code</span>
            <div className="qr-box">
              {qrPreview
                ? <img src={qrPreview} alt="Your new GCash QR code" />
                : payout.qrImage
                  ? <PrivateImage path={payout.qrImage} alt="Your GCash QR code" />
                  : <span className="muted">No QR code yet</span>}
            </div>
            <label className="btn btn-secondary btn-sm">
              {payout.qrImage || qrPreview ? 'Replace QR code' : 'Upload QR code'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setQrFile(file);
                  setQrPreview(URL.createObjectURL(file));
                }}
              />
            </label>
          </div>
        </div>

        <p className="field-hint">Saving sends your details for review again, so buyers never see a QR code nobody has checked.</p>
        <FormStatus status={status} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save GCash details'}</button>
        </div>
      </form>
    </Section>
  );
}

function DeliverySection({ me, onSaved }) {
  const [form, setForm] = useState({
    pickupAddress: me.pickupAddress || '',
    deliveryOrigin: me.deliveryOrigin || '',
    deliveryFee: me.deliveryFee ?? 80,
  });
  const { saving, status, save } = useSave(onSaved, 'Saved.', 'Could not save.');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Section title="Pickup and delivery" text="Where your riders collect orders, and what you charge to deliver.">
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save(form);
        }}
      >
        <div className="form-grid-2">
          <label className="field span-all">
            <span className="field-label">Pickup address</span>
            <input className="input" value={form.pickupAddress} onChange={set('pickupAddress')} placeholder="Where riders collect orders" autoComplete="street-address" />
            <span className="field-hint">To pin it on the map, open any order out for delivery and use "Pin my shop here".</span>
          </label>
          <label className="field">
            <span className="field-label">Delivery fee per order (₱)</span>
            <input className="input" type="number" inputMode="numeric" min="0" max="5000" step="1" value={form.deliveryFee} onChange={set('deliveryFee')} />
            <span className="field-hint">Charged once per order from your shop, however many sacks are in it. Set 0 for free delivery.</span>
          </label>
          <label className="field">
            <span className="field-label">You deliver around <span className="optional">(optional)</span></span>
            <input className="input" value={form.deliveryOrigin} onChange={set('deliveryOrigin')} placeholder="Cabanatuan and nearby towns" autoComplete="off" />
          </label>
        </div>
        <FormStatus status={status} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Section>
  );
}
