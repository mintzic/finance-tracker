export const themeFields = [
  ['background', 'Background'],
  ['surface', 'Surface / panel'],
  ['chrome', 'Sidebar / header'],
  ['text', 'Text'],
  ['muted', 'Muted text'],
  ['accent', 'Accent'],
  ['border', 'Border'],
] as const;

export type ThemeColor = (typeof themeFields)[number][0];
export const fontOptions = [
  { id: 'inter', name: 'Inter (default)', family: "'Inter Variable', sans-serif" },
  { id: 'system', name: 'System sans-serif', family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { id: 'humanist', name: 'Humanist sans-serif', family: "'Avenir Next', Avenir, 'Trebuchet MS', sans-serif" },
  { id: 'serif', name: 'Classic serif', family: "Georgia, 'Times New Roman', serif" },
  { id: 'mono', name: 'Monospace', family: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace" },
] as const;
export type FontId = (typeof fontOptions)[number]['id'];
export type Theme = { preset: string; colors: Record<ThemeColor, string>; font: FontId };
export const themePresets: { id: string; name: string; colors: Theme['colors'] }[] = [
  {
    id: 'folio',
    name: 'Folio Dark',
    colors: { background: '#15151f', surface: '#1c1c29', chrome: '#11111b', text: '#f1effa', muted: '#aaa6bd', accent: '#b99aff', border: '#343438' },
  },
  {
    id: 'midnight',
    name: 'Midnight Blue',
    colors: { background: '#101923', surface: '#182635', chrome: '#0c131c', text: '#edf5ff', muted: '#a2b7cb', accent: '#76c8ff', border: '#364d62' },
  },
  {
    id: 'forest',
    name: 'Forest',
    colors: { background: '#131e19', surface: '#1d2b23', chrome: '#0e1712', text: '#edf5e9', muted: '#a5b9a9', accent: '#a4d58a', border: '#3b5142' },
  },
  {
    id: 'paper',
    name: 'Paper Light',
    colors: { background: '#f4f2f8', surface: '#ffffff', chrome: '#ebe7f1', text: '#252035', muted: '#645b73', accent: '#7040b0', border: '#c9c1d5' },
  },
];
const storageKey = 'folio.appearance.v1';
const colorPattern = /^#[0-9a-f]{6}$/i;
export const defaultTheme = (): Theme => ({ preset: 'folio', colors: { ...themePresets[0].colors }, font: 'inter' });

export function validateTheme(value: unknown): Theme | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<Theme>;

  if (typeof candidate.preset !== 'string' || !themePresets.some((p) => p.id === candidate.preset)) {
    return null;
  }

  if (!candidate.colors || typeof candidate.colors !== 'object') {
    return null;
  }

  const colors = {} as Theme['colors'];
  for (const [key] of themeFields) {
    const color = candidate.colors[key];

    if (typeof color !== 'string' || !colorPattern.test(color)) {
      return null;
    }

    colors[key] = color.toLowerCase();
  }
  const font = candidate.font === undefined ? 'inter' : candidate.font;

  if (!fontOptions.some((option) => option.id === font)) {
    return null;
  }

  return { preset: candidate.preset, colors, font };
}

export function luminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.style.setProperty('--theme-font', fontOptions.find((option) => option.id === theme.font)!.family);
  for (const [key] of themeFields) {
    root.style.setProperty(`--theme-${key}`, theme.colors[key]);
  }
  const light = luminance(theme.colors.background) > 0.4;
  root.style.colorScheme = light ? 'light' : 'dark';
  root.classList.toggle('dark', !light);
  root.style.setProperty('--theme-on-accent', luminance(theme.colors.accent) > 0.179 ? '#15151f' : '#ffffff');
  root.style.setProperty('--theme-positive', light ? '#18734e' : '#73dfb0');
  root.style.setProperty('--theme-negative', light ? '#b52c45' : '#ff929e');
}

export function loadTheme(): { theme: Theme; warning: string } {
  try {
    const raw = window.localStorage.getItem(storageKey);

    if (raw === null) {
      return { theme: defaultTheme(), warning: '' };
    }

    const theme = validateTheme(JSON.parse(raw));
    return theme ? { theme, warning: '' } : { theme: defaultTheme(), warning: 'Saved appearance was invalid. Folio Dark is being used.' };
  } catch {
    return { theme: defaultTheme(), warning: 'Saved appearance could not be read. Folio Dark is being used.' };
  }
}

export function saveTheme(theme: Theme): boolean {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(theme));
    return true;
  } catch {
    return false;
  }
}

export function initializeTheme(): void {
  applyTheme(loadTheme().theme);
}
