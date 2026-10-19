import type { FrameMetrics, PipelineClaim, StillMode } from "./image.ts";

export type ShotMode = StillMode | "video";

export type ShotRecord = {
  id: string;
  created: number;
  mode: ShotMode;
  width: number;
  height: number;
  notes: string[];
  before: FrameMetrics | null;
  after: FrameMetrics | null;
  processingMs: number;
  source: "camera" | "chart";
  original: Blob;
  processed: Blob;
  thumb: Blob;
  claimed: PipelineClaim | null;
};

const DB_NAME = "naturalcam-ultra";
const STORE = "shots";
const MAX_SHOTS = 40;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the photo library."));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Photo library write failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Photo library write aborted."));
  });
}

export async function saveShot(shot: ShotRecord): Promise<void> {
  const db = await openDb();
  const existing = await listShots();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  store.put(shot);
  const overflow = existing
    .sort((a, b) => a.created - b.created)
    .slice(0, Math.max(0, existing.length + 1 - MAX_SHOTS));
  for (const old of overflow) {
    if (old.id !== shot.id) store.delete(old.id);
  }
  await txDone(tx);
  db.close();
}

export async function listShots(): Promise<ShotRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).getAll();
  const rows = await new Promise<ShotRecord[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as ShotRecord[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error("Could not read the photo library."));
  });
  db.close();
  return rows.sort((a, b) => b.created - a.created);
}

export async function deleteShot(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
  db.close();
}
