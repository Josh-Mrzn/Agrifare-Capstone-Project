import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Menu, X, Download, Copy, Check, ArrowRight, BadgeCheck, Scale, Wallet, Truck,
  Sprout, MapPin, Camera, MessageCircle, Store, Bike,
} from 'lucide-react';
import QRCode from 'qrcode';
import logoImg from '../assets/logo.png';
import riceStalk from '../assets/rice-stalk.webp';
import { APP_DOWNLOAD_URL } from '../utils/appLinks';
import useReveal from '../hooks/useReveal';
import HighlightsSection from './landing/HighlightsSection';
import './LandingPage.css';

const NAV = [
  { id: 'features', label: 'Features' },
  { id: 'sellers', label: 'For sellers' },
  { id: 'how-to-use', label: 'How it works' },
  { id: 'story', label: 'Our story' },
  { id: 'download', label: 'Get the app' },
];

/** What is true of every order, said in a few words each. */
const FACTS = [
  { icon: BadgeCheck, title: 'Verified sellers', text: 'Every shop is reviewed' },
  { icon: Scale, title: 'Priced per sack', text: '1, 25 or 50 kg' },
  { icon: Wallet, title: 'Cash or GCash', text: 'Paid straight to the seller' },
  { icon: Truck, title: 'Tracked delivery', text: 'With a photo at the door' },
];

const FEATURES = [
  { icon: Sprout, title: 'Straight from the farm', text: 'Buy from farmers and cooperatives directly, not from a middleman’s truck.' },
  { icon: Scale, title: 'Clear prices per sack', text: 'A price per kilo, with discounts on 25 kg and 50 kg sacks shown before you buy.' },
  { icon: Wallet, title: 'Pay your way', text: 'Cash on delivery, or GCash to the seller’s own account. AgriFair never holds your money.' },
  { icon: MapPin, title: 'Follow your order', text: 'Watch the rider on the map, from the shop to your door.' },
  { icon: Camera, title: 'Proof at the door', text: 'Every delivery ends with a photo, and your own tap to say it arrived.' },
  { icon: MessageCircle, title: 'Talk to the seller', text: 'Ask about a variety, a sack size or a delivery in the app’s chat.' },
];

const STEPS = [
  { title: 'Install AgriFair', text: 'Scan the code on this page and install the buyer app on your Android phone.' },
  { title: 'Sign up or sign in', text: 'Create an account with your email, then confirm it with the code we send.' },
  { title: 'Choose your rice', text: 'Browse shops, compare varieties and sack sizes, and message a seller if you need to.' },
  { title: 'Order and track', text: 'Pay by cash on delivery or GCash, then follow the order until it reaches you.' },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [qrSrc, setQrSrc] = useState('');
  const [copied, setCopied] = useState(false);
  const topRef = useRef(null);

  useReveal();

  useEffect(() => {
    document.title = 'AgriFair: rice straight from the farm';
  }, []);

  // The header turns solid once the top of the hero leaves the screen.
  // Watched with an observer rather than on every scroll event.
  useEffect(() => {
    const sentinel = topRef.current;
    if (!sentinel || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Drawn from the live download link, so the code can never point at an
  // old host after the APK moves.
  useEffect(() => {
    QRCode.toDataURL(APP_DOWNLOAD_URL, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#122112', light: '#ffffff' },
    })
      .then(setQrSrc)
      .catch(() => setQrSrc(''));
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const wide = window.matchMedia('(min-width: 901px)');
    const onWide = (e) => e.matches && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [menuOpen]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(APP_DOWNLOAD_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="lp">
      <a className="skip-link" href="#main">Skip to content</a>
      <span ref={topRef} className="lp-top-sentinel" aria-hidden="true" />

      <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}${menuOpen ? ' is-open' : ''}`}>
        <div className="lp-nav-inner">
          <Link to="/" className="lp-logo" aria-label="AgriFair home">
            <img src={logoImg} alt="" width="38" height="38" />
            <span translate="no">AgriFair</span>
          </Link>

          <nav className="lp-nav-links" aria-label="Main">
            {NAV.map((item) => <a key={item.id} href={`#${item.id}`}>{item.label}</a>)}
          </nav>

          <Link to="/login" className="lp-pill lp-pill-dark lp-nav-cta">Sign in</Link>

          <button
            type="button"
            className="lp-nav-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="lp-sheet"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </div>

        {menuOpen && (
          <nav id="lp-sheet" className="lp-sheet" aria-label="Main">
            {NAV.map((item) => (
              <a key={item.id} href={`#${item.id}`} onClick={() => setMenuOpen(false)}>
                {item.label} <ArrowRight size={16} aria-hidden="true" />
              </a>
            ))}
            <div className="lp-sheet-actions">
              <Link to="/login" className="lp-pill lp-pill-dark">Sign in</Link>
              <Link to="/register" className="lp-pill lp-pill-light">Register as a seller</Link>
            </div>
          </nav>
        )}
      </header>
      {menuOpen && <div className="lp-backdrop" aria-hidden="true" onClick={() => setMenuOpen(false)} />}

      <main id="main">
        {/* ── Hero ── */}
        <section className="lp-hero">
          <div className="lp-hero-bg" aria-hidden="true">
            <span className="lp-glow lp-glow-green" />
            <span className="lp-glow lp-glow-gold" />
          </div>

          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-badge lp-enter" style={{ '--d': 0 }}>
                <span className="lp-badge-dot" aria-hidden="true" />
                Direct from Filipino rice farms
              </p>
              <h1 className="lp-hero-title lp-enter" style={{ '--d': 1 }}>
                Rice from the farm,
                <span className="lp-hero-accent">at the farmer’s price.</span>
              </h1>
              <p className="lp-hero-sub lp-enter" style={{ '--d': 2 }}>
                AgriFair connects rice farmers and traders straight to buyers, with clear prices
                per sack and delivery you can follow.
              </p>
              <div className="lp-hero-actions lp-enter" style={{ '--d': 3 }}>
                <a href="#download" className="lp-pill lp-pill-dark lp-pill-lg">
                  Get the app <ArrowRight size={18} aria-hidden="true" />
                </a>
                <Link to="/register" className="lp-pill lp-pill-glass lp-pill-lg">Sell on AgriFair</Link>
              </div>
            </div>

            <div className="lp-hero-visual lp-enter" style={{ '--d': 2 }}>
              <img
                src={riceStalk}
                alt="A bundle of golden rice stalks"
                width="900"
                height="900"
                fetchPriority="high"
              />
            </div>
          </div>

          <ul className="lp-facts lp-wrap lp-enter" style={{ '--d': 4 }}>
            {FACTS.map((f) => (
              <li key={f.title}>
                <span className="lp-facts-icon"><f.icon size={20} aria-hidden="true" /></span>
                <span>
                  <strong>{f.title}</strong>
                  <small>{f.text}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Features ── */}
        <section className="lp-section" id="features" aria-labelledby="features-title">
          <div className="lp-wrap">
            <header className="lp-section-head reveal">
              <span className="lp-section-badge">Why AgriFair</span>
              <h2 id="features-title" className="lp-section-title">Fair for the farmer, clear for the buyer</h2>
              <p className="lp-section-sub">
                Everything a rice sale needs, from the price on the sack to the photo at your door.
              </p>
            </header>
            <ul className="lp-features">
              {FEATURES.map((f, i) => (
                <li key={f.title} className="lp-feature reveal" style={{ '--i': i % 3 }}>
                  <span className="lp-feature-icon"><f.icon size={24} strokeWidth={1.9} aria-hidden="true" /></span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── For sellers ── */}
        <section className="lp-section lp-about" id="sellers" aria-labelledby="sellers-title">
          <div className="lp-wrap lp-about-grid">
            <div className="lp-about-text reveal">
              <span className="lp-section-badge">For sellers</span>
              <h2 id="sellers-title" className="lp-section-title">Built for the people who grow it</h2>
              <p>
                List your rice, set your own price, and sell to buyers directly. Orders,
                payments, stock and deliveries live in one seller portal on the web.
              </p>
              <p>
                Every seller is reviewed by the AgriFair team before their shop opens, so buyers
                know who they are buying from.
              </p>
              <div className="lp-about-actions">
                <Link to="/register" className="lp-pill lp-pill-dark lp-pill-lg">
                  Register as a seller <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <Link to="/login" className="lp-pill lp-pill-outline lp-pill-lg">Seller sign in</Link>
              </div>
            </div>

            <div className="lp-about-cards">
              <article className="lp-about-card reveal" style={{ '--i': 1 }}>
                <span className="lp-about-glow" aria-hidden="true" />
                <span className="lp-about-icon"><Store size={22} aria-hidden="true" /></span>
                <h3>Seller portal</h3>
                <p>Listings, orders, stock and sales reports, with GCash payments you confirm yourself.</p>
              </article>
              <article className="lp-about-card lp-about-card-offset reveal" style={{ '--i': 2 }}>
                <span className="lp-about-glow lp-about-glow-gold" aria-hidden="true" />
                <span className="lp-about-icon"><Bike size={22} aria-hidden="true" /></span>
                <h3>Your own riders</h3>
                <p>Add the people who deliver for you, assign orders, and keep a photo from every door.</p>
              </article>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="lp-howto" id="how-to-use" aria-labelledby="howto-title">
          <div className="lp-howto-shell reveal">
            <div className="lp-howto-intro">
              <span className="lp-howto-badge">Getting started</span>
              <h2 id="howto-title">
                How to use
                <em>the AgriFair app</em>
              </h2>
              <p>One path from install to delivery. Follow the four steps, then get the app below.</p>
              <a href="#download" className="lp-pill lp-pill-white">
                Get the app <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
            <ol className="lp-rail">
              {STEPS.map((step, i) => (
                <li key={step.title} className="lp-rail-item reveal" style={{ '--i': i + 1 }}>
                  <span className="lp-rail-marker" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Download ── */}
        <section className="lp-download" id="download" aria-labelledby="download-title">
          <div className="lp-wrap lp-download-grid">
            <div className="lp-download-visual reveal">
              <img
                src="/app-preview/mobile-showcase.webp"
                alt="AgriFair app screens: welcome, onboarding and splash"
                width="1052"
                height="922"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="lp-download-copy reveal" style={{ '--i': 1 }}>
              <p className="lp-download-kicker">For buyers and delivery riders</p>
              <h2 id="download-title" className="lp-download-title">
                Get the app.
                <span>Shop rice on the go.</span>
              </h2>
              <p className="lp-download-sub">
                Scan the code with your phone’s camera, or download it here. Android only for now.
                Sellers and the AgriFair team use this website.
              </p>
              <div className="lp-download-row">
                <div className="lp-qr">
                  {qrSrc
                    ? <img src={qrSrc} alt="QR code that downloads the AgriFair app" width="120" height="120" />
                    : <span className="skeleton" aria-hidden="true" />}
                </div>
                <div className="lp-download-actions">
                  <a href={APP_DOWNLOAD_URL} className="lp-pill lp-pill-dark lp-pill-lg">
                    <Download size={18} aria-hidden="true" /> Download for Android
                  </a>
                  <button type="button" className="lp-copy" onClick={copyLink}>
                    {copied
                      ? <><Check size={16} aria-hidden="true" /> Link copied</>
                      : <><Copy size={16} aria-hidden="true" /> Copy download link</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <HighlightsSection />

        {/* ── Closing call ── */}
        <section className="lp-cta" aria-labelledby="cta-title">
          <div className="lp-cta-bg" aria-hidden="true">
            <span className="lp-glow lp-glow-gold" />
          </div>
          <div className="lp-cta-inner reveal">
            <h2 id="cta-title">Your rice. Your price.</h2>
            <p>
              Sellers and the AgriFair team sign in here. Buyers and delivery riders use the app.
            </p>
            <div className="lp-cta-actions">
              <Link to="/login" className="lp-pill lp-pill-white lp-pill-lg">
                Sign in to the portal <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a href="#download" className="lp-pill lp-pill-ghost lp-pill-lg">Download the app</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-top">
            <Link to="/" className="lp-logo" aria-label="AgriFair home">
              <img src={logoImg} alt="" width="34" height="34" loading="lazy" />
              <span translate="no">AgriFair</span>
            </Link>
            <p>Connecting rice farmers and buyers, without the middleman.</p>
          </div>
          <div className="lp-footer-bottom">
            <p>© 2026 AgriFair. A capstone project.</p>
            <nav aria-label="Footer">
              <a href="#features">Features</a>
              <a href="#sellers">For sellers</a>
              <a href="#how-to-use">How it works</a>
              <Link to="/login">Sign in</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
