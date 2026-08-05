# 科研制图工具

AI 辅助的科研示意图编辑器：AI 算法架构图、大数据/医学机制图、数学建模图形。

## 使用

1. 双击 `启动器.bat`（或 `npm run dev`，端口 3001）
2. 打开 http://localhost:3001
3. 齿轮图标 → 设置页 → 填写 DeepSeek API Key → 测试连接
4. 回到画布：手动画图，或在右下角 AI 助手输入描述一键生成

## 常用操作

- 工具栏选择形状后拖拽绘制；选择工具下拖动/缩放/旋转选中元素
- 双击文字编辑；Delete 删除；Ctrl+Z 撤销；Ctrl+D 复制
- 多选后可对齐/分布
- 导出：SVG（矢量，论文用）/ PNG（位图）

## 测试

- `npm test` — Vitest 单元/组件/agent 测试
- `tools\launcher\test-core.ps1`、`test-launcher.ps1` — 启动器测试（PowerShell）
