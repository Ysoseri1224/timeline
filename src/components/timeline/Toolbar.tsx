import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
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
}

type StoredPosition = { x: number; y: number };
const POSITION_KEY = 'timeline-toolbar-position';

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
}: ToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [positioned, setPositioned] = useState(false);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return;
    try {
      const position = JSON.parse(raw) as StoredPosition;
      const rect = toolbar.getBoundingClientRect();
      const x = Math.max(12, Math.min(window.innerWidth - rect.width - 12, position.x));
      const y = Math.max(12, Math.min(window.innerHeight - rect.height - 12, position.y));
      gsap.set(toolbar, { left: x, top: y, xPercent: 0, bottom: 'auto' });
      setPositioned(true);
    } catch {
      window.localStorage.removeItem(POSITION_KEY);
    }
  }, []);

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const rect = toolbar.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!positioned) {
      gsap.set(toolbar, { left: rect.left, top: rect.top, xPercent: 0, bottom: 'auto' });
      setPositioned(true);
    }
    toolbar.classList.add('is-dragging');
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const toolbar = toolbarRef.current;
    const drag = dragRef.current;
    if (!toolbar || !drag || drag.pointerId !== event.pointerId) return;
    const rect = toolbar.getBoundingClientRect();
    const x = Math.max(12, Math.min(window.innerWidth - rect.width - 12, event.clientX - drag.offsetX));
    const y = Math.max(12, Math.min(window.innerHeight - rect.height - 12, event.clientY - drag.offsetY));
    gsap.set(toolbar, { left: x, top: y });
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !dragRef.current) return;
    dragRef.current = null;
    toolbar.classList.remove('is-dragging');
    const rect = toolbar.getBoundingClientRect();
    window.localStorage.setItem(POSITION_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div ref={toolbarRef} className="timeline-toolbar" aria-label="时间轴工具托盘">
      <button
        type="button"
        className="toolbar-grip"
        aria-label="拖动工具托盘"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        ···
      </button>
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
