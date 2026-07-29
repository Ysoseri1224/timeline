import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { moveAxisAround, moveAxisBy, sortAxes } from './axisOrder';
import { describeEventContent, normalizeCoverMediaKey } from './contentPresentation';
import type {
  AxisDraft,
  EventDraft,
  TimelineAxis,
  TimelineEvent,
  TimelineMedia,
} from './types';

interface EditPanelProps {
  kind: 'event' | 'axes';
  event: TimelineEvent | null;
  axes: TimelineAxis[];
  busy: boolean;
  onClose: () => void;
  onSaveEvent: (draft: EventDraft, eventId: number | null) => Promise<void>;
  onSaveAxis: (draft: AxisDraft, axisId: number | null) => Promise<void>;
  onReorderAxes: (axisIds: number[]) => Promise<void>;
  onDeleteAxis: (axis: TimelineAxis) => Promise<void>;
  onUpload: (file: File, onProgress: (progress: number) => void) => Promise<TimelineMedia>;
}

const today = (): string => {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const emptyEvent = (axes: TimelineAxis[]): EventDraft => {
  const primaryAxis = axes.find((axis) => axis.is_primary);
  return {
    type: 'entry',
    title: '',
    subtitle: '',
    description: '',
    event_date: today(),
    color: '',
    media: [],
    cover_media_key: null,
    axis_ids: primaryAxis ? [primaryAxis.id] : [],
  };
};

const eventToDraft = (event: TimelineEvent): EventDraft => ({
  type: event.type,
  title: event.title,
  subtitle: event.subtitle || '',
  description: event.description || '',
  event_date: event.event_date,
  color: event.color || '',
  media: event.media,
  cover_media_key: event.cover_media_key,
  axis_ids: event.axis_ids,
});

const emptyAxis = (sortOrder: number): AxisDraft => ({
  name: '',
  color: '#9d6c7b',
  sort_order: sortOrder,
  parent_axis_id: null,
  start_date: '',
  end_date: '',
  merge_axis_id: null,
});

const axisToDraft = (axis: TimelineAxis): AxisDraft => ({
  name: axis.name,
  color: axis.color,
  sort_order: axis.sort_order,
  parent_axis_id: axis.parent_axis_id,
  start_date: axis.start_date || '',
  end_date: axis.end_date || '',
  merge_axis_id: axis.merge_axis_id,
});

export default function EditPanel({
  kind,
  event,
  axes,
  busy,
  onClose,
  onSaveEvent,
  onSaveAxis,
  onReorderAxes,
  onDeleteAxis,
  onUpload,
}: EditPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft>(() => (event ? eventToDraft(event) : emptyEvent(axes)));
  const [editingAxisId, setEditingAxisId] = useState<number | null>(null);
  const [axisDraft, setAxisDraft] = useState<AxisDraft>(() => emptyAxis(axes.length));
  const [orderedAxes, setOrderedAxes] = useState<TimelineAxis[]>(() => sortAxes(axes));
  const [draggingAxisId, setDraggingAxisId] = useState<number | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [localError, setLocalError] = useState('');
  const orderedAxesRef = useRef(orderedAxes);
  const dragStartOrderRef = useRef<TimelineAxis[]>(orderedAxes);
  const dragSessionRef = useRef<{
    axisId: number;
    pointerId: number;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const suppressAxisSelectionRef = useRef<number | null>(null);
  const editingAxis = useMemo(() => axes.find((axis) => axis.id === editingAxisId) ?? null, [axes, editingAxisId]);

  useEffect(() => {
    setEventDraft(event ? eventToDraft(event) : emptyEvent(axes));
  }, [event, axes]);

  useEffect(() => {
    const next = sortAxes(axes);
    orderedAxesRef.current = next;
    setOrderedAxes(next);
  }, [axes]);

  useEffect(() => {
    setAxisDraft(editingAxis ? axisToDraft(editingAxis) : emptyAxis(axes.length));
  }, [editingAxis, axes.length]);

  useGSAP(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    gsap.timeline({ defaults: { ease: 'power2.out' } })
      .fromTo('.edit-backdrop', { autoAlpha: 0 }, { autoAlpha: 1, duration: reduced ? 0.1 : 0.28 })
      .fromTo('.edit-sheet', { autoAlpha: 0, x: reduced ? 0 : 28, scale: reduced ? 1 : 0.985 }, { autoAlpha: 1, x: 0, scale: 1, duration: reduced ? 0.14 : 0.46 }, 0.03)
      .fromTo('.edit-sheet [data-form-part]', { autoAlpha: 0, y: reduced ? 0 : 8 }, { autoAlpha: 1, y: 0, duration: reduced ? 0.1 : 0.32, stagger: 0.035 }, 0.14);
  }, { scope: rootRef });

  const updateEvent = <K extends keyof EventDraft>(field: K, value: EventDraft[K]) => {
    setEventDraft((current) => ({ ...current, [field]: value }));
  };

  const updateAxis = <K extends keyof AxisDraft>(field: K, value: AxisDraft[K]) => {
    setAxisDraft((current) => ({ ...current, [field]: value }));
  };

  const applyAxisOrder = (next: TimelineAxis[]) => {
    orderedAxesRef.current = next;
    setOrderedAxes(next);
  };

  const commitAxisOrder = async (next: TimelineAxis[]) => {
    const axisIds = next.map((axis) => axis.id);
    if (axisIds.every((axisId, index) => sortAxes(axes)[index]?.id === axisId)) return;
    setLocalError('');
    setReorderBusy(true);
    try {
      await onReorderAxes(axisIds);
    } catch (error) {
      applyAxisOrder(sortAxes(axes));
      setLocalError(error instanceof Error ? error.message : '轴顺序保存失败');
    } finally {
      setReorderBusy(false);
    }
  };

  const selectAxis = (axisId: number) => {
    if (suppressAxisSelectionRef.current === axisId) {
      suppressAxisSelectionRef.current = null;
      return;
    }
    setEditingAxisId(axisId);
  };

  const beginAxisDrag = (pointerEvent: ReactPointerEvent<HTMLDivElement>, axis: TimelineAxis) => {
    if (axis.is_primary || busy || reorderBusy) return;
    if (pointerEvent.pointerType === 'mouse' && pointerEvent.button !== 0) return;
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    dragStartOrderRef.current = orderedAxesRef.current;
    dragSessionRef.current = {
      axisId: axis.id,
      pointerId: pointerEvent.pointerId,
      startX: pointerEvent.clientX,
      startY: pointerEvent.clientY,
      started: false,
    };
  };

  const moveDraggedAxis = (pointerEvent: ReactPointerEvent<HTMLDivElement>, axisId: number) => {
    const session = dragSessionRef.current;
    if (!session || session.axisId !== axisId || session.pointerId !== pointerEvent.pointerId) return;
    if (!session.started) {
      const distance = Math.hypot(pointerEvent.clientX - session.startX, pointerEvent.clientY - session.startY);
      if (distance < 6) return;
      session.started = true;
      setDraggingAxisId(axisId);
    }
    pointerEvent.preventDefault();
    const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)
      ?.closest<HTMLElement>('[data-axis-order-id]');
    const targetId = Number(target?.dataset.axisOrderId);
    if (!target || !Number.isInteger(targetId) || targetId === axisId) return;
    const placeAfter = pointerEvent.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
    applyAxisOrder(moveAxisAround(orderedAxesRef.current, axisId, targetId, placeAfter));
  };

  const finishAxisDrag = (pointerEvent: ReactPointerEvent<HTMLDivElement>, axisId: number) => {
    const session = dragSessionRef.current;
    if (!session || session.axisId !== axisId || session.pointerId !== pointerEvent.pointerId) return;
    if (pointerEvent.currentTarget.hasPointerCapture(pointerEvent.pointerId)) {
      pointerEvent.currentTarget.releasePointerCapture(pointerEvent.pointerId);
    }
    dragSessionRef.current = null;
    if (!session.started) {
      selectAxis(axisId);
      return;
    }
    pointerEvent.preventDefault();
    suppressAxisSelectionRef.current = axisId;
    window.setTimeout(() => {
      if (suppressAxisSelectionRef.current === axisId) suppressAxisSelectionRef.current = null;
    }, 0);
    setDraggingAxisId(null);
    void commitAxisOrder(orderedAxesRef.current);
  };

  const cancelAxisDrag = (pointerEvent: ReactPointerEvent<HTMLDivElement>, axisId: number) => {
    const session = dragSessionRef.current;
    if (!session || session.axisId !== axisId || session.pointerId !== pointerEvent.pointerId) return;
    if (pointerEvent.currentTarget.hasPointerCapture(pointerEvent.pointerId)) {
      pointerEvent.currentTarget.releasePointerCapture(pointerEvent.pointerId);
    }
    dragSessionRef.current = null;
    if (session.started) applyAxisOrder(dragStartOrderRef.current);
    setDraggingAxisId(null);
  };

  const moveAxisWithKeyboard = (keyboardEvent: ReactKeyboardEvent<HTMLButtonElement>, axis: TimelineAxis) => {
    if (axis.is_primary || busy || reorderBusy) return;
    if (keyboardEvent.key !== 'ArrowUp' && keyboardEvent.key !== 'ArrowDown') return;
    keyboardEvent.preventDefault();
    const next = moveAxisBy(orderedAxesRef.current, axis.id, keyboardEvent.key === 'ArrowUp' ? -1 : 1);
    if (next === orderedAxesRef.current) return;
    applyAxisOrder(next);
    void commitAxisOrder(next);
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setLocalError('');
    try {
      const uploaded: TimelineMedia[] = [];
      for (const file of Array.from(files)) {
        setUploadProgress(0);
        const media = await onUpload(file, setUploadProgress);
        uploaded.push(media);
      }
      setEventDraft((current) => {
        const media = [...current.media, ...uploaded];
        return {
          ...current,
          media,
          cover_media_key: normalizeCoverMediaKey(media, current.cover_media_key),
        };
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '媒体上传失败');
    } finally {
      setUploadProgress(null);
    }
  };

  const saveEvent = async () => {
    setLocalError('');
    if (!eventDraft.title.trim()) {
      setLocalError('请写下标题');
      return;
    }
    if (eventDraft.axis_ids.length === 0) {
      setLocalError('至少选择一条轴');
      return;
    }
    await onSaveEvent(
      {
        ...eventDraft,
        title: eventDraft.title.trim(),
        subtitle: eventDraft.subtitle.trim(),
        description: eventDraft.description.trim(),
        color: eventDraft.color.trim(),
        cover_media_key: normalizeCoverMediaKey(eventDraft.media, eventDraft.cover_media_key),
      },
      event?.id ?? null,
    );
  };

  const saveAxis = async () => {
    setLocalError('');
    if (!axisDraft.name.trim()) {
      setLocalError('请为轴命名');
      return;
    }
    if (axisDraft.parent_axis_id && axisDraft.parent_axis_id === editingAxisId) {
      setLocalError('轴不能从自己分支');
      return;
    }
    const normalizedDraft = editingAxis?.is_primary
      ? {
          ...axisDraft,
          name: axisDraft.name.trim(),
          parent_axis_id: null,
          start_date: '',
          end_date: '',
          merge_axis_id: null,
        }
      : { ...axisDraft, name: axisDraft.name.trim() };
    await onSaveAxis(normalizedDraft, editingAxisId);
    setEditingAxisId(null);
    setAxisDraft(emptyAxis(axes.length + 1));
  };

  return (
    <div ref={rootRef} className="edit-backdrop" role="presentation" onMouseDown={(mouseEvent) => mouseEvent.target === mouseEvent.currentTarget && onClose()}>
      <section className="edit-sheet" role="dialog" aria-modal="true" aria-label={kind === 'event' ? '编辑时间轴事件' : '管理叙事轴'}>
        <header data-form-part>
          <div>
            <span>{kind === 'event' ? 'write on paper' : 'weave the lines'}</span>
            <h2>{kind === 'event' ? (event ? '修改这一页' : '记下这一刻') : '管理叙事轴'}</h2>
          </div>
          <button type="button" className="detail-close" onClick={onClose} aria-label="关闭">×</button>
        </header>

        {kind === 'event' ? (
          <form onSubmit={(formEvent) => { formEvent.preventDefault(); void saveEvent(); }}>
            <div className="form-grid" data-form-part>
              <label>
                <span>版式</span>
                <select value={eventDraft.type} onChange={(changeEvent) => updateEvent('type', changeEvent.target.value as EventDraft['type'])}>
                  <option value="entry">普通记录</option>
                  <option value="milestone">里程碑</option>
                </select>
              </label>
              <label>
                <span>日期</span>
                <input type="date" required value={eventDraft.event_date} onChange={(changeEvent) => updateEvent('event_date', changeEvent.target.value)} />
              </label>
            </div>
            <label data-form-part>
              <span>标题</span>
              <input maxLength={120} required value={eventDraft.title} onChange={(changeEvent) => updateEvent('title', changeEvent.target.value)} placeholder="这一页发生了什么" />
            </label>
            <label data-form-part>
              <span>副标题 <small>里程碑最适合写一句</small></span>
              <input maxLength={180} value={eventDraft.subtitle} onChange={(changeEvent) => updateEvent('subtitle', changeEvent.target.value)} placeholder="可留空" />
            </label>
            <label data-form-part>
              <span>正文</span>
              <textarea rows={7} maxLength={8000} value={eventDraft.description} onChange={(changeEvent) => updateEvent('description', changeEvent.target.value)} placeholder="像写日记一样，不必很完整。" />
            </label>
            <p className="content-composition" data-form-part>
              <span>内容构成</span>
              <strong>{describeEventContent(eventDraft)}</strong>
            </p>
            <fieldset data-form-part>
              <legend>挂在哪些轴上</legend>
              <div className="axis-checks">
                {axes.map((axis) => (
                  <label key={axis.id} style={{ '--chip-color': axis.color } as React.CSSProperties}>
                    <input
                      type="checkbox"
                      checked={eventDraft.axis_ids.includes(axis.id)}
                      onChange={() => updateEvent(
                        'axis_ids',
                        eventDraft.axis_ids.includes(axis.id)
                          ? eventDraft.axis_ids.filter((axisId) => axisId !== axis.id)
                          : [...eventDraft.axis_ids, axis.id],
                      )}
                    />
                    <span>{axis.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-grid" data-form-part>
              <label>
                <span>节点自定义颜色 <small>可留空</small></span>
                <input type="color" value={eventDraft.color || '#9d6c7b'} onChange={(changeEvent) => updateEvent('color', changeEvent.target.value)} />
              </label>
              <label className="upload-label">
                <span>照片 / MP4</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm" multiple onChange={(changeEvent) => { void uploadFiles(changeEvent.target.files); changeEvent.target.value = ''; }} />
                <strong>{uploadProgress === null ? '选择文件' : `上传 ${Math.round(uploadProgress * 100)}%`}</strong>
              </label>
            </div>
            {eventDraft.media.length > 0 && (
              <div className="media-editor" data-form-part>
                {eventDraft.media.map((media, index) => (
                  <div key={media.key} className={eventDraft.cover_media_key === media.key ? 'is-cover' : ''}>
                    <div className="media-editor-preview">
                      {media.type === 'image' ? <img src={media.url} alt="" /> : <video src={`${media.url}#t=0.1`} muted preload="metadata" />}
                      {eventDraft.cover_media_key === media.key && <span>封面</span>}
                    </div>
                    <input
                      value={media.caption}
                      maxLength={180}
                      placeholder="caption"
                      onChange={(changeEvent) => setEventDraft((current) => ({
                        ...current,
                        media: current.media.map((item, mediaIndex) => mediaIndex === index ? { ...item, caption: changeEvent.target.value } : item),
                      }))}
                    />
                    <div className="media-editor-actions">
                      <button
                        type="button"
                        aria-pressed={eventDraft.cover_media_key === media.key}
                        onClick={() => updateEvent('cover_media_key', media.key)}
                      >
                        {eventDraft.cover_media_key === media.key ? '当前封面' : '设为封面'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEventDraft((current) => {
                          const nextMedia = current.media.filter((_, mediaIndex) => mediaIndex !== index);
                          return {
                            ...current,
                            media: nextMedia,
                            cover_media_key: normalizeCoverMediaKey(nextMedia, current.cover_media_key),
                          };
                        })}
                      >移除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {localError && <div className="form-error" role="alert" data-form-part>{localError}</div>}
            <footer data-form-part>
              <button type="button" className="paper-button" onClick={onClose}>取消</button>
              <button type="submit" className="paper-button paper-button--primary" disabled={busy || uploadProgress !== null}>{busy ? '正在保存…' : '写到纸上'}</button>
            </footer>
          </form>
        ) : (
          <div className="axis-manager">
            <div className="axis-list" data-form-part>
              <p className="axis-order-note">按住次轴任意位置拖动；从上到下对应纸面从左到右，拖过“我们”即可换边。</p>
              <div className="axis-order-list" role="list" aria-label="叙事轴画面顺序">
                {orderedAxes.map((axis) => (
                  <div
                    role="listitem"
                    key={axis.id}
                    data-axis-order-id={axis.id}
                    className={`axis-order-item${editingAxisId === axis.id ? ' is-active' : ''}${axis.is_primary ? ' is-primary' : ''}${draggingAxisId === axis.id ? ' is-dragging' : ''}`}
                    style={{ '--axis-color': axis.color } as React.CSSProperties}
                    onPointerDown={(pointerEvent) => beginAxisDrag(pointerEvent, axis)}
                    onPointerMove={(pointerEvent) => moveDraggedAxis(pointerEvent, axis.id)}
                    onPointerUp={(pointerEvent) => finishAxisDrag(pointerEvent, axis.id)}
                    onPointerCancel={(pointerEvent) => cancelAxisDrag(pointerEvent, axis.id)}
                  >
                    <button type="button" className="axis-select" onClick={() => selectAxis(axis.id)}>
                      <span className="axis-swatch" style={{ background: axis.color }} />
                      <strong>{axis.name}</strong>
                      <small>{axis.is_primary ? '主轴 · 固定居中' : axis.parent_axis_id ? '支线' : '叙事轴'}</small>
                    </button>
                    {axis.is_primary ? (
                      <span className="axis-primary-badge" aria-label="主轴固定在画面中央">中心</span>
                    ) : (
                      <button
                        type="button"
                        className="axis-drag-handle"
                        aria-label={`拖动“${axis.name}”调整画面顺序`}
                        title="拖动排序；也可用上下方向键"
                        disabled={busy || reorderBusy}
                        onKeyDown={(keyboardEvent) => moveAxisWithKeyboard(keyboardEvent, axis)}
                      >
                        拖
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className={`axis-create-button${editingAxisId === null ? ' is-active' : ''}`} onClick={() => setEditingAxisId(null)}>＋ 新建一条轴</button>
            </div>
            <form onSubmit={(formEvent) => { formEvent.preventDefault(); void saveAxis(); }}>
              <label data-form-part>
                <span>轴名称</span>
                <input maxLength={40} required value={axisDraft.name} onChange={(changeEvent) => updateAxis('name', changeEvent.target.value)} />
              </label>
              <label data-form-part>
                <span>蜡笔颜色</span>
                <input type="color" value={axisDraft.color} onChange={(changeEvent) => updateAxis('color', changeEvent.target.value)} />
              </label>
              {editingAxis?.is_primary ? (
                <p className="primary-axis-rule" data-form-part>“我们”贯穿整张纸，固定在画面中央，不设置分支来源、出现或结束日期。</p>
              ) : (
                <>
                  <label data-form-part>
                    <span>从哪条轴分出</span>
                    <select value={axisDraft.parent_axis_id ?? ''} onChange={(changeEvent) => updateAxis('parent_axis_id', changeEvent.target.value ? Number(changeEvent.target.value) : null)}>
                      <option value="">独立叙事轴</option>
                      {axes.filter((axis) => axis.id !== editingAxisId).map((axis) => <option key={axis.id} value={axis.id}>{axis.name}</option>)}
                    </select>
                  </label>
                  <div className="form-grid" data-form-part>
                    <label>
                      <span>出现日期</span>
                      <input type="date" value={axisDraft.start_date} onChange={(changeEvent) => updateAxis('start_date', changeEvent.target.value)} />
                    </label>
                    <label>
                      <span>结束日期</span>
                      <input type="date" value={axisDraft.end_date} onChange={(changeEvent) => updateAxis('end_date', changeEvent.target.value)} />
                    </label>
                  </div>
                  <label data-form-part>
                    <span>结束后合流到</span>
                    <select value={axisDraft.merge_axis_id ?? ''} onChange={(changeEvent) => updateAxis('merge_axis_id', changeEvent.target.value ? Number(changeEvent.target.value) : null)}>
                      <option value="">自然消失</option>
                      {axes.filter((axis) => axis.id !== editingAxisId).map((axis) => <option key={axis.id} value={axis.id}>{axis.name}</option>)}
                    </select>
                  </label>
                </>
              )}
              {localError && <div className="form-error" role="alert" data-form-part>{localError}</div>}
              <footer data-form-part>
                {editingAxis && !editingAxis.is_primary && <button type="button" className="paper-button paper-button--danger" disabled={busy} onClick={() => void onDeleteAxis(editingAxis)}>删除</button>}
                <span />
                <button type="submit" className="paper-button paper-button--primary" disabled={busy}>{busy ? '正在保存…' : editingAxis ? '保存轴' : '创建轴'}</button>
              </footer>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
