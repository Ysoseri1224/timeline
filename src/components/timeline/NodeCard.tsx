import type { MouseEvent, RefObject } from 'react';
import type { PositionedEvent, TimelineAxis } from './types';

interface NodeCardProps {
  event: PositionedEvent;
  axes: TimelineAxis[];
  selected: boolean;
  dimmed: boolean;
  editor: boolean;
  nodeRef: RefObject<HTMLDivElement | null>;
  onOpen: (event: PositionedEvent, rect: DOMRect) => void;
  onEdit: (event: PositionedEvent) => void;
  onDelete: (event: PositionedEvent) => void;
}

const formatDate = (value: string): string => {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
};

export default function NodeCard({
  event,
  axes,
  selected,
  dimmed,
  editor,
  nodeRef,
  onOpen,
  onEdit,
  onDelete,
}: NodeCardProps) {
  const eventAxes = axes.filter((axis) => event.axis_ids.includes(axis.id));
  const axisColor = event.color || eventAxes[0]?.color || '#8d6d63';
  const preview = event.description?.trim() || event.subtitle?.trim() || '';
  const thumbnail = event.media[0];

  const handleOpen = () => {
    const rect = nodeRef.current?.getBoundingClientRect();
    if (rect) onOpen(event, rect);
  };

  const handleEditorAction = (action: () => void) => (clickEvent: MouseEvent) => {
    clickEvent.stopPropagation();
    action();
  };

  return (
    <div
      ref={nodeRef}
      className={`timeline-event timeline-event--${event.side}${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`}
      data-event-id={event.id}
      data-y={event.y}
      style={
        {
          left: `${(event.x / 1200) * 100}%`,
          transform: `translate3d(-50%, ${event.y}px, 0)`,
          '--axis-color': axisColor,
        } as React.CSSProperties
      }
    >
      <button className="node-hit" type="button" onClick={handleOpen} aria-label={`打开：${event.title}`}>
        <span className="node-dot" />
        <span className="node-stem" />
        <span className="node-paper">
          <span className="node-date">{formatDate(event.event_date)}</span>
          <span className="node-main">
            {thumbnail && (
              <span
                className={`node-thumbnail node-thumbnail--${thumbnail.type}`}
                style={{ transform: `rotate(${event.id % 2 === 0 ? -1.4 : 1.2}deg)` }}
              >
                {thumbnail.type === 'image' ? (
                  <img src={thumbnail.url} alt={thumbnail.caption || event.title} loading="lazy" />
                ) : (
                  <>
                    <video src={`${thumbnail.url}#t=0.1`} preload="metadata" muted />
                    <span className="video-mark" aria-hidden="true">▶</span>
                  </>
                )}
              </span>
            )}
            <span className="node-copy">
              <strong>{event.title}</strong>
              {preview && <span>{preview.slice(0, 38)}{preview.length > 38 ? '…' : ''}</span>}
            </span>
          </span>
          <span className="node-tags">
            {eventAxes.map((axis) => (
              <span key={axis.id} style={{ '--chip-color': axis.color } as React.CSSProperties}>{axis.name}</span>
            ))}
          </span>
        </span>
      </button>
      {editor && (
        <span className="node-editor-actions">
          <button type="button" onClick={handleEditorAction(() => onEdit(event))}>改</button>
          <button type="button" onClick={handleEditorAction(() => onDelete(event))}>删</button>
        </span>
      )}
    </div>
  );
}
