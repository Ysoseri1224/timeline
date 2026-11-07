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
import { ConflictDialog, OfflineBar, OfflineButton, OfflinePanel } from './OfflineUI';
import type { OfflineState } from './OfflineUI';
import {
  createAxis,
  deleteAxis,
  fetchAllEvents,
  fetchAxes,
  getStoredToken,
  isNetworkError,
  login,
  reorderAxes as persistAxisOrder,
  storeToken,
  updateAxis,
  uploadMedia,
  verifySession,
} from './api';
import { applyOutbox, enqueue, loadOps, loadSnapshot, saveSnapshot, storeLocalImage } from './offline/outbox';
import type { OutboxOp } from './offline/outbox';
import { loadReport, prepareOffline, storageEstimate } from './offline/prepare';
import type { PrepareReport } from './offline/prepare';
import { resolveConflict, runSync } from './offline/sync';
import type { Resolution, SyncOutcome } from './offline/sync';
import { deliverFile, exportBackup, importBackup } from './offline/backup';
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
  // offline: serverRef = last known server data, opsRef = local outbox; the page shows both combined
  const serverRef = useRef<{ axes: TimelineAxis[]; events: TimelineEvent[] }>({ axes: [], events: [] });
  const opsRef = useRef<OutboxOp[]>([]);
  const hasData = useRef(false);
  const localTried = useRef(false);
  const [offline, setOffline] = useState<OfflineState>({ net: 'unknown', ops: [], syncing: null, authExpired: false, snapshotAt: null, swUpdated: false });
  const [panelOpen, setPanelOpen] = useState(false);
  const [conflictOp, setConflictOp] = useState<OutboxOp | null>(null);
  const [report, setReport] = useState<PrepareReport | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [preparing, setPreparing] = useState<{ label: string; done: number; total: number } | null>(null);
  const patchOffline = useCallback((patch: Partial<OfflineState>) => setOffline((current) => ({ ...current, ...patch })), []);

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

  const showData = useCallback((nextAxes: TimelineAxis[], serverEvents: TimelineEvent[], ops: OutboxOp[]) => {
    const display = applyOutbox(serverEvents, ops);
    const current = viewRef.current;
    hasData.current = true;
    if (JSON.stringify(current.axes) === JSON.stringify(nextAxes) && JSON.stringify(current.events) === JSON.stringify(display)) return;
    commitVisualState(nextAxes, display, current.mode);
  }, [commitVisualState]);

  const refreshOps = useCallback(async () => {
    const ops = await loadOps();
    opsRef.current = ops;
    patchOffline({ ops });
    showData(serverRef.current.axes, serverRef.current.events, ops);
    return ops;
  }, [patchOffline, showData]);

  const loadData = useCallback(async (quiet = false) => {
    const revision = ++dataRevision.current;
    if (!quiet) setLoadError('');
    // the copy saved on this device comes first, so a missing network never blocks the page
    if (!localTried.current) {
      localTried.current = true;
      try {
        const [snapshot, ops] = await Promise.all([loadSnapshot(), loadOps()]);
        opsRef.current = ops;
        patchOffline({ ops, snapshotAt: snapshot?.savedAt ?? null });
        if (snapshot) {
          serverRef.current = { axes: snapshot.axes, events: snapshot.events };
          showData(snapshot.axes, snapshot.events, ops);
          setLoading(false);
        }
      } catch { /* no IndexedDB: online-only */ }
    }
    if (!quiet && !hasData.current) setLoading(true);
    try {
      const [nextAxes, nextEvents] = await Promise.all([fetchAxes(), fetchAllEvents()]);
      if (revision !== dataRevision.current) return false;
      serverRef.current = { axes: nextAxes, events: nextEvents };
      void saveSnapshot(nextAxes, nextEvents).catch(() => {});
      patchOffline({ net: 'online', snapshotAt: Date.now() });
      showData(nextAxes, nextEvents, opsRef.current);
      return true;
    } catch (error) {
      if (revision !== dataRevision.current) return false;
      if (isNetworkError(error)) patchOffline({ net: 'offline' });
      if (hasData.current) return false; // keep showing the saved copy
      if (quiet) throw error;
      setLoadError(isNetworkError(error)
        ? '没有网络，这台设备上也还没有保存过时间轴。联网打开一次后，就能离线翻阅。'
        : error instanceof Error ? error.message : '时间轴读取失败');
      return false;
    } finally {
      if (revision === dataRevision.current) setLoading(false);
    }
  }, [patchOffline, showData]);

  const syncNow = useCallback(async (): Promise<SyncOutcome | null> => {
    const pending = opsRef.current.filter((op) => !op.conflict).length;
    if (pending === 0) return { kind: 'idle' };
    if (!getStoredToken()) { patchOffline({ authExpired: true }); return null; }
    patchOffline({ syncing: { done: 0, total: pending, label: '' } });
    try {
      const outcome = await runSync((progress) => patchOffline({ syncing: progress }));
      if (outcome.kind === 'offline') patchOffline({ net: 'offline' });
      if (outcome.kind === 'auth') { patchOffline({ authExpired: true }); setEditor(false); }
      if (outcome.kind === 'synced') {
        patchOffline({ net: 'online', authExpired: false });
        const snapshot = await loadSnapshot();
        if (snapshot) {
          serverRef.current = { axes: snapshot.axes, events: snapshot.events };
          patchOffline({ snapshotAt: snapshot.savedAt });
        }
        outcome.notes.forEach((note) => showToast(note, 'info'));
      }
      await refreshOps();
      return outcome;
    } catch (error) {
      showToast(error instanceof Error ? `同步出错：${error.message}` : '同步出错', 'error');
      return null;
    } finally {
      patchOffline({ syncing: null });
    }
  }, [patchOffline, refreshOps, showToast]);

  const syncMessage = (outcome: SyncOutcome | null, success: string): [string, NonNullable<ToastState>['tone']] => {
    if (!outcome || outcome.kind === 'auth') return ['已保存在本机；登录已过期，重新登录后同步', 'error'];
    if (outcome.kind === 'offline') return ['已保存在本机，联网后自动同步', 'info'];
    if (outcome.kind === 'synced' && outcome.conflicts > 0) return ['已保存在本机；有改动需要你选择保留哪个版本', 'error'];
    return [success, 'success'];
  };

  useEffect(() => {
    void loadData().then(() => {
      if (opsRef.current.some((op) => !op.conflict)) void syncNow();
    });
    void verifySession().then(setEditor);
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [loadData]);

  // reconnect: refresh data and send pending edits
  useEffect(() => {
    const kick = () => {
      void loadData(true).catch(() => {});
      if (opsRef.current.some((op) => !op.conflict)) void syncNow();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') kick(); };
    const onOffline = () => patchOffline({ net: 'offline' });
    window.addEventListener('online', kick);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && opsRef.current.some((op) => !op.conflict)) void syncNow();
    }, 30_000);
    let hadController = false;
    const onControllerChange = () => { if (hadController) patchOffline({ swUpdated: true }); };
    if ('serviceWorker' in navigator) {
      hadController = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    }
    return () => {
      window.removeEventListener('online', kick);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, [loadData, syncNow, patchOffline]);

  useEffect(() => {
    if (!panelOpen) return;
    void loadReport().then((r) => setReport(r ?? null)).catch(() => {});
    void storageEstimate().then(setStorage);
  }, [panelOpen]);

  const runPrepare = async () => {
    setPreparing({ label: '开始', done: 0, total: 1 });
    try {
      const result = await prepareOffline((label, done, total) => setPreparing({ label, done, total }));
      setReport(result);
      await loadData(true).catch(() => {});
      showToast(result.images.failed > 0 ? `有 ${result.images.failed} 张图片没下载成功，可以再点一次` : '离线准备完成', result.images.failed > 0 ? 'error' : 'success');
    } catch (error) {
      showToast(isNetworkError(error) ? '离线准备需要联网' : error instanceof Error ? error.message : '离线准备失败', 'error');
    } finally {
      setPreparing(null);
      setStorage(await storageEstimate());
    }
  };

  const runExport = async () => {
    try {
      const { file, ops, images } = await exportBackup();
      await deliverFile(file);
      showToast(`已导出 ${ops} 条改动、${images} 张图片`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showToast(error instanceof Error ? error.message : '导出失败', 'error');
    }
  };

  const runImport = async (file: File) => {
    try {
      const added = await importBackup(file);
      await refreshOps();
      showToast(added ? `导入了 ${added} 条改动` : '这些改动本机已经有了', 'info');
      if (added) void syncNow();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入失败', 'error');
    }
  };

  const resolve = async (op: OutboxOp, choice: Resolution, axisIds?: number[]) => {
    await resolveConflict(op, choice, axisIds);
    setConflictOp(null);
    await refreshOps();
    void syncNow();
  };

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
  }, [loading, offline]); // the offline bar adds top padding

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
      patchOffline({ authExpired: false });
      showToast('编辑状态已开启');
      void syncNow();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : '密码验证失败');
    } finally {
      setLoginBusy(false);
    }
  };

  // Edits are committed to this device first, then sent; the network only decides when.
  const saveEvent = async (draft: EventDraft, eventId: number | null) => {
    setSaving(true);
    try {
      const current = eventId ? viewRef.current.events.find((item) => item.id === eventId) ?? null : null;
      const serverVersion = eventId ? serverRef.current.events.find((item) => item.id === eventId) ?? null : null;
      await enqueue(eventId ? 'update' : 'create', current, serverVersion, draft);
      await refreshOps();
      setEditPanel(null);
    } catch (error) {
      showToast(error instanceof Error ? `没能存到本机：${error.message}` : '保存失败', 'error');
      throw error;
    } finally {
      setSaving(false);
    }
    const [message, tone] = syncMessage(await syncNow(), eventId ? '这一页已经改好' : '新的一页已经写下');
    showToast(message, tone);
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
      serverRef.current = { ...serverRef.current, axes: response.axes };
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
    try {
      const serverVersion = serverRef.current.events.find((item) => item.id === event.id) ?? null;
      await enqueue('delete', event, serverVersion, null);
      setDetail(null);
      await refreshOps();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败', 'error');
      return;
    }
    const [message, tone] = syncMessage(await syncNow(), '这一页已从日记中移除');
    showToast(message, tone);
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
            onLogout={() => {
              const pending = opsRef.current.length;
              if (pending && !window.confirm(`还有 ${pending} 条改动没同步。退出后要重新登录才能同步，确定退出？`)) return;
              storeToken(null); setEditor(false); setEditPanel(null); showToast('已退出编辑状态', 'info');
            }}
            onNewEvent={() => setEditPanel({ kind: 'event', event: null })}
            onManageAxes={() => {
              if (offline.net === 'offline') { showToast('管理轴需要联网；记录可以离线写', 'info'); return; }
              setEditPanel({ kind: 'axes', event: null });
            }}
            offlineSlot={<OfflineButton state={offline} onOpen={() => setPanelOpen(true)} />}
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
          onUpload={(file: File, onProgress: (progress: number) => void): Promise<TimelineMedia> => {
            // images wait on this device and go up with the sync; videos still need the network
            if (file.type.startsWith('image/')) return storeLocalImage(file);
            if (offline.net === 'offline') return Promise.reject(new Error('视频需要联网后再上传，文字和图片可以先保存'));
            return uploadMedia(file, onProgress);
          }}
        />
      )}
      <OfflineBar state={offline} onOpen={() => {
        const conflict = offline.ops.find((op) => op.conflict);
        if (conflict) setConflictOp(conflict);
        else if (offline.authExpired) { setLoginError(''); setLoginOpen(true); }
        else setPanelOpen(true);
      }} />
      {panelOpen && (
        <OfflinePanel
          state={offline}
          editor={editor}
          report={report}
          storage={storage}
          preparing={preparing}
          onClose={() => setPanelOpen(false)}
          onSync={() => void syncNow()}
          onPrepare={() => void runPrepare()}
          onExport={() => void runExport()}
          onImport={(file) => void runImport(file)}
          onLogin={() => { setPanelOpen(false); setLoginError(''); setLoginOpen(true); }}
          onOpenConflict={(op) => { setPanelOpen(false); setConflictOp(op); }}
        />
      )}
      {conflictOp && <ConflictDialog op={conflictOp} axes={axes} onResolve={(op, choice, ids) => void resolve(op, choice, ids)} onClose={() => setConflictOp(null)} />}
      {toast && <Toast key={`${toast.tone}-${toast.message}`} toast={toast} />}
    </main>
  );
}
