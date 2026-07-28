import { createRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import AxisRenderer from './AxisRenderer';
import EditPanel from './EditPanel';
import LoginPrompt from './LoginPrompt';
import Milestone from './Milestone';
import NodeCard from './NodeCard';
import NodeDetail from './NodeDetail';
import Toolbar from './Toolbar';
import YearNav from './YearNav';
import {
  createAxis,
  createEvent,
  deleteAxis,
  deleteEvent,
  fetchAllEvents,
  fetchAxes,
  login,
  storeToken,
  updateAxis,
  updateEvent,
  uploadMedia,
  verifySession,
} from './api';
import { computeTimelineLayout } from './layout';
import type {
  AxisDraft,
  EventDraft,
  PositionedEvent,
  TimelineAxis,
  TimelineEvent,
  TimelineMedia,
  TimelineMode,
  ToastState,
} from './types';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const formatToday = (): string =>
  new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

function Toast({ toast }: { toast: NonNullable<ToastState> }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    gsap.fromTo(ref.current, { autoAlpha: 0, y: 12, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.38, ease: 'power2.out' });
  }, { scope: ref });
  return <div ref={ref} className={`timeline-toast timeline-toast--${toast.tone}`} role="status">{toast.message}</div>;
}

export default function TimelineApp() {
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<number, React.RefObject<HTMLDivElement | null>>());
  const previousY = useRef(new Map<number, number>());
  const enteredOnce = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const [axes, setAxes] = useState<TimelineAxis[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [mode, setMode] = useState<TimelineMode>('compact');
  const [filters, setFilters] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editor, setEditor] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [detail, setDetail] = useState<{ event: PositionedEvent; origin: DOMRect } | null>(null);
  const [editPanel, setEditPanel] = useState<{ kind: 'event' | 'axes'; event: TimelineEvent | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [activeYear, setActiveYear] = useState<number | null>(null);

  const layout = useMemo(() => computeTimelineLayout(axes, events, mode), [axes, events, mode]);
  const years = useMemo(() => layout.years.map((item) => item.year), [layout.years]);
  const getNodeRef = (eventId: number) => {
    let ref = nodeRefs.current.get(eventId);
    if (!ref) {
      ref = createRef<HTMLDivElement>();
      nodeRefs.current.set(eventId, ref);
    }
    return ref;
  };

  const showToast = useCallback((message: string, tone: NonNullable<ToastState>['tone'] = 'success') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError('');
    try {
      const [nextAxes, nextEvents] = await Promise.all([fetchAxes(), fetchAllEvents()]);
      setAxes(nextAxes);
      setEvents(nextEvents);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '时间轴读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    void verifySession().then(setEditor);
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [loadData]);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const progressState = { value: 0 };
      const setAge = (progress: number) => {
        const lightness = 0.96 + (0.9 - 0.96) * progress;
        const chroma = 0.01 + (0.04 - 0.01) * progress;
        const paperHue = 80 + (75 - 80) * progress;
        const inkLightness = 0.25 + (0.32 - 0.25) * progress;
        const inkChroma = 0.02 + (0.03 - 0.02) * progress;
        const rawInkHue = 260 + progress * 155;
        const inkHue = rawInkHue > 360 ? rawInkHue - 360 : rawInkHue;
        root.style.setProperty('--paper', `oklch(${lightness.toFixed(4)} ${chroma.toFixed(4)} ${paperHue.toFixed(2)})`);
        root.style.setProperty('--ink', `oklch(${inkLightness.toFixed(4)} ${inkChroma.toFixed(4)} ${inkHue.toFixed(2)})`);
        root.style.setProperty('--noise-opacity', String((0.025 + progress * 0.035).toFixed(4)));
        root.style.setProperty('--age-progress', progress.toFixed(4));
      };
      setAge(0);
      gsap.to(progressState, {
        value: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: 'bottom bottom',
          scrub: true,
          invalidateOnRefresh: true,
        },
        onUpdate: () => setAge(progressState.value),
      });
    },
    { scope: rootRef },
  );

  useGSAP(
    () => {
      const stage = stageRef.current;
      if (!stage || loading) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const elements = Array.from(stage.querySelectorAll<HTMLElement>('[data-event-id]'));
      const nextY = new Map<number, number>();

      elements.forEach((element) => {
        const id = Number(element.dataset.eventId);
        const targetY = Number(element.dataset.y);
        nextY.set(id, targetY);
        const fromY = previousY.current.get(id);
        const isMilestone = element.classList.contains('milestone');
        gsap.set(element, { xPercent: isMilestone ? 0 : -50 });
        if (fromY !== undefined && Math.abs(fromY - targetY) > 1 && !reduced) {
          gsap.fromTo(
            element,
            { y: fromY },
            { y: targetY, duration: 0.58, ease: 'power2.inOut', overwrite: 'auto' },
          );
        } else {
          gsap.set(element, { y: targetY });
        }

        const event = events.find((candidate) => candidate.id === id);
        const matches = !event || filters.size === 0 || event.axis_ids.some((axisId) => filters.has(axisId));
        gsap.to(element, {
          opacity: matches ? 1 : 0.18,
          scale: matches ? 1 : 0.985,
          duration: reduced ? 0.12 : 0.4,
          ease: 'power2.inOut',
          overwrite: 'auto',
        });
      });
      previousY.current = nextY;

      if (!enteredOnce.current) {
        enteredOnce.current = true;
        if (reduced) {
          gsap.set(elements, { autoAlpha: 1 });
        } else {
          ScrollTrigger.batch(elements, {
            start: 'clamp(top 88%)',
            once: true,
            interval: 0.08,
            batchMax: 4,
            onEnter: (batch) => gsap.fromTo(
              batch,
              { autoAlpha: 0, scale: 0.985 },
              {
                autoAlpha: 1,
                scale: 1,
                duration: 0.48,
                ease: 'power2.out',
                stagger: 0.055,
                overwrite: true,
              },
            ),
          });
        }
      }

      const refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 80);
      return () => window.clearTimeout(refreshTimer);
    },
    {
      scope: stageRef,
      dependencies: [layout, loading, filters, events],
      revertOnUpdate: false,
    },
  );

  useEffect(() => {
    let ticking = false;
    const updateYear = () => {
      ticking = false;
      const stage = stageRef.current;
      if (!stage || layout.events.length === 0) return;
      const stageTop = stage.getBoundingClientRect().top + window.scrollY;
      const localY = window.scrollY + window.innerHeight * 0.34 - stageTop;
      const current = layout.events.reduce((closest, event) =>
        Math.abs(event.y - localY) < Math.abs(closest.y - localY) ? event : closest,
      );
      setActiveYear(Number(current.event_date.slice(0, 4)));
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateYear);
    };
    updateYear();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [layout.events]);

  const jumpToYear = (year: number) => {
    const anchor = stageRef.current?.querySelector<HTMLElement>(`[data-year-anchor="${year}"]`);
    anchor?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  const handleLogin = async (password: string) => {
    setLoginBusy(true);
    setLoginError('');
    try {
      await login(password);
      setEditor(true);
      setLoginOpen(false);
      showToast('编辑状态已开启');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : '密码验证失败');
    } finally {
      setLoginBusy(false);
    }
  };

  const saveEvent = async (draft: EventDraft, eventId: number | null) => {
    setSaving(true);
    try {
      if (eventId) await updateEvent(eventId, draft);
      else await createEvent(draft);
      await loadData(true);
      setEditPanel(null);
      showToast(eventId ? '这一页已经改好' : '新的一页已经写下');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const saveAxis = async (draft: AxisDraft, axisId: number | null) => {
    setSaving(true);
    try {
      if (axisId) await updateAxis(axisId, draft);
      else await createAxis(draft);
      await loadData(true);
      showToast(axisId ? '叙事轴已更新' : '新的叙事轴已出现');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '轴保存失败', 'error');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const removeAxis = async (axis: TimelineAxis) => {
    if (!window.confirm(`删除“${axis.name}”？已挂载事件的轴不能直接删除。`)) return;
    setSaving(true);
    try {
      await deleteAxis(axis.id);
      setFilters((current) => {
        const next = new Set(current);
        next.delete(axis.id);
        return next;
      });
      await loadData(true);
      showToast('叙事轴已删除');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeEvent = async (event: TimelineEvent) => {
    if (!window.confirm(`删除“${event.title}”？关联媒体也会从存储中移除。`)) return;
    setSaving(true);
    try {
      await deleteEvent(event.id);
      setDetail(null);
      await loadData(true);
      showToast('这一页已从日记中移除');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openEditor = () => {
    if (editor) setEditPanel({ kind: 'event', event: null });
    else setLoginOpen(true);
  };

  return (
    <main ref={rootRef} className="timeline-page">
      <svg className="paper-noise" aria-hidden="true">
        <filter id="paper-fibers">
          <feTurbulence type="fractalNoise" baseFrequency="0.72 0.18" numOctaves="4" seed="17" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#paper-fibers)" />
      </svg>

      <a className="back-link" href="/" aria-label="返回 luckyrong">← <span>luckyrong</span></a>

      <header className="timeline-heading">
        <p>{formatToday()}</p>
        <h1>我们的时间轴</h1>
        <span>从今天往下翻，纸页会慢慢记住时间。</span>
        <div className="fresh-ink-mark" aria-hidden="true" />
      </header>

      {loading ? (
        <section className="timeline-loading" aria-live="polite">
          <span />
          <p>正在把散落的纸页放回原位…</p>
        </section>
      ) : loadError ? (
        <section className="timeline-error" role="alert">
          <p>{loadError}</p>
          <button type="button" className="paper-button" onClick={() => void loadData()}>重新翻开</button>
        </section>
      ) : (
        <>
          <div
            ref={stageRef}
            className={`timeline-stage timeline-stage--${mode}`}
            style={{ height: layout.height }}
          >
            <AxisRenderer axes={axes} events={events} layout={layout} filters={filters} />

            {layout.years.map(({ year, y }) => (
              <span key={year} className="year-anchor" data-year-anchor={year} style={{ top: y - 80 }} />
            ))}

            {layout.folds.map((fold) => (
              <div key={fold.id} className="fold-marker" style={{ top: fold.y }}>
                <span>· · ·</span> {fold.months} 个月 <span>· · ·</span>
              </div>
            ))}

            {layout.events.map((event) => {
              const matches = filters.size === 0 || event.axis_ids.some((axisId) => filters.has(axisId));
              const commonProps = {
                event,
                axes,
                dimmed: !matches,
                editor,
                nodeRef: getNodeRef(event.id),
                onOpen: (selectedEvent: PositionedEvent, origin: DOMRect) => setDetail({ event: selectedEvent, origin }),
                onEdit: (selectedEvent: PositionedEvent) => setEditPanel({ kind: 'event' as const, event: selectedEvent }),
                onDelete: (selectedEvent: PositionedEvent) => void removeEvent(selectedEvent),
              };
              return event.type === 'milestone' ? (
                <Milestone key={event.id} {...commonProps} />
              ) : (
                <NodeCard key={event.id} {...commonProps} selected={detail?.event.id === event.id} />
              );
            })}

            {events.length === 0 && (
              <section className="empty-page">
                <span>第一页还留着空白</span>
                <h2>有些故事，值得慢慢写。</h2>
                <p>轴已经铺好。验证编辑密码后，可以从今天记下第一件事。</p>
                <button type="button" className="paper-button paper-button--primary" onClick={openEditor}>{editor ? '记下第一件事' : '开始书写'}</button>
              </section>
            )}
          </div>

          <p className="timeline-ending">— 最早的那一页，也不是故事的开头 —</p>

          <Toolbar
            axes={axes}
            filters={filters}
            mode={mode}
            editor={editor}
            years={years}
            onToggleFilter={(axisId) => setFilters((current) => {
              const next = new Set(current);
              if (next.has(axisId)) next.delete(axisId);
              else next.add(axisId);
              return next;
            })}
            onClearFilters={() => setFilters(new Set())}
            onModeChange={setMode}
            onYearJump={jumpToYear}
            onLogin={() => { setLoginError(''); setLoginOpen(true); }}
            onLogout={() => { storeToken(null); setEditor(false); setEditPanel(null); showToast('已退出编辑状态', 'info'); }}
            onNewEvent={() => setEditPanel({ kind: 'event', event: null })}
            onManageAxes={() => setEditPanel({ kind: 'axes', event: null })}
          />
          <YearNav years={years} activeYear={activeYear} onJump={jumpToYear} />
        </>
      )}

      {detail && <NodeDetail event={detail.event} axes={axes} origin={detail.origin} onClose={() => setDetail(null)} />}
      {loginOpen && <LoginPrompt busy={loginBusy} error={loginError} onSubmit={handleLogin} onClose={() => setLoginOpen(false)} />}
      {editPanel && (
        <EditPanel
          kind={editPanel.kind}
          event={editPanel.event}
          axes={axes}
          busy={saving}
          onClose={() => setEditPanel(null)}
          onSaveEvent={saveEvent}
          onSaveAxis={saveAxis}
          onDeleteAxis={removeAxis}
          onUpload={(file: File, onProgress: (progress: number) => void): Promise<TimelineMedia> => uploadMedia(file, onProgress)}
        />
      )}
      {toast && <Toast key={`${toast.tone}-${toast.message}`} toast={toast} />}
    </main>
  );
}
