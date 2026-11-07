import FilterChips from './FilterChips';
import type { TimelineAxis, TimelineMode } from './types';

interface ToolbarProps {
  axes: TimelineAxis[];
  filters: Set<number>;
  mode: TimelineMode;
  editor: boolean;
  years: number[];
  onToggleFilter: (axisId: number) => void;
  onClearFilters: () => void;
  onModeChange: (mode: TimelineMode) => void;
  onYearJump: (year: number) => void;
  onLogin: () => void;
  onLogout: () => void;
  onNewEvent: () => void;
  onManageAxes: () => void;
  offlineSlot?: React.ReactNode;
}

export default function Toolbar({
  axes,
  filters,
  mode,
  editor,
  years,
  onToggleFilter,
  onClearFilters,
  onModeChange,
  onYearJump,
  onLogin,
  onLogout,
  onNewEvent,
  onManageAxes,
  offlineSlot,
}: ToolbarProps) {
  return (
    <div className="timeline-toolbar" aria-label="时间轴工具托盘">
      <FilterChips axes={axes} filters={filters} onToggle={onToggleFilter} onClear={onClearFilters} />
      <span className="toolbar-separator" />
      <div className="mode-switch" aria-label="时间显示模式">
        <button type="button" className={mode === 'compact' ? 'is-active' : ''} onClick={() => onModeChange('compact')}>📖 紧凑</button>
        <button type="button" className={mode === 'chronological' ? 'is-active' : ''} onClick={() => onModeChange('chronological')}>📐 时间</button>
      </div>
      {years.length > 0 && (
        <select aria-label="跳转年份" defaultValue="" onChange={(event) => event.target.value && onYearJump(Number(event.target.value))}>
          <option value="" disabled>年份</option>
          {years.map((year) => <option value={year} key={year}>{year}</option>)}
        </select>
      )}
      <span className="toolbar-separator" />
      {offlineSlot}
      {editor ? (
        <>
          <button type="button" className="toolbar-primary" onClick={onNewEvent}>＋ 记一笔</button>
          <button type="button" onClick={onManageAxes}>管理轴</button>
          <button type="button" onClick={onLogout}>退出编辑</button>
        </>
      ) : (
        <button type="button" onClick={onLogin}>编辑</button>
      )}
    </div>
  );
}
