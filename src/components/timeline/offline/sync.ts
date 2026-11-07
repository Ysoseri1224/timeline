// Sends the outbox to the server, one op at a time, in order.
// - every request carries Idempotency-Key = op.id, so a retry after a lost response is harmless
// - updates/deletes carry X-If-Updated-At; a 409 becomes a conflict for the user to decide
// - any network failure stops the run; nothing is removed until the server confirmed it
import { ApiError, apiFetch, fetchAllEvents, fetchAxes, isNetworkError, uploadMedia } from '../api';
import type { EventDraft, TimelineAxis, TimelineEvent, TimelineMedia } from '../types';
import { deleteOne, getOne, kvGet, kvSet, putOne } from './db';
import {
  eventToDraft, gcBlobs, isLocalKey, loadOps, LOCAL_PREFIX, localUrl, saveSnapshot, uuid,
} from './outbox';
import type { Conflict, LocalBlob, OutboxOp } from './outbox';

export const MEDIA_CACHE = 'timeline-media-v1';

export interface SyncProgress { done: number; total: number; label: string }
export type SyncOutcome =
  | { kind: 'idle' }
  | { kind: 'synced'; sent: number; conflicts: number; notes: string[] }
  | { kind: 'offline'; sent: number }
  | { kind: 'auth'; sent: number };

const sameContent = (remote: TimelineEvent, draft: EventDraft) => {
  const a = eventToDraft(remote);
  const media = (m: TimelineMedia[]) => JSON.stringify(m.map((x) => [x.key, x.caption]));
  return a.type === draft.type && a.title === draft.title && a.subtitle === draft.subtitle
    && a.description === draft.description && a.event_date === draft.event_date
    && (a.color || '') === (draft.color || '') && a.cover_media_key === draft.cover_media_key
    && media(a.media) === media(draft.media)
    && [...a.axis_ids].sort().join() === [...draft.axis_ids].sort().join();
};

const idMapGet = async () => (await kvGet<Record<string, number>>('idMap')) || {};

async function putInMediaCache(url: string, blob: Blob) {
  try {
    const cache = await caches.open(MEDIA_CACHE);
    await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }));
  } catch { /* cache is a convenience only */ }
}

/** Uploads local images of a draft (once each) and returns the draft with real media keys. */
async function uploadLocalMedia(draft: EventDraft, onLabel: (label: string) => void): Promise<EventDraft> {
  const media: TimelineMedia[] = [];
  let cover = draft.cover_media_key;
  const locals = draft.media.filter((m) => isLocalKey(m.key));
  let index = 0;
  for (const item of draft.media) {
    if (!isLocalKey(item.key)) { media.push(item); continue; }
    index += 1;
    const record = await getOne<LocalBlob>('blobs', item.key);
    if (!record) continue; // lost local image: drop it rather than block the sync
    let uploaded = record.uploaded;
    if (!uploaded) {
      onLabel(`上传图片 ${index}/${locals.length}`);
      uploaded = await uploadMedia(new File([record.blob], record.name, { type: record.type }), undefined, record.uuid);
      await putOne('blobs', { ...record, uploaded });
      await putInMediaCache(uploaded.url, record.blob);
    }
    media.push({ ...uploaded, caption: item.caption });
    if (cover === item.key) cover = uploaded.key;
  }
  return { ...draft, media, cover_media_key: cover };
}

const headers = (op: OutboxOp, base: TimelineEvent | null): Record<string, string> => ({
  'Idempotency-Key': op.id,
  ...(base?.updated_at ? { 'X-If-Updated-At': base.updated_at } : {}),
});

async function setConflict(op: OutboxOp, conflict: Omit<Conflict, 'detectedAt'>) {
  await putOne('ops', { ...op, conflict: { ...conflict, detectedAt: Date.now() } });
}

/** After an op succeeds, the next op on the same event bases itself on the server's answer. */
async function finishOp(op: OutboxOp, rest: OutboxOp[], resultEvent: TimelineEvent | null, realId: number) {
  const next = rest.find((o) => o.targetId === op.targetId || o.targetId === realId);
  if (next && next.chained) {
    const updated = { ...next, targetId: realId, base: resultEvent, chained: false };
    await putOne('ops', updated);
    Object.assign(next, updated);
  }
  await deleteOne('ops', op.id);
}

let running: Promise<SyncOutcome> | null = null;

export function runSync(onProgress: (p: SyncProgress) => void = () => {}): Promise<SyncOutcome> {
  if (!running) running = doSync(onProgress).finally(() => { running = null; });
  return running;
}

async function doSync(onProgress: (p: SyncProgress) => void): Promise<SyncOutcome> {
  let ops = await loadOps();
  const pendingCount = ops.filter((op) => !op.conflict).length;
  if (pendingCount === 0) return { kind: 'idle' };

  let sent = 0;
  const notes: string[] = [];
  let axes: TimelineAxis[];
  try {
    await apiFetch('/session', { authenticated: true });
    axes = await fetchAxes();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { kind: 'auth', sent };
    return { kind: 'offline', sent };
  }
  const axisIds = new Set(axes.map((a) => a.id));
  const idMap = await idMapGet();
  const blocked = new Set<number>(); // targets with an unresolved earlier op

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i]!;
    const rest = ops.slice(i + 1);
    const targetId = op.targetId < 0 ? (idMap[op.targetId] ?? op.targetId) : op.targetId;
    const label = (text: string) => onProgress({ done: sent, total: pendingCount, label: text });
    if (op.conflict || blocked.has(op.targetId) || blocked.has(targetId)) {
      blocked.add(op.targetId); blocked.add(targetId);
      continue;
    }
    if (op.kind !== 'create' && targetId < 0) { blocked.add(op.targetId); continue; } // its create is not done yet

    try {
      let draft = op.draft;
      if (draft) {
        const known = draft.axis_ids.filter((id) => axisIds.has(id));
        if (known.length === 0) {
          await setConflict(op, { type: 'axis-missing', remote: null });
          blocked.add(op.targetId);
          continue;
        }
        if (known.length < draft.axis_ids.length) notes.push(`「${draft.title}」挂的轴有的已被删除，已自动移除`);
        draft = { ...draft, axis_ids: known };
        draft = await uploadLocalMedia(draft, label);
      }
      label(op.kind === 'create' ? `新建「${draft?.title}」` : op.kind === 'update' ? `修改「${draft?.title}」` : '删除');
      await putOne('ops', { ...op, attempts: op.attempts + 1, draft: op.draft });

      if (op.kind === 'create') {
        const { event } = await apiFetch<{ event: TimelineEvent }>('/events', {
          method: 'POST', authenticated: true, body: JSON.stringify(draft), headers: headers(op, null),
        });
        idMap[op.targetId] = event.id;
        await kvSet('idMap', idMap);
        await finishOp(op, rest, event, event.id);
      } else if (op.kind === 'update') {
        try {
          const { event } = await apiFetch<{ event: TimelineEvent }>(`/events/${targetId}`, {
            method: 'PUT', authenticated: true, body: JSON.stringify(draft), headers: headers(op, op.base),
          });
          await finishOp(op, rest, event, targetId);
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          const remote = (error.payload?.current as TimelineEvent | undefined) ?? null;
          if (error.status === 409 && remote && draft && sameContent(remote, draft)) {
            await finishOp(op, rest, remote, targetId);
          } else if (error.status === 409) {
            await setConflict({ ...op, targetId, draft: draft ?? op.draft }, { type: 'edit-edit', remote });
            blocked.add(op.targetId); blocked.add(targetId);
            continue;
          } else if (error.status === 404) {
            await setConflict({ ...op, targetId, draft: draft ?? op.draft }, { type: 'edit-deleted', remote: null });
            blocked.add(op.targetId); blocked.add(targetId);
            continue;
          } else throw error;
        }
      } else {
        try {
          await apiFetch(`/events/${targetId}`, { method: 'DELETE', authenticated: true, headers: headers(op, op.base) });
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          if (error.status === 409) {
            await setConflict({ ...op, targetId }, { type: 'delete-edited', remote: (error.payload?.current as TimelineEvent) ?? null });
            blocked.add(op.targetId); blocked.add(targetId);
            continue;
          }
          if (error.status !== 404) throw error; // 404: already gone, which is what we wanted
        }
        await finishOp(op, rest, null, targetId);
      }
      sent += 1;
      onProgress({ done: sent, total: pendingCount, label: '' });
    } catch (error) {
      // no network, or the server hiccupped (5xx): keep the op and try again later
      if (isNetworkError(error) || (error instanceof ApiError && error.status >= 500)) return { kind: 'offline', sent };
      if (error instanceof ApiError && error.status === 401) return { kind: 'auth', sent };
      // the server refused this op (validation etc.): park it for the user, carry on with the rest
      await setConflict(op, { type: 'rejected', remote: null, message: error instanceof Error ? error.message : String(error) });
      blocked.add(op.targetId);
    }
  }

  await gcBlobs();
  try {
    const [freshAxes, freshEvents] = await Promise.all([fetchAxes(), fetchAllEvents()]);
    await saveSnapshot(freshAxes, freshEvents);
  } catch { /* the page reloads data anyway */ }
  ops = await loadOps();
  return { kind: 'synced', sent, conflicts: ops.filter((op) => op.conflict).length, notes };
}

// ---------- conflict resolution ----------

export type Resolution =
  | 'mine' | 'theirs' | 'both' // edit-edit
  | 'restore' | 'discard' // edit-deleted / any
  | 'delete' | 'keep' // delete-edited
  | 'retry'; // rejected

/** Turns cached images of a deleted event into local images so they can be uploaded again. */
async function rehostMedia(draft: EventDraft): Promise<EventDraft> {
  const media: TimelineMedia[] = [];
  let cover = draft.cover_media_key;
  for (const item of draft.media) {
    if (isLocalKey(item.key)) { media.push(item); continue; }
    const cached = item.type === 'image' ? await caches.match(item.url).catch(() => undefined) : undefined;
    if (!cached) continue;
    const blob = await cached.blob();
    const id = uuid();
    await putOne('blobs', { key: LOCAL_PREFIX + id, uuid: id, blob, type: blob.type, name: item.name || 'image', size: blob.size } satisfies LocalBlob);
    const local = { ...item, key: LOCAL_PREFIX + id, url: localUrl(id) };
    media.push(local);
    if (cover === item.key) cover = local.key;
  }
  return { ...draft, media, cover_media_key: media.some((m) => m.key === cover) ? cover : media[0]?.key ?? null };
}

export async function resolveConflict(op: OutboxOp, choice: Resolution, axisIds?: number[]): Promise<void> {
  const remote = op.conflict?.remote ?? null;
  const later = (await loadOps()).filter((o) => o.seq > op.seq && o.targetId === op.targetId);
  const clear = { conflict: null, attempts: 0, updatedAt: Date.now() };
  // the offline version becomes a new event; later offline edits follow it
  const asCreate = async (draft: EventDraft) => {
    const newTarget = -Date.now();
    await putOne('ops', { ...op, ...clear, id: uuid(), kind: 'create', targetId: newTarget, base: null, chained: false, draft });
    await deleteOne('ops', op.id);
    for (const o of later) await putOne('ops', { ...o, targetId: newTarget, chained: true, base: null });
  };
  const drop = async () => {
    await deleteOne('ops', op.id);
    if (op.kind === 'create') {
      for (const o of later) await deleteOne('ops', o.id); // the event will never exist
      return;
    }
    // later edits of this event now build on the online version
    const next = later[0];
    if (next) await putOne('ops', { ...next, chained: false, base: remote });
  };

  switch (choice) {
    case 'mine': // overwrite the online version with the offline one
    case 'delete':
      await putOne('ops', { ...op, ...clear, id: uuid(), base: remote, chained: false });
      await deleteOne('ops', op.id);
      break;
    case 'theirs':
    case 'keep':
    case 'discard':
      await drop();
      break;
    case 'both':
      if (op.draft) await asCreate(op.draft);
      break;
    case 'restore':
      if (op.draft) await asCreate(await rehostMedia(op.draft));
      break;
    case 'retry':
      if (op.conflict?.type === 'axis-missing' && axisIds?.length && op.draft) {
        await putOne('ops', { ...op, ...clear, draft: { ...op.draft, axis_ids: axisIds } });
      } else {
        await putOne('ops', { ...op, ...clear });
      }
      break;
  }
  await gcBlobs();
}
