import type { TimelineAxis } from './types';

interface FilterChipsProps {
  axes: TimelineAxis[];
  filters: Set<number>;
  onToggle: (axisId: number) => void;
  onClear: () => void;
}

export default function FilterChips({ axes, filters, onToggle, onClear }: FilterChipsProps) {
  return (
    <div className="filter-chips" aria-label="按时间轴筛选">
      <button type="button" className={filters.size === 0 ? 'is-active' : ''} onClick={onClear}>全部</button>
      {axes.map((axis) => (
        <button
          key={axis.id}
          type="button"
          className={filters.has(axis.id) ? 'is-active' : ''}
          style={{ '--chip-color': axis.color } as React.CSSProperties}
          onClick={() => onToggle(axis.id)}
        >
          <span aria-hidden="true" />{axis.name}
        </button>
      ))}
    </div>
  );
}
