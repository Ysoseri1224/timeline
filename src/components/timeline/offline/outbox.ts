// Outbox: every event edit is first committed to IndexedDB here, then sent by sync.ts.
// The page always shows server snapshot + pending ops (see applyOutbox).
import type { EventDraft, TimelineAxis, TimelineEvent, TimelineMedia } from '../types';
import { getAll, idbResult, kvGet, kvSet, transact } from './db';

export type OpKind = 'create' | 'update' | 'delete';
export type ConflictType = 'edit-edit' | 'edit-deleted' | 'delete-edited' | 'axis-missing' | 'rejected';

export interface Conflict {
  type: ConflictType;
  remote: TimelineEvent | null;
  message?: string;
  detectedAt: number;
}

export interface OutboxOp {
  id: string; // also the Idempotency-Key
  seq: number;
  kind: OpKind;
  targetId: number; // negative = created offline, not yet on the server
  base: TimelineEvent | null; // server version this edit was based on
  chained: boolean; // base will come from the previous op on the same target
  draft: EventDraft | null;
  attempts: number; // >0: may have reached the server, so never merge into it again
  createdAt: number;
  updatedAt: number;
  conflict: Conflict | null;
  lastError?: string;
}

export interface LocalBlob {
  key: string; // local:<uuid>
  uuid: string;
  blob: Blob;
  type: string;
  name: string;
  size: number;
  uploaded?: TimelineMedia;
}

export interface Snapshot {
  axes: TimelineAxis[];
  events: TimelineEvent[];
  savedAt: number;
}

export type DisplayEvent = TimelineEvent & { pending?: OpKind };

export const LOCAL_PREFIX = 'local:';
export const isLocalKey = (key: string) => key.startsWith(LOCAL_PREFIX);
export const localUrl = (uuid: string) => `/timeline/__local/${uuid}`;

export const uuid = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
      (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(c) / 4)))).toString(16));

export const loadSnapshot = () => kvGet<Snapshot>('snapshot');
export const saveSnapshot = (axes: TimelineAxis[], events: TimelineEvent[]) =>
  kvSet('snapshot', { axes, events, savedAt: Date.now() } satisfies Snapshot);

export async function loadOps(): Promise<OutboxOp[]> {
  const ops = await getAll<OutboxOp>('ops');
  return ops.sort((a, b) => a.seq - b.seq);
}

export const draftToEvent = (id: number, draft: EventDraft, base?: TimelineEvent | null): TimelineEvent => ({
  ...(base || {}),
  id,
  type: draft.type,
  title: draft.title,
  subtitle: draft.subtitle || null,
  description: draft.description || null,
  event_date: draft.event_date,
  color: draft.color || null,
  media: draft.media,
  cover_media_key: draft.cover_media_key,
  axis_ids: draft.axis_ids,
});

export const eventToDraft = (event: TimelineEvent): EventDraft => ({
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

/** Server snapshot with pending ops laid over it. */
export function applyOutbox(events: TimelineEvent[], ops: OutboxOp[]): DisplayEvent[] {
  const map = new Map<number, DisplayEvent>(events.map((event) => [event.id, event]));
  const idMap = new Map<number, number>();
  for (const op of ops) {
    const id = idMap.get(op.targetId) ?? op.targetId;
    if (op.kind === 'create' && op.draft) {
      map.set(id, { ...draftToEvent(id, op.draft), pending: 'create' });
    } else if (op.kind === 'update' && op.draft) {
      const previous = map.get(id);
      map.set(id, { ...draftToEvent(id, op.draft, previous), pending: previous?.pending === 'create' ? 'create' : 'update' });
    } else if (op.kind === 'delete') {
      map.delete(id);
    }
  }
  return [...map.values()];
}

let seqCounter = 0;
const nextSeq = () => Date.now() * 1000 + (seqCounter++ % 1000);

/**
 * Records one edit. `current` is the event as displayed (may already include pending edits);
 * `serverVersion` is the same event in the last server snapshot (null if never synced).
 * Resolves after the IndexedDB transaction has committed.
 */
export async function enqueue(kind: OpKind, current: TimelineEvent | null, serverVersion: TimelineEvent | null, draft: EventDraft | null): Promise<number> {
  const now = Date.now();
  return transact(['ops', 'blobs'], 'readwrite', async (tx) => {
    const store = tx.objectStore('ops');
    const ops = ((await idbResult(store.getAll())) as OutboxOp[]).sort((a, b) => a.seq - b.seq);
    const fresh = (patch: Partial<OutboxOp>): OutboxOp => ({
      id: uuid(), seq: nextSeq(), kind, targetId: 0, base: null, chained: false, draft,
      attempts: 0, createdAt: now, updatedAt: now, conflict: null, ...patch,
    });

    if (kind === 'create') {
      const targetId = -now;
      store.put(fresh({ targetId }));
      return targetId;
    }

    const targetId = current!.id;
    const onTarget = ops.filter((op) => op.targetId === targetId);
    const last = onTarget[onTarget.length - 1];
    const mergeable = last && last.attempts === 0 && !last.conflict;

    if (kind === 'update') {
      if (mergeable && (last.kind === 'create' || last.kind === 'update')) {
        store.put({ ...last, draft, updatedAt: now });
      } else {
        store.put(fresh({ targetId, base: onTarget.length ? null : serverVersion, chained: onTarget.length > 0 }));
      }
      return targetId;
    }

    // delete
    if (mergeable && last.kind === 'create' && onTarget.length === 1) {
      store.delete(last.id); // never reached the server: just forget it
    } else if (mergeable && last.kind === 'update') {
      store.put({ ...last, kind: 'delete', draft: null, updatedAt: now });
    } else {
      store.put(fresh({ targetId, base: onTarget.length ? null : serverVersion, chained: onTarget.length > 0 }));
    }
    return targetId;
  });
}

/** Saves a picked image locally; returns a media entry that the service worker can display. */
export async function storeLocalImage(file: File): Promise<TimelineMedia> {
  const id = uuid();
  const record: LocalBlob = { key: LOCAL_PREFIX + id, uuid: id, blob: file, type: file.type || 'image/jpeg', name: file.name, size: file.size };
  await transact(['blobs'], 'readwrite', (tx) => { tx.objectStore('blobs').put(record); });
  return { key: record.key, url: localUrl(id), type: 'image', caption: '', name: file.name };
}

/** Deletes local images that no pending op refers to any more. */
export async function gcBlobs(): Promise<void> {
  await transact(['ops', 'blobs'], 'readwrite', async (tx) => {
    const ops = (await idbResult(tx.objectStore('ops').getAll())) as OutboxOp[];
    const used = new Set(ops.flatMap((op) => op.draft?.media.map((m) => m.key) ?? []));
    const keys = (await idbResult(tx.objectStore('blobs').getAllKeys())) as string[];
    for (const key of keys) if (!used.has(key)) tx.objectStore('blobs').delete(key);
  });
}

export const opLabel = (op: OutboxOp): string => {
  const title = op.draft?.title || op.base?.title || op.conflict?.remote?.title || '（无标题）';
  return `${op.kind === 'create' ? '新建' : op.kind === 'update' ? '修改' : '删除'} · ${title}`;
};
