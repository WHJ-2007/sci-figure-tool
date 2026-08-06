// 画布保存目标：File System Access API 目录句柄 + IndexedDB 持久化。
// 瞬时保存机制：画布任何修改自动写入所选目录下的 canvas-data.json（含全部画布，与 localStorage 同格式）。

const FILE_NAME = "canvas-data.json";
const HANDLE_KEY = "sci-figure.saveDir.v1";
const DB_NAME = "sci-figure";
const DB_STORE = "kv";

// 浏览器 File System Access API 类型（lib.dom 未完整声明，自行收窄）
interface SaveDirHandle {
  name: string;
  queryPermission(opts?: { mode: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  requestPermission(opts?: { mode: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }>;
}

// ---- IndexedDB key-value（句柄需 structured clone，localStorage 存不了对象）----
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export type SaveResult = "saved" | "unsupported" | "no-dir" | "denied" | "error";

export function isSaveDirSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

// 选择保存目录（必须由用户手势触发，如点击按钮）；返回目录名，取消或失败返回 null
export async function selectSaveDirectory(): Promise<string | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (opts?: { mode: string }) => Promise<SaveDirHandle> }).showDirectoryPicker;
  if (typeof picker !== "function") return null;
  try {
    const handle = await picker({ mode: "readwrite" });
    await idbSet(HANDLE_KEY, handle);
    return handle.name;
  } catch {
    return null; // 用户取消
  }
}

export async function getSaveDirectoryName(): Promise<string | null> {
  const handle = (await idbGet(HANDLE_KEY)) as SaveDirHandle | null;
  return handle ? handle.name : null;
}

export async function clearSaveDirectory(): Promise<void> {
  await idbSet(HANDLE_KEY, null);
}

// 恢复句柄后权限可能随浏览器重启失效：由用户手势触发（如「重新授权」按钮）补授权
export async function ensureSavePermission(): Promise<boolean> {
  const handle = (await idbGet(HANDLE_KEY)) as SaveDirHandle | null;
  if (!handle) return false;
  if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
  try {
    return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

// 瞬时保存：把全部画布快照写入所选目录（权限未授予时返回 "denied"，调用方可尝试重新授权）
export async function saveProjectsToFile(json: string): Promise<SaveResult> {
  try {
    const handle = (await idbGet(HANDLE_KEY)) as SaveDirHandle | null;
    if (!handle) return "no-dir";
    if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") return "denied";
    const file = await handle.getFileHandle(FILE_NAME, { create: true });
    const writable = await file.createWritable();
    await writable.write(json);
    await writable.close();
    return "saved";
  } catch {
    return "error";
  }
}
