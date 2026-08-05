import "@testing-library/jest-dom/vitest";

// jsdom 未实现 PointerEvent：补一个继承 MouseEvent 的构造器，让指针事件的 clientX/clientY/pointerId 正常传递
class PointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
    this.isPrimary = init.isPrimary ?? true;
  }
}
Object.defineProperty(window, "PointerEvent", { value: PointerEvent, configurable: true });

// jsdom 未实现指针捕获：拖拽测试用到，桩掉即可（捕获语义由真实浏览器保证）
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.hasPointerCapture = () => false;

// jsdom 的 getBoundingClientRect 恒返回 0：画布坐标换算依赖它，桩成左上角为原点的矩形
Element.prototype.getBoundingClientRect = () =>
  ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
