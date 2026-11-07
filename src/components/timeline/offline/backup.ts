// Export / import of unsynced changes (text + local images) as one JSON file.
import { getAll, kvGet, kvSet, putOne } from './db';
import { loadOps } from './outbox';
import type { LocalBlob, OutboxOp } from './outbox';

interface BackupFile {
  app: 'timeline-offline';
  version: 1;
  exportedAt: string;
  ops: OutboxOp[];
  idMap: Record<string, number>;
  blobs: Array<Omit<LocalBlob, 'blob'> & { data: string }>;
}

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const fromBase64 = (data: string, type: string) => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
};

export async function exportBackup(): Promise<{ file: File; ops: number; images: number }> {
  const ops = await loadOps();
  const used = new Set(ops.flatMap((op) => op.draft?.media.map((m) => m.key) ?? []));
  const blobs = (await getAll<LocalBlob>('blobs')).filter((b) => used.has(b.key));
  const body: BackupFile = {
    app: 'timeline-offline',
    version: 1,
    exportedAt: new Date().toISOString(),
    ops,
    idMap: (await kvGet<Record<string, number>>('idMap')) || {},
    blobs: await Promise.all(blobs.map(async ({ blob, ...rest }) => ({ ...rest, data: await toBase64(blob) }))),
  };
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const file = new File([JSON.stringify(body)], `timeline-offline-${stamp}.json`, { type: 'application/json' });
  return { file, ops: ops.length, images: blobs.length };
}

/** Share sheet on phones (save to Files), plain download elsewhere. */
export async function deliverFile(file: File): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Adds ops from a backup that this device does not have yet. Returns how many were added. */
export async function importBackup(file: File): Promise<number> {
  const body = JSON.parse(await file.text()) as BackupFile;
  if (body.app !== 'timeline-offline' || body.version !== 1 || !Array.isArray(body.ops)) {
    throw new Error('这不是时间轴的离线备份文件');
  }
  const existing = new Set((await loadOps()).map((op) => op.id));
  let added = 0;
  for (const b of body.blobs) {
    const { data, ...rest } = b;
    await putOne('blobs', { ...rest, blob: fromBase64(data, rest.type) });
  }
  for (const op of body.ops) {
    if (existing.has(op.id)) continue;
    await putOne('ops', op);
    added += 1;
  }
  const idMap = (await kvGet<Record<string, number>>('idMap')) || {};
  await kvSet('idMap', { ...body.idMap, ...idMap });
  return added;
}
