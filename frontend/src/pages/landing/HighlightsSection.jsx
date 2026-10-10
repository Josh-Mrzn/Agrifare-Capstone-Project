import React, { useEffect, useRef, useState } from 'react';

/**
 * The one-minute AgriFair short, laid out like the storyboard it was drawn
 * from: the film on top, its four scenes underneath.
 *
 * Nothing plays by itself. The film waits behind its poster with one clear
 * play button, and each scene card jumps straight to that moment - someone who
 * only wants to see the app can skip the setup. While it plays, the card for
 * the current scene lights up and fills, so the strip doubles as a timeline.
 */

const VIDEO_SRC = '/media/agrifair-highlights.mp4';
const POSTER = '/media/agrifair-highlights-poster.jpg';

const CHAPTERS = [
  {
    start: 0,
    title: 'A good harvest',
    text: 'The sacks are ready. Who will pay a fair price for them?',
    image: '/media/chapters/chapter-1.jpg',
  },
  {
    start: 12,
    title: "The middleman's price",
    text: 'The truck arrives, and the price is decided for them.',
    image: '/media/chapters/chapter-2.jpg',
  },
  {
    start: 32,
    title: "A neighbor's tip",
    text: 'A friend shows them AgriFair on his phone.',
    image: '/media/chapters/chapter-3.jpg',
  },
  {
    start: 52,
    title: 'Their rice, their price',
    text: 'Selling straight to buyers, on their own terms.',
    image: '/media/chapters/chapter-4.jpg',
  },
];

const FALLBACK_DURATION = 62;

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function HighlightsSection() {
  const videoRef = useRef(null);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(FALLBACK_DURATION);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const onTime = () => setTime(video.currentTime);
    const onMeta = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    };
    const onPlay = () => {
      setStarted(true);
      setEnded(false);
    };
    const onEnded = () => setEnded(true);

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('play', onPlay);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('ended', onEnded);
    };
  }, []);

  const playFrom = (seconds) => {
    const video = videoRef.current;
    if (!video) return;
    if (typeof seconds === 'number') video.currentTime = seconds;
    setStarted(true);
    setEnded(false);
    video.play().catch(() => {});
  };

  const activeIndex = started
    ? CHAPTERS.reduce((found, chapter, i) => (time >= chapter.start ? i : found), 0)
    : -1;

  const chapterEnd = (i) => (i + 1 < CHAPTERS.length ? CHAPTERS[i + 1].start : duration);

  const progressFor = (i) => {
    if (!started) return 0;
    const { start } = CHAPTERS[i];
    const end = chapterEnd(i);
    if (time >= end) return 1;
    if (time <= start) return 0;
    return (time - start) / (end - start);
  };

  const showOverlay = !started || ended;

  return (
    <section className="lp-section lp-hl" id="story" aria-labelledby="lp-hl-title">
      <div className="lp-wrap">
        <header className="lp-hl-head reveal">
          <span className="lp-section-badge">Our story</span>
          <h2 id="lp-hl-title" className="lp-section-title">
            A <em>fairer</em> way to sell the harvest
          </h2>
          <p className="lp-section-sub">
            Two rice farmers, a middleman&rsquo;s truck, and the app that let them sell on their
            own terms. The idea behind AgriFair, in a {formatTime(duration)} animated short.
          </p>
        </header>

        <div className={`lp-hl-stage reveal${started && !ended ? ' is-playing' : ''}`}>
          <video
            ref={videoRef}
            className="lp-hl-video"
            poster={POSTER}
            preload="metadata"
            playsInline
            controls={started && !ended}
          >
            <source src={VIDEO_SRC} type="video/mp4" />
            Your browser does not support the video tag.
          </video>

          {showOverlay && (
            <button
              type="button"
              className="lp-hl-overlay"
              onClick={() => playFrom(ended ? 0 : undefined)}
              aria-label={ended ? 'Watch the AgriFair story again' : 'Play the AgriFair story'}
            >
              <span className="lp-hl-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="30" height="30">
                  {ended ? (
                    <path
                      fill="currentColor"
                      d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"
                    />
                  ) : (
                    <path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
                  )}
                </svg>
              </span>
              <span className="lp-hl-overlay-text">
                <strong>{ended ? 'Watch again' : 'Watch the story'}</strong>
                <span>{formatTime(duration)}, with sound</span>
              </span>
            </button>
          )}
        </div>

        <ol className="lp-hl-chapters reveal" aria-label="Scenes" style={{ '--i': 1 }}>
          {CHAPTERS.map((chapter, i) => {
            const active = i === activeIndex && !ended;
            return (
              <li key={chapter.start}>
                <button
                  type="button"
                  className={`lp-hl-chapter${active ? ' is-active' : ''}`}
                  onClick={() => playFrom(chapter.start)}
                  aria-current={active ? 'step' : undefined}
                >
                  <span className="lp-hl-thumb">
                    <img src={chapter.image} alt="" width="320" height="180" loading="lazy" decoding="async" />
                  </span>
                  <span className="lp-hl-chapter-copy">
                    <span className="lp-hl-time">{formatTime(chapter.start)}</span>
                    <strong>{chapter.title}</strong>
                    <span>{chapter.text}</span>
                  </span>
                  <span className="lp-hl-progress" aria-hidden="true">
                    <span style={{ transform: `scaleX(${progressFor(i)})` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
