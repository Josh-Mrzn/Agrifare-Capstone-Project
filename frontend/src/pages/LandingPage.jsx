import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Menu, X, Download, Copy, Check, ArrowRight, BadgeCheck, Scale, Wallet, Truck,
  Sprout, MapPin, Camera, MessageCircle, Store, Bike,
} from 'lucide-react';
import QRCode from 'qrcode';
import logoImg from '../assets/logo.png';
import riceStalk from '../assets/rice-stalk.webp';
import { APP_DOWNLOAD_URL } from '../utils/appLinks';
import BlurText from '../motion/BlurText';
import Reveal from '../motion/Reveal';
import useScrolled from '../motion/useScrolled';
import HighlightsSection from './landing/HighlightsSection';
import RiceVarieties from '../components/rice-varieties/RiceVarieties';
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

/** The → on a button, nudged forward on hover. */
const Arrow = ({ size }) => (
  <span className="af-arrow"><ArrowRight size={size} aria-hidden="true" /></span>
);

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolled = useScrolled(8);
  const [qrSrc, setQrSrc] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = 'AgriFair: rice straight from the farm';
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

      <header
        className={`lp-nav af-nav af-nav-enter${scrolled ? ' is-scrolled' : ''}${menuOpen ? ' is-open' : ''}`}
        data-scrolled={scrolled}
      >
        <div className="lp-nav-inner">
          <Link to="/" className="lp-logo" aria-label="AgriFair home">
            <img src={logoImg} alt="" width="38" height="38" />
            <span translate="no">AgriFair</span>
          </Link>

          <nav className="lp-nav-links" aria-label="Main">
            {NAV.map((item) => <a key={item.id} href={`#${item.id}`}>{item.label}</a>)}
          </nav>

          <Link to="/login" className="lp-pill lp-pill-dark lp-nav-cta af-press">Sign in</Link>

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
              <Link to="/login" className="lp-pill lp-pill-dark af-press">Sign in</Link>
              <Link to="/register" className="lp-pill lp-pill-light af-press">Register as a seller</Link>
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
              <Reveal as="p" variant="fade" delay={100} className="lp-badge">
                <span className="lp-badge-dot" aria-hidden="true" />
                Direct from Filipino rice farms
              </Reveal>
              <h1 className="lp-hero-title">
                <BlurText text="Rice from the farm," delay={200} />
                <br />
                <BlurText text="at the farmer’s price." delay={480} className="lp-hero-accent" />
              </h1>
              <Reveal as="p" delay={850} className="lp-hero-sub">
                AgriFair connects rice farmers and traders straight to buyers, with clear prices
                per sack and delivery you can follow.
              </Reveal>
              <Reveal stagger={90} delay={1000} className="lp-hero-actions">
                <a href="#download" className="lp-pill lp-pill-dark lp-pill-lg af-press">
                  Get the app <Arrow size={18} />
                </a>
                <Link to="/register" className="lp-pill lp-pill-glass lp-pill-lg af-press">Sell on AgriFair</Link>
              </Reveal>
            </div>

            <Reveal variant="scale" delay={300} className="lp-hero-visual">
              <div className="lp-hero-stalk">
                <span className="lp-hero-shadow af-float-shadow" aria-hidden="true" />
                <img
                  className="af-float"
                  src={riceStalk}
                  alt="A bundle of golden rice stalks"
                  width="900"
                  height="900"
                  fetchPriority="high"
                />
              </div>
            </Reveal>
          </div>

          <Reveal as="ul" delay={1150} className="lp-facts lp-wrap">
            {FACTS.map((f) => (
              <li key={f.title}>
                <span className="lp-facts-icon"><f.icon size={20} aria-hidden="true" /></span>
                <span>
                  <strong>{f.title}</strong>
                  <small>{f.text}</small>
                </span>
              </li>
            ))}
          </Reveal>
        </section>

        {/* ── Features ── */}
        <section className="lp-section" id="features" aria-labelledby="features-title">
          <div className="lp-wrap">
            <header className="lp-section-head">
              <Reveal as="span" variant="fade" className="lp-section-badge">Why AgriFair</Reveal>
              <BlurText
                as="h2"
                id="features-title"
                className="lp-section-title"
                text="Fair for the farmer, clear for the buyer"
              />
              <Reveal as="p" delay={450} className="lp-section-sub">
                Everything a rice sale needs, from the price on the sack to the photo at your door.
              </Reveal>
            </header>
            <Reveal as="ul" stagger={80} delay={250} className="lp-features">
              {FEATURES.map((f) => (
                <li key={f.title} className="lp-feature">
                  <span className="lp-feature-icon"><f.icon size={24} strokeWidth={1.9} aria-hidden="true" /></span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </li>
              ))}
            </Reveal>
          </div>
        </section>

        {/* ── For sellers ── */}
        <section className="lp-section lp-about" id="sellers" aria-labelledby="sellers-title">
          <div className="lp-wrap lp-about-grid">
            <div className="lp-about-text">
              <Reveal as="span" variant="fade" className="lp-section-badge">For sellers</Reveal>
              <BlurText
                as="h2"
                id="sellers-title"
                className="lp-section-title"
                text="Built for the people who grow it"
              />
              <Reveal stagger={100} delay={450}>
                <p>
                  List your rice, set your own price, and sell to buyers directly. Orders,
                  payments, stock and deliveries live in one seller portal on the web.
                </p>
                <p>
                  Every seller is reviewed by the AgriFair team before their shop opens, so buyers
                  know who they are buying from.
                </p>
              </Reveal>
              <Reveal stagger={90} delay={650} className="lp-about-actions">
                <Link to="/register" className="lp-pill lp-pill-dark lp-pill-lg af-press">
                  Register as a seller <Arrow size={18} />
                </Link>
                <Link to="/login" className="lp-pill lp-pill-outline lp-pill-lg af-press">Seller sign in</Link>
              </Reveal>
            </div>

            <Reveal stagger={160} delay={300} className="lp-about-cards">
              <article className="lp-about-card">
                <span className="lp-about-glow" aria-hidden="true" />
                <span className="lp-about-icon"><Store size={22} aria-hidden="true" /></span>
                <h3>Seller portal</h3>
                <p>Listings, orders, stock and sales reports, with GCash payments you confirm yourself.</p>
              </article>
              <article className="lp-about-card lp-about-card-offset">
                <span className="lp-about-glow lp-about-glow-gold" aria-hidden="true" />
                <span className="lp-about-icon"><Bike size={22} aria-hidden="true" /></span>
                <h3>Your own riders</h3>
                <p>Add the people who deliver for you, assign orders, and keep a photo from every door.</p>
              </article>
            </Reveal>
          </div>
        </section>

        <RiceVarieties />

        {/* ── How it works ── */}
        <section className="lp-howto" id="how-to-use" aria-labelledby="howto-title">
          <Reveal variant="scale" className="lp-howto-shell">
            <div className="lp-howto-intro">
              <Reveal as="span" variant="fade" className="lp-howto-badge">Getting started</Reveal>
              <h2 id="howto-title">
                <BlurText text="How to use" />
                <BlurText as="em" text="the AgriFair app" delay={220} />
              </h2>
              <Reveal as="p" delay={450}>
                One path from install to delivery. Follow the four steps, then get the app below.
              </Reveal>
              <a href="#download" className="lp-pill lp-pill-white af-press">
                Get the app <Arrow size={17} />
              </a>
            </div>
            <Reveal as="ol" stagger={170} delay={350} className="lp-rail">
              {STEPS.map((step, i) => (
                <li key={step.title} className="lp-rail-item">
                  <span className="lp-rail-marker" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                  {i < STEPS.length - 1 && <span className="lp-rail-line af-line" aria-hidden="true" />}
                </li>
              ))}
            </Reveal>
          </Reveal>
        </section>

        {/* ── Download ── */}
        <section className="lp-download" id="download" aria-labelledby="download-title">
          <div className="lp-wrap lp-download-grid">
            <Reveal variant="scale" delay={100} className="lp-download-visual">
              <img
                src="/app-preview/mobile-showcase.webp"
                alt="AgriFair app screens: welcome, onboarding and splash"
                width="1052"
                height="922"
                loading="lazy"
                decoding="async"
              />
            </Reveal>
            <div className="lp-download-copy">
              <Reveal as="p" variant="fade" className="lp-download-kicker">For buyers and delivery riders</Reveal>
              <h2 id="download-title" className="lp-download-title">
                <BlurText text="Get the app." />
                <BlurText text="Shop rice on the go." delay={220} className="lp-download-accent" />
              </h2>
              <Reveal as="p" delay={450} className="lp-download-sub">
                Scan the code with your phone’s camera, or download it here. Android only for now.
                Sellers and the AgriFair team use this website.
              </Reveal>
              <Reveal stagger={120} delay={650} className="lp-download-row">
                <div className="lp-qr">
                  {qrSrc
                    ? <img src={qrSrc} alt="QR code that downloads the AgriFair app" width="120" height="120" />
                    : <span className="skeleton" aria-hidden="true" />}
                </div>
                <div className="lp-download-actions">
                  <a href={APP_DOWNLOAD_URL} className="lp-pill lp-pill-dark lp-pill-lg af-press">
                    <Download size={18} aria-hidden="true" /> Download for Android
                  </a>
                  <button type="button" className="lp-copy af-press" onClick={copyLink}>
                    {copied
                      ? <><Check size={16} aria-hidden="true" /> Link copied</>
                      : <><Copy size={16} aria-hidden="true" /> Copy download link</>}
                  </button>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <HighlightsSection />

        {/* ── Closing call ── */}
        <section className="lp-cta" aria-labelledby="cta-title">
          <div className="lp-cta-bg" aria-hidden="true">
            <span className="lp-glow lp-glow-gold" />
          </div>
          <Reveal variant="scale" className="lp-cta-inner">
            <BlurText as="h2" id="cta-title" text="Your rice. Your price." delay={200} />
            <Reveal as="p" delay={500}>
              Sellers and the AgriFair team sign in here. Buyers and delivery riders use the app.
            </Reveal>
            <Reveal stagger={90} delay={650} className="lp-cta-actions">
              <Link to="/login" className="lp-pill lp-pill-white lp-pill-lg af-press">
                Sign in to the portal <Arrow size={18} />
              </Link>
              <a href="#download" className="lp-pill lp-pill-ghost lp-pill-lg af-press">Download the app</a>
            </Reveal>
          </Reveal>
        </section>
      </main>

      <footer className="lp-footer">
        <Reveal stagger={120} className="lp-wrap">
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
        </Reveal>
      </footer>
    </div>
  );
}
