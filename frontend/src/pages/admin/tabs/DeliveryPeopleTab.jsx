import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import {
  fetchRiders,
  addRider,
  resendRiderLink,
  toggleRiderSuspension,
} from '../../../services/riderApi';
import { fetchMyOrders } from '../../../services/clientApi';
import { getErrorMessage } from '../../../services/authApi';
import { ConfirmDialog } from '../../../components/Modal';
import ActionsMenu from '../../../components/ActionsMenu';
import { STATUS_LABEL, statusBadge } from '../orderStatus';

const ON_THE_ROAD = ['confirmed', 'processing', 'shipped'];

function carrierOf(order) {
  const d = order.delivery || {};
  if (d.riderUserId != null) return d.courierName || 'Your rider';
  if (d.courierName) return `${d.courierName}${d.courierReference ? `, ${d.courierReference}` : ''}`;
  return '';
}

/**
 * Who delivers, and what they are carrying right now.
 *
 * A delivery person does not sign themselves up. Their name and email is the
 * whole form: the account is created with a random password nobody is told,
 * not even the seller, and the rider sets their own from the emailed link.
 */
export default function DeliveryPeopleTab() {
  const [, setParams] = useSearchParams();
  const [riders, setRiders] = useState(null);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ name: '', email: '', contact: '' });
  const [suspending, setSuspending] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, o] = await Promise.all([fetchRiders(), fetchMyOrders().catch(() => ({ data: [] }))]);
      setRiders(Array.isArray(r.data) ? r.data : []);
      const list = o.data?.orders || o.data || [];
      setOrders(Array.isArray(list) ? list : []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load your delivery people.'));
      setRiders([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(key, fn, done) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'That did not work. Please try again.'));
    } finally {
      setBusy('');
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy('add');
    setError('');
    setNotice('');
    try {
      const res = await addRider(form);
      setForm({ name: '', email: '', contact: '' });
      setNotice(res.data?.linkSent
        ? `Added. ${res.data.email} gets an email to set their password.`
        : `${res.data?.name} was added, but the email did not go out. Use "Send the link again".`);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not add that person.'));
    } finally {
      setBusy('');
    }
  }

  const road = orders.filter((o) => o.source === 'storefront' && ON_THE_ROAD.includes(o.status));
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <>
      <div className="live" aria-live="polite">
        {error && <p className="alert alert-danger">{error}</p>}
        {notice && <p className="alert alert-success">{notice}</p>}
      </div>

      <div className="split-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>On the road</h2>
                <p>Accepted orders and who is carrying each one.</p>
              </div>
            </div>
            {road.length === 0 ? (
              <div className="empty"><p>No orders are waiting to be delivered.</p></div>
            ) : (
              <ul className="list">
                {road.map((o) => {
                  const carrier = carrierOf(o);
                  return (
                    <li key={o._id}>
                      <button
                        type="button"
                        className="list-row"
                        onClick={() => setParams({ tab: 'orders', order: o._id })}
                      >
                        <span className="list-row-main">
                          <strong>{o.orderNumber}, {o.customerName}</strong>
                          <span>{carrier || 'Nobody assigned yet'}</span>
                        </span>
                        <span className="list-row-side">
                          {!carrier && <span className="badge badge-warning">Needs a carrier</span>}
                          <span className={statusBadge(o.status)}>{STATUS_LABEL[o.status]}</span>
                          <ChevronRight size={16} className="muted" aria-hidden="true" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Your delivery people</h2></div>
            {riders === null ? (
              <div className="skeleton-rows"><div className="skeleton" /><div className="skeleton" /></div>
            ) : riders.length === 0 ? (
              <div className="empty">
                <strong>Nobody yet</strong>
                <p>Add the people who deliver for you. You can then assign them to orders.</p>
              </div>
            ) : (
              <ul className="list">
                {riders.map((rider) => {
                  const suspended = rider.status === 'suspended';
                  return (
                    <li key={rider.userId} className="list-row">
                      <span className="list-row-main">
                        <strong>{rider.name}</strong>
                        <span>{rider.email}{rider.contact ? `, ${rider.contact}` : ''}</span>
                      </span>
                      <span className="list-row-side">
                        {suspended
                          ? <span className="badge badge-danger">Suspended</span>
                          : rider.activated
                            ? <span className="badge badge-success">Active</span>
                            : <span className="badge badge-warning">Not set up yet</span>}
                        <ActionsMenu
                          label={`Actions for ${rider.name}`}
                          items={[
                            {
                              label: 'Send the link again',
                              hidden: rider.activated || suspended,
                              onClick: () => act(
                                `link-${rider.userId}`,
                                () => resendRiderLink(rider.userId),
                                `A new link went to ${rider.email}. Older links stop working.`,
                              ),
                            },
                            suspended
                              ? {
                                label: 'Reinstate',
                                onClick: () => act(
                                  `susp-${rider.userId}`,
                                  () => toggleRiderSuspension(rider.userId),
                                  `${rider.name} can take deliveries again.`,
                                ),
                              }
                              : { label: 'Suspend', danger: true, onClick: () => setSuspending(rider) },
                          ]}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Add a delivery person</h2>
              <p>They get an email to set their own password. You never see it.</p>
            </div>
          </div>
          <form className="panel-body form-grid" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Full name</span>
              <input className="input" required value={form.name} onChange={set('name')} autoComplete="off" />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input className="input" type="email" required spellCheck={false} value={form.email} onChange={set('email')} autoComplete="off" />
            </label>
            <label className="field">
              <span className="field-label">Mobile number <span className="optional">(optional)</span></span>
              <input className="input" type="tel" inputMode="tel" value={form.contact} onChange={set('contact')} placeholder="0917 123 4567" autoComplete="off" />
            </label>
            <div>
              <button className="btn btn-primary" type="submit" disabled={busy === 'add'}>
                {busy === 'add' ? 'Adding…' : 'Add and send the email'}
              </button>
            </div>
          </form>
        </section>
      </div>

      {suspending && (
        <ConfirmDialog
          title={`Suspend ${suspending.name}?`}
          confirmLabel="Suspend"
          danger
          busy={busy === `susp-${suspending.userId}`}
          onClose={() => setSuspending(null)}
          onConfirm={async () => {
            await act(
              `susp-${suspending.userId}`,
              () => toggleRiderSuspension(suspending.userId),
              `${suspending.name} is suspended and can no longer sign in.`,
            );
            setSuspending(null);
          }}
        >
          <p>They are signed out and cannot take deliveries. Orders they already delivered keep their name. You can reinstate them later.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
