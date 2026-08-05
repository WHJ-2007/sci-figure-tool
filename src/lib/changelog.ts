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
    ],
  },
];
