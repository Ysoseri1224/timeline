import { useEffect, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import 'glightbox/dist/css/glightbox.css';
import gsap from 'gsap';
import type { PositionedEvent, TimelineAxis } from './types';

interface NodeDetailProps {
  event: PositionedEvent;
  axes: TimelineAxis[];
  origin: DOMRect;
  onClose: () => void;
}

export default function NodeDetail({ event, axes, origin, onClose }: NodeDetailProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const eventAxes = axes.filter((axis) => event.axis_ids.includes(axis.id));
  const images = event.media.filter((media) => media.type === 'image');
  const videos = event.media.filter((media) => media.type === 'video');

  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const panelWidth = Math.min(480, viewportWidth - 40);
  const preferredLeft = origin.left > viewportWidth / 2 ? origin.left - panelWidth - 24 : origin.right + 24;
  const left = Math.max(20, Math.min(viewportWidth - panelWidth - 20, preferredLeft));
  const top = Math.max(22, Math.min(viewportHeight - Math.min(620, viewportHeight - 44), origin.top - 42));

  useGSAP(
    () => {
      const overlay = overlayRef.current;
      const panel = panelRef.current;
      if (!overlay || !panel) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.style.willChange = reduced ? 'opacity' : 'transform, opacity, filter';

      const timeline = gsap.timeline({
        defaults: { ease: 'power2.out' },
        onComplete: () => {
          panel.style.willChange = '';
        },
        onReverseComplete: onClose,
      });
      timeline
        .fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: reduced ? 0.12 : 0.32 }, 0)
        .fromTo(
          panel,
          reduced
            ? { autoAlpha: 0 }
            : { autoAlpha: 0, z: -20, scale: 0.97, y: 12, filter: 'blur(1px)' },
          reduced
            ? { autoAlpha: 1, duration: 0.16 }
            : { autoAlpha: 1, z: 0, scale: 1, y: 0, filter: 'blur(0px)', duration: 0.48 },
          0.04,
        )
        .fromTo(
          panel.querySelectorAll('[data-detail-part]'),
          { autoAlpha: 0, y: reduced ? 0 : 8 },
          { autoAlpha: 1, y: 0, duration: reduced ? 0.12 : 0.36, stagger: 0.045 },
          0.18,
        );
      closeTimelineRef.current = timeline;
    },
    { scope: overlayRef },
  );

  useEffect(() => {
    if (images.length === 0) return;
    let destroyed = false;
    let lightbox: { destroy: () => void } | null = null;
    void import('glightbox').then(({ default: GLightbox }) => {
      if (destroyed) return;
      lightbox = GLightbox({
        selector: '.timeline-detail-lightbox',
        touchNavigation: true,
        loop: images.length > 1,
        closeOnOutsideClick: true,
      });
    });
    return () => {
      destroyed = true;
      lightbox?.destroy();
    };
  }, [images]);

  useEffect(() => {
    const handleKey = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') closeTimelineRef.current?.reverse();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const close = () => {
    const panel = panelRef.current;
    if (panel) panel.style.willChange = 'transform, opacity, filter';
    closeTimelineRef.current?.reverse();
  };

  return (
    <div
      ref={overlayRef}
      className="detail-overlay"
      role="presentation"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) close();
      }}
    >
      <article
        ref={panelRef}
        className="node-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        style={{ left, top, width: panelWidth, transformOrigin: origin.left > viewportWidth / 2 ? 'right top' : 'left top' }}
      >
        <button className="detail-close" type="button" onClick={close} aria-label="关闭详情">×</button>
        <time data-detail-part>{event.event_date.replaceAll('-', ' · ')}</time>
        <h2 id="detail-title" data-detail-part>{event.title}</h2>
        {event.subtitle && <p className="detail-subtitle" data-detail-part>{event.subtitle}</p>}
        {images.length > 0 && (
          <div className={`detail-gallery${images.length === 1 ? ' detail-gallery--single' : ''}`} data-detail-part>
            {images.map((media) => (
              <a
                key={media.key}
                className="timeline-detail-lightbox"
                href={media.url}
                data-gallery="timeline-event-media"
                data-title={media.caption}
              >
                <img src={media.url} alt={media.caption || event.title} />
                {media.caption && <span>{media.caption}</span>}
              </a>
            ))}
          </div>
        )}
        {videos.map((media) => (
          <figure className="detail-video" key={media.key} data-detail-part>
            <video src={media.url} controls preload="metadata" playsInline />
            {media.caption && <figcaption>{media.caption}</figcaption>}
          </figure>
        ))}
        {event.description && <p className="detail-body" data-detail-part>{event.description}</p>}
        <div className="detail-tags" data-detail-part>
          {eventAxes.map((axis) => (
            <span key={axis.id} style={{ '--chip-color': axis.color } as React.CSSProperties}>{axis.name}</span>
          ))}
        </div>
      </article>
    </div>
  );
}
