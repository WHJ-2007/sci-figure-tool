export type CanvasGestureSensitivity = "gentle" | "standard" | "high" | "very-high";

export interface AppSettings {
  apiKey: string;
  model: string;
  baseURL: string;
  canvasGestureSensitivity: CanvasGestureSensitivity;
}

export const CANVAS_GESTURE_ZOOM_PER_100: Record<CanvasGestureSensitivity, number> = {
  gentle: 1.7,
  standard: 2,
  high: 2.35,
  "very-high": 2.8,
};

const CANVAS_GESTURE_SENSITIVITIES = new Set<CanvasGestureSensitivity>(["gentle", "standard", "high", "very-high"]);

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: "",
  model: "deepseek-v4-flash",
  baseURL: "https://api.deepseek.com",
  canvasGestureSensitivity: "high",
};

const KEY = "fig-tool-settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings> & { tavilyApiKey?: unknown };
    // v2 以前的 Tavily 付费渠道已移除；读取旧设置时主动丢弃遗留密钥，不再继续存储或传输。
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : DEFAULT_SETTINGS.apiKey,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULT_SETTINGS.model,
      baseURL: typeof parsed.baseURL === "string" ? parsed.baseURL : DEFAULT_SETTINGS.baseURL,
      canvasGestureSensitivity: CANVAS_GESTURE_SENSITIVITIES.has(parsed.canvasGestureSensitivity as CanvasGestureSensitivity)
        ? parsed.canvasGestureSensitivity as CanvasGestureSensitivity
        : DEFAULT_SETTINGS.canvasGestureSensitivity,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify({
    apiKey: s.apiKey,
    model: s.model,
    baseURL: s.baseURL,
    canvasGestureSensitivity: s.canvasGestureSensitivity,
  }));
}
