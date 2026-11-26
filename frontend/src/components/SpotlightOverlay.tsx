import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface SpotlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 424;
const DEFAULT_CARD_HEIGHT = 400;
const PAD = 8;

function visibleTargetRect(el: HTMLElement, vw: number, vh: number): SpotlightRect | null {
  let box = el.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  let left = box.left;
  let top = box.top;
  let right = box.right;
  let bottom = box.bottom;

  // Clip against any scrollable/overflowing ancestors (like .sidebar-body above .sidebar-footer)
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowY}${style.overflowX}`)) {
      const pBox = parent.getBoundingClientRect();
      left = Math.max(left, pBox.left);
      top = Math.max(top, pBox.top);
      right = Math.min(right, pBox.right);
      bottom = Math.min(bottom, pBox.bottom);
    }
    parent = parent.parentElement;
  }

  if (right <= left || bottom <= top) return null;
  const paddedLeft = Math.max(4, Math.round(left - PAD));
  const paddedTop = Math.max(4, Math.round(top - PAD));
  const paddedRight = Math.min(vw - 4, Math.round(right + PAD));
  const paddedBottom = Math.min(vh - 4, Math.round(bottom + PAD));
  return {
    left: paddedLeft,
    top: paddedTop,
    width: Math.max(24, paddedRight - paddedLeft),
    height: Math.max(24, paddedBottom - paddedTop),
  };
}

function computePlacement(
  rect: SpotlightRect | null,
  preferredSide: 'left' | 'right' | 'top' | 'bottom' | 'center' = 'left',
  vw: number,
  vh: number,
  cardH: number,
): { left: number; top: number; arrowSide: 'left' | 'right' | 'top' | 'bottom' | 'none' } {
  const cardW = Math.min(CARD_WIDTH, vw - 32);
  const measuredH = Math.min(cardH, vh - 32);
  if (!rect || preferredSide === 'center') {
    return {
      left: Math.max(16, Math.round((vw - cardW) / 2)),
      top: Math.max(16, Math.round((vh - measuredH) / 2)),
      arrowSide: 'none',
    };
  }

  const gap = 14;
  const clampX = (x: number) => Math.max(16, Math.min(vw - cardW - 16, Math.round(x)));
  const clampY = (y: number) => Math.max(16, Math.min(vh - measuredH - 16, Math.round(y)));

  const spaceLeft = rect.left;
  const spaceRight = vw - (rect.left + rect.width);
  const spaceBottom = vh - (rect.top + rect.height);
  const spaceTop = rect.top;

  let side = preferredSide;
  if (side === 'left' && spaceLeft < cardW + gap + 16) side = spaceRight >= cardW + gap + 16 ? 'right' : spaceBottom >= measuredH + gap + 16 ? 'bottom' : 'top';
  if (side === 'right' && spaceRight < cardW + gap + 16) side = spaceLeft >= cardW + gap + 16 ? 'left' : spaceBottom >= measuredH + gap + 16 ? 'bottom' : 'top';
  if (side === 'bottom' && spaceBottom < measuredH + gap + 16) side = spaceTop >= measuredH + gap + 16 ? 'top' : spaceLeft >= cardW + gap + 16 ? 'left' : 'right';
  if (side === 'top' && spaceTop < measuredH + gap + 16) side = spaceBottom >= measuredH + gap + 16 ? 'bottom' : spaceLeft >= cardW + gap + 16 ? 'left' : 'right';

  if (side === 'left') {
    return {
      left: clampX(rect.left - cardW - gap),
      top: clampY(rect.top),
      arrowSide: 'right',
    };
  }
  if (side === 'right') {
    return {
      left: clampX(rect.left + rect.width + gap),
      top: clampY(rect.top),
      arrowSide: 'left',
    };
  }
  if (side === 'bottom') {
    return {
      left: clampX(rect.left + rect.width / 2 - cardW / 2),
      top: clampY(rect.top + rect.height + gap),
      arrowSide: 'top',
    };
  }
  return {
    left: clampX(rect.left + rect.width / 2 - cardW / 2),
    top: clampY(rect.top - measuredH - gap),
    arrowSide: 'bottom',
  };
}

export function SpotlightOverlay({
  targetSelector,
  preferredSide = 'left',
  zIndex = 40,
  ariaLabel,
  onBackdropClick,
  children,
}: {
  targetSelector?: string;
  preferredSide?: 'left' | 'right' | 'top' | 'bottom' | 'center';
  zIndex?: number;
  ariaLabel: string;
  onBackdropClick?: () => void;
  children: ReactNode;
}) {
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [cardH, setCardH] = useState(DEFAULT_CARD_HEIGHT);
  const cardRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(() =>
    typeof window !== 'undefined'
      ? { vw: window.innerWidth, vh: window.innerHeight }
      : { vw: 1280, vh: 800 },
  );

  const measure = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setViewport((prev) => (prev.vw === vw && prev.vh === vh ? prev : { vw, vh }));
    if (cardRef.current) {
      const h = Math.round(cardRef.current.getBoundingClientRect().height);
      if (h > 0) setCardH((prev) => (prev === h ? prev : h));
    }
    if (!targetSelector) {
      setRect((prev) => (prev === null ? prev : null));
      return;
    }
    const el = document.querySelector(targetSelector) as HTMLElement | null;
    if (!el) {
      setRect((prev) => (prev === null ? prev : null));
      return;
    }
    const next = visibleTargetRect(el, vw, vh);
    setRect((prev) => {
      if (prev === null && next === null) return prev;
      if (prev && next && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height) {
        return prev;
      }
      return next;
    });
  };

  useLayoutEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const el = targetSelector ? (document.querySelector(targetSelector) as HTMLElement | null) : null;
    el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    measure();
    const raf1 = window.requestAnimationFrame(() => {
      const target = targetSelector ? (document.querySelector(targetSelector) as HTMLElement | null) : null;
      target?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      measure();
    });
    const t1 = window.setTimeout(measure, 120);
    const t2 = window.setTimeout(measure, 280);
    return () => {
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [targetSelector]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const onUpdate = () => measure();
    window.addEventListener('resize', onUpdate);
    window.addEventListener('scroll', onUpdate, true);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onUpdate);
      if (cardRef.current) ro.observe(cardRef.current);
      const target = targetSelector ? (document.querySelector(targetSelector) as HTMLElement | null) : null;
      if (target) ro.observe(target);
    }
    return () => {
      window.removeEventListener('resize', onUpdate);
      window.removeEventListener('scroll', onUpdate, true);
      ro?.disconnect();
    };
  }, [targetSelector]);

  const pos = computePlacement(rect, preferredSide, viewport.vw, viewport.vh, cardH);

  const clipPath = rect
    ? `polygon(evenodd, 0px 0px, 100% 0px, 100% 100%, 0px 100%, 0px 0px, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top}px, ${rect.left}px ${rect.top}px)`
    : undefined;

  return (
    <div className="spotlight-root" style={{ zIndex }} role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <div
        className="spotlight-dim spotlight-dim-full"
        style={clipPath ? { clipPath, WebkitClipPath: clipPath } : undefined}
        onClick={onBackdropClick}
      />
      {rect && (
        <div
          className="spotlight-ring"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          aria-hidden="true"
        />
      )}

      <div
        ref={cardRef}
        className={`spotlight-card arrow-${pos.arrowSide}`}
        style={{ left: pos.left, top: pos.top }}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
