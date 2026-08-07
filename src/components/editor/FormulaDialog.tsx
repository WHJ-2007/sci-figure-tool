"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCanvasStore } from "@/lib/canvas/store";
import { makeElement } from "@/lib/canvas/elements";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "@/lib/canvas/geometry";
import { latexToUnicode, STRUCTURE_QUICK, GREEK_QUICK, OPERATOR_QUICK, CHEM_QUICK } from "@/lib/canvas/formula";

// 傻瓜式公式创建/编辑对话框（参考主流公式平台的分栏工具栏）：
// 结构 / 希腊字母 / 运算符 / 化学 四个分类标签页，点击符号插入到光标位置；
// 输入框直接粘贴 LaTeX 或 Unicode 公式文本均可，实时预览，保存时源码写入元素，渲染时 LaTeX 自动转 Unicode。
// id 为空 = 新建模式（保存时在画布中心创建 formula 元素）；id 有值 = 编辑已有公式。
export default function FormulaDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [src, setSrc] = useState("");
  const [tab, setTab] = useState<"structure" | "greek" | "operator" | "chem">("structure");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!id) { setSrc(""); return; }
    const el = useCanvasStore.getState().doc.elements.find((e) => e.id === id);
    if (el && el.type === "formula") setSrc(el.text);
  }, [id]);

  if (id === undefined || id === "") return null;
  const editing = id !== null;

  // 插入到光标位置（无选区时在光标处；有选区则替换选区），插入后光标定位到插入内容末尾
  const insert = (snippet: string) => {
    const ta = taRef.current;
    if (ta) {
      const start = ta.selectionStart ?? src.length;
      const end = ta.selectionEnd ?? src.length;
      const next = src.slice(0, start) + snippet + src.slice(end);
      setSrc(next);
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + snippet.length;
        ta.setSelectionRange(pos, pos);
      });
    } else {
      setSrc((prev) => prev + snippet);
    }
  };

  const save = () => {
    const st = useCanvasStore.getState();
    if (editing) {
      const el = st.doc.elements.find((e) => e.id === id);
      if (el && el.type === "formula") st.updateElement(id, { text: src });
    } else {
      // 新建：画布中心创建并选中
      const el = makeElement("formula", CANVAS_WIDTH / 2 - 60, CANVAS_HEIGHT / 2 - 20, 120, 40, { text: src || "x^2" });
      st.addElement(el);
      st.setSelection([el.id]);
    }
    onClose();
  };

  const preview = latexToUnicode(src);

  const btnCls = "lift rounded-lg border border-white/60 bg-white/70 px-2 py-1 text-xs text-gray-600 hover:bg-white/90";
  const TABS: { key: typeof tab; label: string }[] = [
    { key: "structure", label: "结构" },
    { key: "greek", label: "希腊字母" },
    { key: "operator", label: "运算符" },
    { key: "chem", label: "化学式" },
  ];
  const items =
    tab === "structure" ? STRUCTURE_QUICK :
    tab === "greek" ? GREEK_QUICK :
    tab === "operator" ? OPERATOR_QUICK :
    CHEM_QUICK;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" data-testid="formula-dialog" onClick={onClose}>
      <div className="glass-panel max-h-[85vh] w-[36rem] max-w-[94vw] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold text-gray-800">{editing ? "编辑公式" : "插入公式"}</h3>

        {/* 实时预览：衬线斜体排版，所见即所得 */}
        <div className="mb-2 rounded-xl border border-white/60 bg-white/70 p-3 text-center text-lg italic text-gray-800 shadow-inner">
          {preview || <span className="text-gray-400">公式预览</span>}
        </div>

        {/* 输入：直接粘贴 LaTeX 或 Unicode 公式文本 */}
        <textarea
          ref={taRef}
          aria-label="公式源码"
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          placeholder={'输入公式（LaTeX 或直接粘贴），如 \\frac{a}{b}、x^2、H_2O、E = mc^2'}
          rows={2}
          className="mb-3 w-full resize-none rounded-lg border border-white/60 bg-white/70 px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-blue-300"
        />

        {/* 分类工具栏：点击符号插入到光标位置（参考主流公式平台） */}
        <div className="mb-2 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`lift rounded-lg px-2.5 py-1 text-xs ${
                tab === t.key ? "bg-blue-600 text-white shadow-sm" : "border border-white/60 bg-white/70 text-gray-500 hover:bg-white/90"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <button key={it.label} title={it.insert} onClick={() => insert(it.insert)} className={btnCls}>{it.label}</button>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="lift rounded-lg border border-white/60 bg-white/70 px-3 py-1.5 text-sm text-gray-600">取消</button>
          <button onClick={save} className="lift rounded-lg bg-blue-600/85 px-3 py-1.5 text-sm text-white">{editing ? "保存" : "插入"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
