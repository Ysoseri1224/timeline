import { useEffect, useRef, useState } from 'react';
import type { EventDraft, TimelineAxis, TimelineEvent } from './types';
import { eventToDraft, opLabel } from './offline/outbox';
import type { OutboxOp } from './offline/outbox';
import { formatBytes, isStandalone } from './offline/prepare';
import type { PrepareReport } from './offline/prepare';
import type { Resolution, SyncProgress } from './offline/sync';

export type NetState = 'online' | 'offline' | 'unknown';

export interface OfflineState {
  net: NetState;
  ops: OutboxOp[];
  syncing: SyncProgress | null;
  authExpired: boolean;
  snapshotAt: number | null;
  swUpdated: boolean;
}

const time = (ms: number | null) => (ms ? new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(ms)) : '—');

const pendingOf = (s: OfflineState) => s.ops.filter((op) => !op.conflict).length;
const conflictsOf = (s: OfflineState) => s.ops.filter((op) => op.conflict).length;

/** Thin bar at the top; hidden when online with nothing pending. */
export function OfflineBar({ state, onOpen }: { state: OfflineState; onOpen: () => void }) {
  const pending = pendingOf(state);
  const conflicts = conflictsOf(state);
  let tone = 'quiet';
  let text = '';
  if (conflicts > 0) { tone = 'warn'; text = `${conflicts} 条需要你选择保留哪个版本`; }
  else if (state.authExpired && pending > 0) { tone = 'warn'; text = `登录已过期，重新登录后同步 ${pending} 条改动`; }
  else if (state.syncing) { text = `同步中 ${state.syncing.done}/${state.syncing.total}${state.syncing.label ? ` · ${state.syncing.label}` : ''}`; }
  else if (state.net === 'offline' && !state.snapshotAt && pending === 0) { return null; } // the page itself explains
  else if (state.net === 'offline') {
    text = pending > 0 ? `离线 · ${pending} 条改动保存在本机` : `离线 · 显示的是 ${time(state.snapshotAt)} 保存的内容`;
  } else if (pending > 0) { text = `${pending} 条改动待同步`; }
  if (!text) return null;
  return (
    <button type="button" className={`offline-bar offline-bar--${tone}`} onClick={onOpen} aria-live="polite">
      <span className="offline-bar__dot" />{text}<span className="offline-bar__more">详情</span>
    </button>
  );
}

/** Small toolbar entry, so the panel is reachable when the bar is hidden. */
export function OfflineButton({ state, onOpen }: { state: OfflineState; onOpen: () => void }) {
  const pending = pendingOf(state) + conflictsOf(state);
  return (
    <button type="button" className="offline-toolbar-button" onClick={onOpen} aria-label="离线与同步" title="离线与同步">
      {state.net === 'offline' ? '☁︎ 离线' : '☁︎'}{pending > 0 && <span className="offline-badge">{pending}</span>}
    </button>
  );
}

interface PanelProps {
  state: OfflineState;
  editor: boolean;
  report: PrepareReport | null;
  storage: { usage: number; quota: number } | null;
  preparing: { label: string; done: number; total: number } | null;
  onClose: () => void;
  onSync: () => void;
  onPrepare: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onLogin: () => void;
  onOpenConflict: (op: OutboxOp) => void;
}

export function OfflinePanel({
  state, editor, report, storage, preparing, onClose, onSync, onPrepare, onExport, onImport, onLogin, onOpenConflict,
}: PanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = pendingOf(state);
  const standalone = isStandalone();
  const tokenDays = report?.tokenExp ? Math.floor((report.tokenExp * 1000 - Date.now()) / 86_400_000) : null;
  return (
    <div className="offline-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="offline-sheet" role="dialog" aria-modal="true" aria-label="离线与同步">
        <header>
          <div><span>offline</span><h2>离线与同步</h2></div>
          <button type="button" className="detail-close" onClick={onClose} aria-label="关闭">×</button>
        </header>

        {state.swUpdated && (
          <div className="offline-callout">
            页面有新版本。<button type="button" className="paper-button" onClick={() => window.location.reload()}>刷新</button>
          </div>
        )}

        <h3>同步</h3>
        <dl className="offline-facts">
          <dt>网络</dt><dd>{state.net === 'offline' ? '离线（改动先存在本机）' : state.net === 'online' ? '在线' : '检测中'}</dd>
          <dt>线上数据</dt><dd>{time(state.snapshotAt)} 取得</dd>
          <dt>待同步</dt><dd>{pending} 条{conflictsOf(state) > 0 && `，${conflictsOf(state)} 条需要选择`}</dd>
        </dl>
        {state.authExpired && (
          <div className="offline-callout offline-callout--warn">
            登录已过期，改动都还在本机。<button type="button" className="paper-button" onClick={onLogin}>重新登录</button>
          </div>
        )}
        {state.ops.length > 0 && (
          <ul className="offline-ops">
            {state.ops.map((op) => (
              <li key={op.id} className={op.conflict ? 'is-conflict' : ''}>
                <span>{opLabel(op)}</span>
                {op.conflict
                  ? <button type="button" className="paper-button" onClick={() => onOpenConflict(op)}>选择</button>
                  : <small>{op.attempts > 0 ? '发送中断，待重试' : '待发送'}</small>}
              </li>
            ))}
          </ul>
        )}
        <div className="offline-actions">
          <button type="button" className="paper-button paper-button--primary" disabled={!pending || Boolean(state.syncing)} onClick={onSync}>
            {state.syncing ? '同步中…' : '立即同步'}
          </button>
        </div>

        <h3>离线准备</h3>
        <p className="offline-note">登机前在有网的地方点一次：下载全部记录、图片和字体，并申请长期保存。视频不离线，落地后再看。</p>
        <div className="offline-actions">
          <button type="button" className="paper-button paper-button--primary" disabled={Boolean(preparing) || state.net === 'offline'} onClick={onPrepare}>
            {preparing ? `${preparing.label} ${preparing.total > 1 ? `${preparing.done}/${preparing.total}` : '…'}` : '开始离线准备'}
          </button>
        </div>
        {report && (
          <dl className="offline-facts">
            <dt>完成于</dt><dd>{time(report.at)}</dd>
            <dt>记录</dt><dd>{report.events} 条</dd>
            <dt>图片</dt><dd>{report.images.cached}/{report.images.total} 张，{formatBytes(report.images.bytes)}{report.images.failed > 0 && <b>，{report.images.failed} 张失败，请再点一次</b>}</dd>
            <dt>字体</dt><dd>{report.fonts.failed > 0 && report.fonts.files === 0 ? <b>下载失败（离线时用系统字体）</b> : `${report.fonts.files} 个文件，${formatBytes(report.fonts.bytes)}`}</dd>
            {report.videos > 0 && <><dt>视频</dt><dd>{report.videos} 个，不离线</dd></>}
            <dt>长期保存</dt><dd>{report.persisted ? '已获准' : standalone ? '未获准（主屏幕 App 通常不受影响）' : <b>未获准</b>}</dd>
            <dt>登录</dt><dd>{!editor ? '未登录（离线时只能看，不能改）' : tokenDays === null ? '—' : tokenDays < 3 ? <b>{tokenDays} 天后过期，请退出后重新登录</b> : `还剩 ${tokenDays} 天`}</dd>
            <dt>打开方式</dt><dd>{standalone ? '主屏幕 App' : <b>浏览器标签页</b>}</dd>
          </dl>
        )}
        {!standalone && (
          <p className="offline-note offline-note--warn">
            iPhone 建议：Safari 点「分享 → 添加到主屏幕」，之后都从主屏幕图标打开，并在那里重新登录、做离线准备。主屏幕 App 和 Safari 的数据是分开的。
          </p>
        )}
        {storage && <p className="offline-note">本机已用 {formatBytes(storage.usage)}{storage.quota ? `，可用约 ${formatBytes(storage.quota)}` : ''}</p>}

        <h3>备份</h3>
        <p className="offline-note">把还没同步的改动（含图片）存成一个文件，存到「文件」App。万一本机数据丢失，可以导入恢复。</p>
        <div className="offline-actions">
          <button type="button" className="paper-button" disabled={state.ops.length === 0} onClick={onExport}>导出未同步改动</button>
          <button type="button" className="paper-button" onClick={() => fileRef.current?.click()}>导入备份</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
        </div>
      </section>
    </div>
  );
}

// ---------- conflicts ----------

type Row = { label: string; mine: string; theirs: string };

const describe = (draft: EventDraft | null, axes: TimelineAxis[]) => {
  if (!draft) return null;
  const axisName = (id: number) => axes.find((a) => a.id === id)?.name ?? `轴 #${id}`;
  return {
    标题: draft.title,
    副标题: draft.subtitle,
    日期: draft.event_date,
    版式: draft.type === 'milestone' ? '里程碑' : '普通记录',
    正文: draft.description,
    轴: draft.axis_ids.map(axisName).join('、'),
    图片: `${draft.media.filter((m) => m.type === 'image').length} 张${draft.media.some((m) => m.type === 'video') ? ` + ${draft.media.filter((m) => m.type === 'video').length} 个视频` : ''}`,
    图片说明: draft.media.map((m) => m.caption).filter(Boolean).join(' / '),
    颜色: draft.color || '默认',
  } as Record<string, string>;
};

function Thumbs({ draft }: { draft: EventDraft | null }) {
  const images = draft?.media.filter((m) => m.type === 'image') ?? [];
  if (!images.length) return null;
  return <div className="conflict-thumbs">{images.slice(0, 6).map((m) => <img key={m.key} src={m.url} alt="" />)}</div>;
}

export function ConflictDialog({ op, axes, onResolve, onClose }: {
  op: OutboxOp;
  axes: TimelineAxis[];
  onResolve: (op: OutboxOp, choice: Resolution, axisIds?: number[]) => void;
  onClose: () => void;
}) {
  const conflict = op.conflict!;
  const remoteDraft = conflict.remote ? eventToDraft(conflict.remote as TimelineEvent) : null;
  const mine = describe(op.draft, axes);
  const theirs = describe(remoteDraft, axes);
  const [picked, setPicked] = useState<number[]>(() => axes.filter((a) => a.is_primary).map((a) => a.id));
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const rows: Row[] = Object.keys(mine || theirs || {}).map((label) => ({
    label, mine: mine?.[label] ?? '', theirs: theirs?.[label] ?? '',
  }));

  const intro: Record<string, string> = {
    'edit-edit': '你离线时改了这一条，同一条在线上也被改过。选一个保留：',
    'edit-deleted': '你离线时改了这一条，但它在线上已经被删除。',
    'delete-edited': '你离线时删除了这一条，但它在线上被改过（下面是线上的版本）。',
    'axis-missing': '这一条挂的轴在线上都被删除了，请重新选轴。',
    rejected: `服务器没有接受这一条：${conflict.message || '未知原因'}`,
  };

  return (
    <div className="offline-backdrop offline-backdrop--top" role="presentation">
      <section className="offline-sheet conflict-sheet" role="dialog" aria-modal="true" aria-label="选择保留的版本">
        <header>
          <div><span>conflict</span><h2>{op.draft?.title || conflict.remote?.title || '这一条'}</h2></div>
          <button type="button" className="detail-close" onClick={onClose} aria-label="稍后再说">×</button>
        </header>
        <p className="offline-note">{intro[conflict.type]}</p>

        {conflict.type === 'edit-edit' && (
          <table className="conflict-table">
            <thead><tr><th /><th>本机（离线时写的）</th><th>线上</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className={row.mine !== row.theirs ? 'is-diff' : ''}>
                  <th>{row.label}</th><td>{row.mine || '—'}</td><td>{row.theirs || '—'}</td>
                </tr>
              ))}
              <tr><th /><td><Thumbs draft={op.draft} /></td><td><Thumbs draft={remoteDraft} /></td></tr>
            </tbody>
          </table>
        )}
        {(conflict.type === 'edit-deleted' || conflict.type === 'axis-missing' || conflict.type === 'rejected') && mine && (
          <table className="conflict-table conflict-table--single">
            <tbody>
              {rows.map((row) => <tr key={row.label}><th>{row.label}</th><td>{row.mine || '—'}</td></tr>)}
              <tr><th /><td><Thumbs draft={op.draft} /></td></tr>
            </tbody>
          </table>
        )}
        {conflict.type === 'delete-edited' && theirs && (
          <table className="conflict-table conflict-table--single">
            <tbody>
              {rows.map((row) => <tr key={row.label}><th>{row.label}</th><td>{row.theirs || '—'}</td></tr>)}
              <tr><th /><td><Thumbs draft={remoteDraft} /></td></tr>
            </tbody>
          </table>
        )}
        {conflict.type === 'axis-missing' && (
          <div className="axis-checks">
            {axes.map((axis) => (
              <label key={axis.id} style={{ '--chip-color': axis.color } as React.CSSProperties}>
                <input type="checkbox" checked={picked.includes(axis.id)}
                  onChange={() => setPicked((p) => (p.includes(axis.id) ? p.filter((x) => x !== axis.id) : [...p, axis.id]))} />
                <span>{axis.name}</span>
              </label>
            ))}
          </div>
        )}

        <footer className="offline-actions">
          {conflict.type === 'edit-edit' && <>
            <button type="button" className="paper-button paper-button--primary" onClick={() => onResolve(op, 'mine')}>保留本机的</button>
            <button type="button" className="paper-button" onClick={() => onResolve(op, 'theirs')}>保留线上的</button>
            <button type="button" className="paper-button" onClick={() => onResolve(op, 'both')}>两条都留</button>
          </>}
          {conflict.type === 'edit-deleted' && <>
            <button type="button" className="paper-button paper-button--primary" onClick={() => onResolve(op, 'restore')}>恢复（按本机版本重新创建）</button>
            <button type="button" className="paper-button" onClick={() => onResolve(op, 'discard')}>放弃我的修改</button>
          </>}
          {conflict.type === 'delete-edited' && <>
            <button type="button" className="paper-button paper-button--danger" onClick={() => onResolve(op, 'delete')}>仍然删除</button>
            <button type="button" className="paper-button paper-button--primary" onClick={() => onResolve(op, 'keep')}>保留线上的</button>
          </>}
          {conflict.type === 'axis-missing' && <>
            <button type="button" className="paper-button paper-button--primary" disabled={!picked.length} onClick={() => onResolve(op, 'retry', picked)}>用所选的轴继续</button>
            <button type="button" className="paper-button" onClick={() => onResolve(op, 'discard')}>放弃这一条</button>
          </>}
          {conflict.type === 'rejected' && <>
            <button type="button" className="paper-button paper-button--primary" onClick={() => onResolve(op, 'retry')}>重试</button>
            <button type="button" className="paper-button" onClick={() => onResolve(op, 'discard')}>放弃这一条</button>
          </>}
        </footer>
      </section>
    </div>
  );
}
