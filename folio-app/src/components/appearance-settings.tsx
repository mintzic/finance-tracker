import { useState } from 'react';
import { applyTheme, defaultTheme, loadTheme, luminance, saveTheme, themeFields, themePresets, fontOptions, type FontId, type Theme } from '@/lib/theme';

export function AppearanceSettings() {
  const [initial] = useState(loadTheme);
  const [theme, setTheme] = useState(initial.theme);
  const [status, setStatus] = useState(initial.warning || 'Changes apply immediately and are saved on this device.');
  const update = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
    setStatus(
      saveTheme(next)
        ? 'Saved on this device. Appearance is up to date.'
        : 'Applied for this session only. Local storage is unavailable; changes could not be saved.'
    );
  };
  const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const lowContrast = [theme.colors.background, theme.colors.surface, theme.colors.chrome].some(
    (background) => contrast(theme.colors.text, background) < 4.5 || contrast(theme.colors.muted, background) < 4.5
  );
  const preset = themePresets.find((p) => p.id === theme.preset)!;
  return (
    <section className="panel form-stack appearance-settings" aria-label="Appearance">
      <h2>Choose your palette</h2>
      <p className="muted small">Appearance applies to all ledgers on this device. Pick a preset, then make it your own.</p>
      <div className="theme-presets" role="group" aria-label="Color presets">
        {themePresets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="secondary theme-preset"
            aria-pressed={themeFields.every(([key]) => theme.colors[key] === p.colors[key])}
            onClick={() => update({ ...theme, preset: p.id, colors: { ...p.colors } })}>
            <span className="theme-swatches" aria-hidden="true">
              {[p.colors.background, p.colors.surface, p.colors.text, p.colors.accent].map((color, index) => (
                <i key={index} style={{ background: color }} />
              ))}
            </span>
            {p.name}
          </button>
        ))}
      </div>
      <h2>Typography</h2>
      <label htmlFor="appearance-font">
        App font
        <select id="appearance-font" value={theme.font} onChange={(event) => update({ ...theme, font: event.target.value as FontId })}>
          {fontOptions.map((font) => (
            <option key={font.id} value={font.id}>
              {font.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">Applies throughout Folio. System font availability varies by device; no fonts are downloaded.</p>
      <h2>Customize colors</h2>
      <div className="theme-color-grid">
        {themeFields.map(([key, label]) => (
          <label key={key} className="theme-color-control" htmlFor={`theme-${key}`}>
            <span>{label}</span>
            <span className="theme-color-value">
              <input
                id={`theme-${key}`}
                type="color"
                value={theme.colors[key]}
                onChange={(event) => update({ ...theme, colors: { ...theme.colors, [key]: event.target.value } })}
              />
              <code>{theme.colors[key].toUpperCase()}</code>
            </span>
          </label>
        ))}
      </div>
      <div className="theme-preview" aria-label="Current palette preview">
        <strong>Your Folio, your space.</strong>
        <p className="muted small">Panel text and secondary details</p>
        <span className="primary">Accent preview</span>
        <span className="positive">Income +120</span>
        <span className="negative">Expense −45</span>
      </div>
      {lowContrast && (
        <p className="small" role="note">
          Some text may be hard to read. Aim for at least 4.5:1 text contrast, or restore a preset.
        </p>
      )}
      <div className="flex-actions">
        <button type="button" className="secondary" onClick={() => update({ ...theme, preset: preset.id, colors: { ...preset.colors } })}>
          Reset {preset.name}
        </button>
        <button type="button" className="secondary" onClick={() => update(defaultTheme())}>
          Restore Folio default
        </button>
      </div>
      <p className="small muted" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
