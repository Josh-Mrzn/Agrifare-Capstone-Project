import React, { useCallback, useEffect, useState } from 'react';
import { fetchMe } from '../../services/userApi';
import { getErrorMessage } from '../../services/authApi';
import {
  ProfileForm, PasswordForm, NotificationsForm, SignInHistory,
} from '../../components/account/AccountForms';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Password and sign-ins' },
  { id: 'alerts', label: 'Notifications' },
];

/** The Super Admin's own account: the same forms a seller uses. */
export default function SettingsPanel() {
  const [section, setSection] = useState('profile');
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetchMe();
      setMe(res.data?.user || res.data);
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
  if (!me) return <div className="skeleton" style={{ height: 280 }} />;

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Settings">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" className="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {section === 'profile' && (
        <section className="panel">
          <div className="panel-head"><h2>Profile</h2></div>
          <div className="panel-body"><ProfileForm me={me} onSaved={load} /></div>
        </section>
      )}

      {section === 'security' && (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Password</h2>
                <p>Password changes are limited to 5 tries every 15 minutes.</p>
              </div>
            </div>
            <div className="panel-body"><PasswordForm /></div>
          </section>
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
        <section className="panel">
          <div className="panel-head"><h2>Notifications</h2></div>
          <div className="panel-body"><NotificationsForm me={me} onSaved={load} /></div>
        </section>
      )}
    </>
  );
}
