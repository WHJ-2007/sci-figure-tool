export interface AppSettings {
  apiKey: string;
  model: string;
  baseURL: string;
  tavilyApiKey?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: "",
  model: "deepseek-v4-flash",
  baseURL: "https://api.deepseek.com",
};

const KEY = "fig-tool-settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
