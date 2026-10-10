import React, { useEffect, useRef, useState } from 'react';
import { Menu, X, LogOut } from 'lucide-react';
import logoImg from '../assets/logo.png';
import { initialsOf } from '../utils/format';
import './PortalShell.css';

/**
 * The frame both signed-in portals share: the forest sidebar (a drawer on
 * phones), a greeting with the section's name as the page title, and the
 * account at the foot of the sidebar.
 *
 * `sections`: [{ id, label, icon, count? }]. The page owns which is active.
 */
export default function PortalShell({
  portalName,
  roleLabel,
  workspaceLabel,
  sections,
  active,
  onSelect,
  user,
  onSignOut,
  headerActions,
  children,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navRef = useRef(null);
  const current = sections.find((s) => s.id === active) || sections[0];
  const firstName = (user?.name || '').trim().split(/\s+/)[0];

  useEffect(() => {
    if (!drawerOpen) return undefined;
    navRef.current?.querySelector('[aria-current="page"]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  useEffect(() => {
    document.title = `${current.label} · AgriFair`;
  }, [current.label]);

  const select = (id) => {
    onSelect(id);
    setDrawerOpen(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>

      <aside className={`shell-nav${drawerOpen ? ' is-open' : ''}`} ref={navRef} aria-label={portalName}>
        <div className="shell-brand">
          <img src={logoImg} alt="" width="34" height="34" />
          <div>
            <strong translate="no">AgriFair</strong>
            <span>{portalName}</span>
          </div>
          <button
            type="button"
            className="shell-close"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="shell-links">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                className="shell-link"
                aria-current={s.id === current.id ? 'page' : undefined}
                onClick={() => select(s.id)}
              >
                {Icon && <Icon size={17} strokeWidth={2.1} aria-hidden="true" />}
                <span>{s.label}</span>
                {s.count > 0 && <span className="shell-count">{s.count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="shell-account">
          <div className="shell-user">
            <span className="avatar">{initialsOf(user?.name, user?.email)}</span>
            <div className="shell-user-text">
              <strong>{user?.name || user?.email}</strong>
              <span>{roleLabel}</span>
            </div>
          </div>
          <button type="button" className="shell-logout" onClick={onSignOut}>
            <LogOut size={16} aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>

      {drawerOpen && <div className="shell-overlay" aria-hidden="true" onClick={() => setDrawerOpen(false)} />}

      <div className="shell-main">
        <header className="shell-top">
          <button
            type="button"
            className="shell-menu"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <div className="shell-heading">
            <p className="shell-eyebrow">{workspaceLabel}</p>
            {firstName && <p className="shell-greeting">Hello, {firstName}</p>}
            <h1>{current.label}</h1>
          </div>
          <div className="shell-top-actions">{headerActions}</div>
        </header>

        {/* Keyed by section, so a newly opened section settles in. */}
        <main id="main" key={current.id} className="shell-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
