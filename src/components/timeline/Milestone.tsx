import type { MouseEvent, RefObject } from 'react';
import type { PositionedEvent, TimelineAxis } from './types';

interface MilestoneProps {
  event: PositionedEvent;
  axes: TimelineAxis[];
  dimmed: boolean;
  editor: boolean;
  nodeRef: RefObject<HTMLDivElement | null>;
  onOpen: (event: PositionedEvent, rect: DOMRect) => void;
  onEdit: (event: PositionedEvent) => void;
  onDelete: (event: PositionedEvent) => void;
}

export default function Milestone({
  event,
  axes,
  dimmed,
  editor,
  nodeRef,
  onOpen,
  onEdit,
  onDelete,
}: MilestoneProps) {
  const eventAxes = axes.filter((axis) => event.axis_ids.includes(axis.id));
  const anchorAxis = axes.find((axis) => axis.id === event.primaryAxisId);
  const color = event.color || anchorAxis?.color || eventAxes[0]?.color || '#b58b58';

  const open = () => {
    const rect = nodeRef.current?.getBoundingClientRect();
    if (rect) onOpen(event, rect);
  };

  const action = (callback: () => void) => (clickEvent: MouseEvent) => {
    clickEvent.stopPropagation();
    callback();
  };

  return (
    <div
      ref={nodeRef}
      className={`timeline-event milestone${dimmed ? ' is-dimmed' : ''}`}
      data-event-id={event.id}
      data-y={event.y}
      style={
        {
          transform: `translate3d(0, ${event.y}px, 0)`,
          '--axis-color': color,
        } as React.CSSProperties
      }
    >
      <button type="button" className="milestone-paper" onClick={open}>
        <span className="milestone-kicker">chapter · {event.event_date.replaceAll('-', '.')}</span>
        <strong>{event.title}</strong>
        {event.subtitle && <span className="milestone-subtitle">{event.subtitle}</span>}
        {event.description && <span className="milestone-description">{event.description}</span>}
        <span className="milestone-axes">
          {eventAxes.map((axis) => axis.name).join(' · ')}
        </span>
      </button>
      {editor && (
        <span className="milestone-editor-actions">
          <button type="button" onClick={action(() => onEdit(event))}>编辑</button>
          <button type="button" onClick={action(() => onDelete(event))}>删除</button>
        </span>
      )}
    </div>
  );
}
