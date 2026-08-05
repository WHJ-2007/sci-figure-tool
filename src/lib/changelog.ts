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
      "绘制工具：形状/箭头/折线拖拽创建、文字工具点击创建、双击文字编辑（TextEditor）",
      "工具栏与属性面板：工具切换、撤销/重做、导出、属性编辑（填充/边框/线宽/透明度/文字/字号/圆角/旋转）、多选对齐与分布；编辑器主页布局",
      "快捷键：Delete/Backspace 删除、Ctrl+Z/Y 撤销重做、Ctrl+D 复制（编辑文字时快捷键不拦截）",
      "设置页：API Key/模型/Base URL 配置（localStorage 存储）、测试连接（/api/test-key 验证 Key）",
      "AI 智能体：服务端草稿（DraftCanvas）、5 个工具（createElement/updateElement/deleteElement/listElements/clearCanvas）、agent 循环（多轮工具调用上限 20 步 + 流式进度）、/api/chat NDJSON SSE 流、系统提示词（科研制图规范）",
      "聊天面板与 AI 生成流：对话式一键生成（NDJSON 流式读取进度与应用画布）、生成中画布锁定",
      "首次运行引导：未配置 API Key 时顶部显示引导条（前往设置页/可关闭）",
      "PowerShell 启动器核心：进程管理（启动/停止/状态 JSON，PID 文件 + 端口检测，全部 .ps1 带 UTF-8 BOM）",
      "PowerShell 启动器 GUI：WinForms 界面（启动/停止/打开浏览器/退出，状态轮询 + 日志滚动显示；根目录 启动器.bat 一键运行）",
    ],
  },
];
