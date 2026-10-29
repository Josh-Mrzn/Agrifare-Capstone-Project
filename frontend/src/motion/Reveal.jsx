import React, { useEffect, useState } from 'react';
import useInView from './useInView';

const DURATION = 900;

/** Where each variant starts from: a transform and a blur. */
const VARIANTS = {
  up: ['translate3d(0, 24px, 0)', 'var(--af-blur)'],
  down: ['translate3d(0, -12px, 0)', '6px'],
  scale: ['scale(0.96)', '4px'],
  fade: ['none', 'var(--af-blur)'],
};

const join = (...names) => names.filter(Boolean).join(' ');

/**
 * Fades, unblurs and settles an element as it scrolls into view.
 *
 * With `stagger`, the direct children animate one after another instead of
 * the element itself; each child must accept className and style.
 *
 * Once the entrance is over the element is marked done, and the reveal's
 * transition stops applying, so its own hover transitions answer at once
 * instead of waiting out the stagger delay.
 */
export default function Reveal({
  variant = 'up', delay = 0, stagger = 0, as = 'div', className, style, children, ...rest
}) {
  const Tag = as;
  const [ref, inView] = useInView();
  const [done, setDone] = useState(false);
  const [from, blur] = VARIANTS[variant] || VARIANTS.up;

  const items = stagger ? React.Children.toArray(children).filter(React.isValidElement) : null;
  const last = items ? items.length - 1 : 0;

  useEffect(() => {
    if (!inView || done) return undefined;
    const id = window.setTimeout(() => setDone(true), delay + last * stagger + DURATION + 100);
    return () => window.clearTimeout(id);
  }, [inView, done, delay, last, stagger]);

  return (
    <Tag
      ref={ref}
      className={join('af-reveal', stagger && 'af-stagger', className)}
      data-inview={inView}
      data-af-done={done ? '' : undefined}
      style={{
        ...style,
        '--af-t': from,
        '--af-b': blur,
        '--af-delay': `${delay}ms`,
        '--af-stagger': `${stagger}ms`,
      }}
      {...rest}
    >
      {items
        ? items.map((child, i) => React.cloneElement(child, {
          className: join(child.props.className, 'af-item'),
          style: { ...child.props.style, '--i': i },
        }))
        : children}
    </Tag>
  );
}
