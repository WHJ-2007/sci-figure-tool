import "@testing-library/jest-dom/vitest";
import { beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest 未开启 globals，RTL 的自动 cleanup 不会注册；测试间残留 DOM 会导致
// 多个 Canvas 实例并存（文字编辑器的两个 textarea 互相抢焦点触发 blur→commit）。
afterEach(cleanup);

// 多画布持久化后，store 初始化会读 localStorage；跨测试文件的残留项目数据会污染断言，
// 统一在每个测试前清空（settings 等其他 key 也在内，各测试自己负责写入）。
// node 环境（如 agent.test.ts）无 localStorage，需守卫。
beforeEach(() => {
  if (typeof localStorage !== "undefined") localStorage.clear();
});

// 以下 jsdom 专有桩仅对 DOM 环境生效（node 环境的测试如 agent.test.ts 不依赖 DOM）
if (typeof window !== "undefined") {
// 版本守卫：jsdom 未来版本若原生支持 PointerEvent 则用原生，不再覆盖
if (typeof window.PointerEvent === "undefined") {
  // jsdom 未实现 PointerEvent：补一个继承 MouseEvent 的构造器，让指针事件的 clientX/clientY/pointerId 正常传递
  class PointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    pressure: number;
    width: number;
    height: number;
    tiltX: number;
    tiltY: number;
    twist: number;
    tangentialPressure: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
      this.pressure = init.pressure ?? 0;
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.tiltX = init.tiltX ?? 0;
      this.tiltY = init.tiltY ?? 0;
      this.twist = init.twist ?? 0;
      this.tangentialPressure = init.tangentialPressure ?? 0;
    }
    getCoalescedEvents() {
      return [this];
    }
  }
  Object.defineProperty(window, "PointerEvent", { value: PointerEvent, configurable: true });
}

// jsdom 未实现指针捕获：拖拽测试用到，桩掉即可（捕获语义由真实浏览器保证）
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.hasPointerCapture = () => false;

// jsdom 的 getBoundingClientRect 恒返回 0：画布坐标换算依赖它，桩成左上角为原点的矩形
Element.prototype.getBoundingClientRect = () =>
  ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

// jsdom 未实现 Element.scrollTo：聊天面板自动滚动用，桩掉即可（滚动语义由真实浏览器保证）
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => {};
}

// jsdom 未实现 Blob.stream()（也无 arrayBuffer）：NDJSON 流测试的 mockStream 依赖它，
// 用 FileReader（jsdom 已实现）读出内容再包装成流
if (typeof Blob.prototype.stream !== "function") {
  Blob.prototype.stream = function () {
    const self = this;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async start(c) {
        const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as ArrayBuffer);
          fr.onerror = () => reject(fr.error);
          fr.readAsArrayBuffer(self);
        });
        c.enqueue(new Uint8Array(buf));
        c.close();
      },
    });
  };
}
}
