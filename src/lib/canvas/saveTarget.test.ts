import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isSaveDirSupported,
  selectSaveDirectory,
  getSaveDirectoryName,
  clearSaveDirectory,
  ensureSavePermission,
  saveProjectsToFile,
} from "./saveTarget";

// 极简内存 IndexedDB：只支持本模块用到的 open/transaction(get/put)
class FakeIDB {
  private store = new Map<string, unknown>();
  private db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({
        get: (k: string) => {
          const req = { result: this.store.get(k) } as unknown as IDBRequest;
          setTimeout(() => req.onsuccess?.({} as Event), 0);
          return req;
        },
        put: (v: unknown, k: string) => {
          this.store.set(k, v);
          const req = { result: undefined } as unknown as IDBRequest;
          setTimeout(() => req.onsuccess?.({} as Event), 0);
          return req;
        },
      }),
    }),
  } as unknown as IDBDatabase;
  open() {
    const req = { result: this.db, error: null } as unknown as IDBOpenDBRequest;
    setTimeout(() => req.onsuccess?.({} as Event), 0);
    return req;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 10));

function makeDirHandle(overrides: Partial<ReturnType<typeof dirHandle>> = {}) {
  return { ...dirHandle(), ...overrides };
}
function dirHandle() {
  return {
    name: "我的画布",
    queryPermission: vi.fn(async () => "granted"),
    requestPermission: vi.fn(async () => "granted"),
    getFileHandle: vi.fn(async () => ({
      createWritable: vi.fn(async () => ({ write: vi.fn(async () => {}), close: vi.fn(async () => {}) })),
    })),
  };
}

let pickerFn: ((opts?: { mode: string }) => Promise<unknown>) | undefined;

beforeEach(() => {
  vi.stubGlobal("indexedDB", new FakeIDB());
  pickerFn = undefined;
  vi.stubGlobal("showDirectoryPicker", (opts?: { mode: string }) => (pickerFn ? pickerFn(opts) : Promise.resolve(makeDirHandle())));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveTarget 保存目录", () => {
  it("支持判定：有 showDirectoryPicker 时 true", () => {
    expect(isSaveDirSupported()).toBe(true);
  });

  it("选择目录返回目录名并持久化句柄；再次读取返回同名", async () => {
    const name = await selectSaveDirectory();
    expect(name).toBe("我的画布");
    expect(await getSaveDirectoryName()).toBe("我的画布");
  });

  it("用户取消选择返回 null 且不保存句柄", async () => {
    pickerFn = async () => {
      throw new DOMException("canceled", "AbortError");
    };
    expect(await selectSaveDirectory()).toBe(null);
    expect(await getSaveDirectoryName()).toBe(null);
  });

  it("清除目录后读取为 null", async () => {
    await selectSaveDirectory();
    await clearSaveDirectory();
    await flush();
    expect(await getSaveDirectoryName()).toBe(null);
  });

  it("无写权限时返回 denied；授权后返回 saved", async () => {
    let granted = false;
    const handle = makeDirHandle({
      queryPermission: vi.fn(async () => (granted ? "granted" : "prompt")),
      requestPermission: vi.fn(async () => {
        granted = true;
        return "granted";
      }),
    });
    pickerFn = async () => handle;
    await selectSaveDirectory();
    await flush();
    // 未授权 → denied
    expect(await saveProjectsToFile("[]")).toBe("denied");
    // 重新授权后 → saved
    expect(await ensureSavePermission()).toBe(true);
    expect(await saveProjectsToFile("[]")).toBe("saved");
  });

  it("未选择目录时返回 no-dir", async () => {
    expect(await saveProjectsToFile("[]")).toBe("no-dir");
  });

  it("保存成功写入 JSON 内容", async () => {
    const file = { createWritable: vi.fn(async () => ({ write: vi.fn(async () => {}), close: vi.fn(async () => {}) })) };
    const handle = makeDirHandle({ getFileHandle: vi.fn(async () => file) });
    pickerFn = async () => handle;
    await selectSaveDirectory();
    await flush();
    expect(await saveProjectsToFile('{"a":1}')).toBe("saved");
    expect(handle.getFileHandle).toHaveBeenCalledWith("canvas-data.json", { create: true });
    expect(file.createWritable).toHaveBeenCalled();
  });
});
