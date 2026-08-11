import { spawn } from "child_process";
import { homedir } from "os";
import { existsSync, statSync } from "fs";
import nodePath from "path";

// 打开本地路径（资源管理器/访达/文件管理器）。
// 浏览器安全限制禁止页面直接 window.open("file:///...")，改由服务端进程打开。
// 仅接受本机用户提供的路径；~ 展开为用户主目录；分隔符统一为平台原生（Windows 反斜杠）。
export async function POST(req: Request) {
  let raw = "";
  try {
    const body = (await req.json()) as { path?: string };
    raw = body.path ?? "";
  } catch {
    return Response.json({ ok: false, error: "请求体无效" }, { status: 400 });
  }
  if (!raw) return Response.json({ ok: false, error: "路径为空" }, { status: 400 });
  // ~ 展开 + 分隔符归一化（混合 / 与 \ 会令 explorer 打不开）
  const expanded = raw.startsWith("~") ? nodePath.join(homedir(), raw.slice(1).replace(/^[/\\]/, "")) : raw;
  const normalized = process.platform === "win32" ? expanded.replace(/\//g, "\\") : expanded.replace(/\\/g, "/");
  // 目标可能是文件（如 data/canvas-data.json）或目录：文件用 /select, 选中打开所在目录，目录直接打开
  let target = normalized;
  let selectFile = "";
  let exists = false;
  try {
    exists = existsSync(normalized);
    if (exists && !statSync(normalized).isDirectory()) {
      selectFile = normalized;
      target = nodePath.dirname(normalized);
    }
  } catch {
    exists = false; // statSync 异常视为不存在
  }
  if (!exists) {
    // 路径不存在（文件尚未落盘 / 目录未创建）：回退打开父目录（存在则打开，用户可复制路径自行确认）；
    // 父目录也不存在才报错——此前直接对不存在的路径 spawn explorer 会跳默认"文档"位置
    const parent = nodePath.dirname(normalized);
    if (existsSync(parent)) {
      target = parent;
    } else {
      return Response.json({ ok: false, error: `路径不存在：${normalized}` }, { status: 404 });
    }
  }
  try {
    if (process.platform === "win32") {
      // explorer 需反斜杠路径；文件用 /select,<file> 打开所在目录并选中
      spawn("explorer", selectFile ? [`/select,${selectFile}`] : [target], { detached: true, stdio: "ignore" }).unref();
    } else {
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      spawn(cmd, [selectFile || target], { detached: true, stdio: "ignore" }).unref();
    }
    return Response.json({ ok: true, dir: target });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
