import React from 'react';
import useInView from './useInView';

/**
 * Text that comes into focus word by word as it scrolls into view.
 *
 * Screen readers get the sentence whole from a visually hidden copy; the
 * animated words are hidden from them, so nothing is read twice or in pieces.
 */
export default function BlurText({
  text, delay = 0, step = 70, className, as: Tag = 'span', style, ...rest
}) {
  const [ref, inView] = useInView();
  const words = text.split(' ');

  return (
    <Tag
      ref={ref}
      className={className ? `af-blur ${className}` : 'af-blur'}
      data-inview={inView}
      style={{ ...style, '--af-delay': `${delay}ms`, '--af-step': `${step}ms` }}
      {...rest}
    >
      <span className="sr-only">{text}</span>
      {words.map((word, i) => (
        <React.Fragment key={i}>
          {i > 0 && ' '}
          <span className="af-word" aria-hidden="true" style={{ '--i': i }}>{word}</span>
        </React.Fragment>
      ))}
    </Tag>
  );
}
