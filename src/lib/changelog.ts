export interface ChangelogEntry {
  time: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    time: "2026-08-05 21:00",
    changes: [
      "科研制图工具首个里程碑：SVG 画布编辑器 + AI 智能体 + 设置页 + 导出",
      "画布元素类型定义与工厂函数（默认浅底深框样式、圆角矩形、文字估算）",
      "几何工具：命中检测、对齐/分布、吸附、钳制与箭头顶点计算",
      "历史栈：撤销/重做（上限 50 步，深拷贝快照）",
      "画布 store：Zustand 状态管理（元素增删改、选择、视口、撤销/重做）",
      "画布选择交互：点击选中/拖动移动（带吸附）、空白框选、8 向缩放手柄与旋转手柄，一次手势 = 一步撤销",
      "导出器：SVG/PNG 导出（含箭头、旋转、XML 转义）",
      "画布渲染：SVG 元素渲染 + 滚轮缩放视口（0.25x–4x）",
    ],
  },
];
