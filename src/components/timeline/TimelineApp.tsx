import { createRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import AxisRenderer from './AxisRenderer';
import EditPanel from './EditPanel';
import LoginPrompt from './LoginPrompt';
import Milestone from './Milestone';
import NodeCard from './NodeCard';
import NodeDetail from './NodeDetail';
import PaperSurface from './PaperSurface';
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
  reorderAxes as persistAxisOrder,
  storeToken,
  updateAxis,
  updateEvent,
  uploadMedia,
  verifySession,
} from './api';
import { computeTimelineLayout } from './layout';
import {
  buildPaperSurface,
  eventAgeProgress,
  inkColorAt,
  paperColorAt,
  VISUAL_TRANSITION_EASE,
  VISUAL_TRANSITION_SECONDS,
} from './paperAging';
import type { PaperSurfaceSpec } from './paperAging';
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

interface VisualTransitionState {
  revision: number;
  previousLayout: ReturnType<typeof computeTimelineLayout>;
  previousPaper: PaperSurfaceSpec | null;
  previousY: Map<number, number>;
  newAxisIds: number[];
  anchor: { eventId: number; viewportOffset: number } | null;
}

function Toast({ toast }: { toast: NonNullable<ToastState> }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    gsap.fromTo(ref.current, { autoAlpha: 0, y: 12, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.38, ease: 'power2.out' });
  }, { scope: ref });
  return <div ref={ref} className={`timeline-toast timeline-toast--${toast.tone}`} role="status">{toast.message}</div>;
}

export default function TimelineApp() {
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const outgoingHostRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<number, React.RefObject<HTMLDivElement | null>>());
  const enteredOnce = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const dataRevision = useRef(0);
  const visualRevision = useRef(0);
  const visualTimeline = useRef<gsap.core.Timeline | null>(null);
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
  const [stageOffset, setStageOffset] = useState<number | null>(null);
  const [transition, setTransition] = useState<VisualTransitionState | null>(null);

  const layout = useMemo(() => computeTimelineLayout(axes, events, mode), [axes, events, mode]);
  const years = useMemo(() => layout.years.map((item) => item.year), [layout.years]);
  const agingProgress = useMemo(() => eventAgeProgress(layout), [layout]);
  const paperSpec = useMemo(
    () => stageOffset === null ? null : buildPaperSurface(layout, stageOffset, transition?.previousLayout),
    [layout, stageOffset, transition?.previousLayout],
  );
  const viewRef = useRef({ axes, events, mode, layout });
  const paperSpecRef = useRef<PaperSurfaceSpec | null>(paperSpec);
  viewRef.current = { axes, events, mode, layout };
  paperSpecRef.current = paperSpec;
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

  const commitVisualState = useCallback((nextAxes: TimelineAxis[], nextEvents: TimelineEvent[], nextMode: TimelineMode) => {
    const current = viewRef.current;
    const stage = stageRef.current;
    const outgoingHost = outgoingHostRef.current;

    visualTimeline.current?.progress(1);
    visualTimeline.current = null;
    outgoingHost?.replaceChildren();

    if (stage && outgoingHost) {
      const clone = stage.cloneNode(true) as HTMLDivElement;
      clone.classList.add('timeline-stage--snapshot');
      clone.setAttribute('aria-hidden', 'true');
      clone.style.height = `${current.layout.height}px`;
      clone.style.opacity = '1';
      clone.querySelectorAll<HTMLElement>('[id]').forEach((element) => element.removeAttribute('id'));
      clone.querySelectorAll<HTMLElement>('button, a, input, select, textarea, video').forEach((element) => {
        element.setAttribute('tabindex', '-1');
      });
      outgoingHost.appendChild(clone);

      const nextIds = new Set(nextEvents.map((event) => event.id));
      const viewportLine = window.innerHeight * 0.34;
      const anchorEvent = current.layout.events
        .filter((event) => nextIds.has(event.id))
        .map((event) => ({
          event,
          element: stage.querySelector<HTMLElement>(`[data-event-id="${event.id}"]`),
        }))
        .filter((item): item is { event: PositionedEvent; element: HTMLElement } => Boolean(item.element))
        .reduce<{ event: PositionedEvent; element: HTMLElement } | null>((closest, item) => {
          if (!closest) return item;
          return Math.abs(item.element.getBoundingClientRect().top - viewportLine)
            < Math.abs(closest.element.getBoundingClientRect().top - viewportLine) ? item : closest;
        }, null);

      const oldAxisIds = new Set(current.axes.map((axis) => axis.id));
      setTransition({
        revision: ++visualRevision.current,
        previousLayout: current.layout,
        previousPaper: paperSpecRef.current,
        previousY: new Map(current.layout.events.map((event) => [event.id, event.y])),
        newAxisIds: nextAxes.filter((axis) => !oldAxisIds.has(axis.id)).map((axis) => axis.id),
        anchor: anchorEvent ? {
          eventId: anchorEvent.event.id,
          viewportOffset: anchorEvent.element.getBoundingClientRect().top - viewportLine,
        } : null,
      });
    } else {
      setTransition(null);
    }

    setAxes(nextAxes);
    setEvents(nextEvents);
    setMode(nextMode);
  }, []);

  const loadData = useCallback(async (quiet = false) => {
    const revision = ++dataRevision.current;
    if (!quiet) setLoading(true);
    if (!quiet) setLoadError('');
    try {
      const [nextAxes, nextEvents] = await Promise.all([fetchAxes(), fetchAllEvents()]);
      if (revision !== dataRevision.current) return false;
      commitVisualState(nextAxes, nextEvents, viewRef.current.mode);
      return true;
    } catch (error) {
      if (revision !== dataRevision.current) return false;
      if (quiet) throw error;
      setLoadError(error instanceof Error ? error.message : '时间轴读取失败');
      return false;
    } finally {
      if (revision === dataRevision.current) setLoading(false);
    }
  }, [commitVisualState]);

  useEffect(() => {
    void loadData();
    void verifySession().then(setEditor);
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [loadData]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const nextOffset = stage.offsetTop;
      setStageOffset((current) => current !== null && Math.abs(current - nextOffset) < 0.5 ? current : nextOffset);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (headingRef.current) observer.observe(headingRef.current);
    observer.observe(stage);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [loading]);

  useLayoutEffect(() => {
    if (!transition) return;
    const stage = stageRef.current;
    const outgoing = outgoingHostRef.current?.firstElementChild as HTMLElement | null;
    const currentPaper = rootRef.current?.querySelector<HTMLElement>('.paper-surface__layer--current') ?? null;
    const previousPaper = rootRef.current?.querySelector<HTMLElement>('.paper-surface__layer--previous') ?? null;
    if (!stage) return;

    const viewportLine = window.innerHeight * 0.34;
    if (transition.anchor) {
      const anchor = stage.querySelector<HTMLElement>(`[data-event-id="${transition.anchor.eventId}"]`);
      if (anchor) {
        const delta = anchor.getBoundingClientRect().top - (viewportLine + transition.anchor.viewportOffset);
        if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: 'auto' });
      }
    }

    const elements = Array.from(stage.querySelectorAll<HTMLElement>('[data-event-id]'));
    elements.forEach((element) => {
      gsap.set(element, {
        xPercent: element.classList.contains('milestone') ? 0 : -50,
        y: Number(element.dataset.y),
      });
    });

    const finish = () => {
      gsap.set([stage, currentPaper, ...elements].filter(Boolean), { clearProps: 'willChange' });
      outgoingHostRef.current?.replaceChildren();
      ScrollTrigger.refresh();
      setTransition((current) => current?.revision === transition.revision ? null : current);
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      gsap.set([stage, currentPaper].filter(Boolean), { autoAlpha: 1 });
      gsap.set([outgoing, previousPaper].filter(Boolean), { autoAlpha: 0 });
      finish();
      return;
    }

    gsap.set([stage, currentPaper].filter(Boolean), { autoAlpha: 0, willChange: 'opacity' });
    gsap.set([outgoing, previousPaper].filter(Boolean), { autoAlpha: 1, willChange: 'opacity' });
    elements.forEach((element) => {
      const fromY = transition.previousY.get(Number(element.dataset.eventId));
      const targetY = Number(element.dataset.y);
      if (fromY !== undefined && Math.abs(fromY - targetY) > 1) {
        gsap.set(element, { y: fromY, willChange: 'transform' });
      }
    });

    const timeline = gsap.timeline({
      defaults: { duration: VISUAL_TRANSITION_SECONDS, ease: VISUAL_TRANSITION_EASE },
      onComplete: finish,
    });
    timeline.to([stage, currentPaper].filter(Boolean), { autoAlpha: 1 }, 0);
    timeline.to([outgoing, previousPaper].filter(Boolean), { autoAlpha: 0 }, 0);

    elements.forEach((element) => {
      const fromY = transition.previousY.get(Number(element.dataset.eventId));
      const targetY = Number(element.dataset.y);
      if (fromY !== undefined && Math.abs(fromY - targetY) > 1) {
        timeline.to(element, { y: targetY }, 0);
      }
    });

    transition.newAxisIds.forEach((axisId) => {
      stage.querySelectorAll<SVGPathElement>(`[data-axis-id="${axisId}"] path`).forEach((path) => {
        const length = path.getTotalLength();
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length, willChange: 'stroke-dashoffset' });
        timeline.to(path, { strokeDashoffset: 0, clearProps: 'strokeDasharray,strokeDashoffset,willChange' }, 0);
      });
    });

    visualTimeline.current = timeline;
    return () => {
      if (visualTimeline.current === timeline) visualTimeline.current = null;
      timeline.kill();
    };
  }, [transition?.revision, layout]);

  useGSAP(
    () => {
      const stage = stageRef.current;
      if (!stage || loading || enteredOnce.current) return;
      const elements = Array.from(stage.querySelectorAll<HTMLElement>('[data-event-id]'));
      elements.forEach((element) => gsap.set(element, {
        xPercent: element.classList.contains('milestone') ? 0 : -50,
        y: Number(element.dataset.y),
      }));
      enteredOnce.current = true;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.set(elements, { autoAlpha: 1 });
      } else {
        ScrollTrigger.batch(elements, {
          start: 'clamp(top 88%)',
          once: true,
          interval: 0.08,
          batchMax: 4,
          onEnter: (batch) => gsap.fromTo(batch, { autoAlpha: 0, scale: 0.985 }, {
            autoAlpha: 1,
            scale: 1,
            duration: 0.48,
            ease: 'power2.out',
            stagger: 0.055,
            overwrite: true,
          }),
        });
      }
      const refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 80);
      return () => window.clearTimeout(refreshTimer);
    },
    { scope: stageRef, dependencies: [loading], revertOnUpdate: false },
  );

  const filterKey = [...filters].sort((a, b) => a - b).join(',');
  useGSAP(
    () => {
      const stage = stageRef.current;
      if (!stage || loading) return;
      const eventMap = new Map(events.map((event) => [event.id, event]));
      stage.querySelectorAll<HTMLElement>('[data-event-id]').forEach((element) => {
        const event = eventMap.get(Number(element.dataset.eventId));
        const matches = !event || filters.size === 0 || event.axis_ids.some((axisId) => filters.has(axisId));
        gsap.to(element, {
          opacity: matches ? 1 : 0.18,
          scale: matches ? 1 : 0.985,
          duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.01 : VISUAL_TRANSITION_SECONDS,
          ease: VISUAL_TRANSITION_EASE,
          overwrite: 'auto',
        });
      });
    },
    { scope: stageRef, dependencies: [filterKey, events], revertOnUpdate: false },
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

  const saveAxisOrder = async (axisIds: number[]) => {
    setSaving(true);
    try {
      const response = await persistAxisOrder(axisIds);
      commitVisualState(response.axes, viewRef.current.events, viewRef.current.mode);
      showToast('线条顺序已经整理好');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '轴顺序保存失败', 'error');
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

  const changeMode = (nextMode: TimelineMode) => {
    if (nextMode === viewRef.current.mode) return;
    commitVisualState(viewRef.current.axes, viewRef.current.events, nextMode);
  };

  return (
    <main ref={rootRef} className="timeline-page">
      <PaperSurface current={paperSpec} previous={transition?.previousPaper ?? null} />

      <a className="back-link" href="/" aria-label="返回 luckyrong">← <span>luckyrong</span></a>

      <header ref={headingRef} className="timeline-heading">
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
          <div className="timeline-stage-shell">
            <div ref={outgoingHostRef} className="timeline-stage-outgoing" aria-hidden="true" />
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
                const progress = agingProgress.get(event.id) ?? 0;
                const commonProps = {
                  event,
                  axes,
                  dimmed: !matches,
                  editor,
                  paperColor: paperColorAt(progress),
                  inkColor: inkColorAt(progress),
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
            onModeChange={changeMode}
            onYearJump={jumpToYear}
            onLogin={() => { setLoginError(''); setLoginOpen(true); }}
            onLogout={() => { storeToken(null); setEditor(false); setEditPanel(null); showToast('已退出编辑状态', 'info'); }}
            onNewEvent={() => setEditPanel({ kind: 'event', event: null })}
            onManageAxes={() => setEditPanel({ kind: 'axes', event: null })}
          />
          <YearNav years={years} activeYear={activeYear} onJump={jumpToYear} />
        </>
      )}

      {detail && (
        <NodeDetail
          event={detail.event}
          axes={axes}
          origin={detail.origin}
          paperColor={paperColorAt(agingProgress.get(detail.event.id) ?? 0)}
          inkColor={inkColorAt(agingProgress.get(detail.event.id) ?? 0)}
          onClose={() => setDetail(null)}
        />
      )}
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
          onReorderAxes={saveAxisOrder}
          onDeleteAxis={removeAxis}
          onUpload={(file: File, onProgress: (progress: number) => void): Promise<TimelineMedia> => uploadMedia(file, onProgress)}
        />
      )}
      {toast && <Toast key={`${toast.tone}-${toast.message}`} toast={toast} />}
    </main>
  );
}
