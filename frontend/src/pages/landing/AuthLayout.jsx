import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import logoImg from '../../assets/logo.png';
import './auth.css';

/**
 * The frame for sign-in, sign-up and password reset: the form on the forest
 * panel, the brand on the cream one. `flip` puts the form on the right.
 *
 * `brand`: { badge, headline (node), text, points: [{ title, text }] }
 */
export default function AuthLayout({ title, intro, children, footer, brand, flip = false }) {
  useEffect(() => {
    document.title = `${title} · AgriFair`;
  }, [title]);

  return (
    <div className={`auth${flip ? ' auth-flip' : ''}`}>
      <div className="auth-form-side">
        <Link to="/" className="auth-brand" aria-label="AgriFair home">
          <img src={logoImg} alt="" width="40" height="40" />
          <span translate="no">AgriFair</span>
        </Link>

        <main className="auth-body">
          <h1>{title}</h1>
          {intro && <p className="auth-intro">{intro}</p>}
          {children}
        </main>

        {footer && <p className="auth-footer">{footer}</p>}
      </div>

      {brand && (
        <aside className="auth-brand-side" aria-label="About AgriFair">
          <div className="auth-brand-content">
            <p className="auth-badge"><span aria-hidden="true" />{brand.badge}</p>
            <h2>{brand.headline}</h2>
            <p className="auth-brand-text">{brand.text}</p>
            {brand.points && (
              <ul className="auth-points">
                {brand.points.map((p) => (
                  <li key={p.title}>
                    <strong>{p.title}</strong>
                    <span>{p.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
