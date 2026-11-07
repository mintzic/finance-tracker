import { AppearanceToolbar, Choice, Toggle, chartDefaults } from './component-appearance';

export const palettes: Record<string, string[]> = {
  theme: ['var(--theme-accent)', '#73d9ae', '#f2c779', '#7dbff1', '#f28fb1', '#b4dc78', '#929dff', '#f3a574', '#9eaac2'],
  pastel: ['#b9a4e8', '#9cd8bf', '#e8c997', '#9ec9e8', '#e6aac5', '#c7dca0'],
  vivid: ['#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#84cc16'],
};
export function ChartAppearance({
  settings,
  update,
  status,
  scope,
  donut = false,
  series,
  savings = false,
}: {
  settings: typeof chartDefaults;
  update: (settings: typeof chartDefaults) => void;
  status: string;
  scope: string;
  donut?: boolean;
  series?: 'income' | 'expense';
  savings?: boolean;
}) {
  return (
    <AppearanceToolbar title={scope} scope={scope} status={status} onReset={() => update(chartDefaults)}>
      {(['legend', 'tooltips', 'animation', ...(!donut ? (['grid'] as const) : [])] as const).map((key) => (
        <Toggle
          key={key}
          label={{ legend: 'Show legend', tooltips: 'Show tooltips', animation: 'Animate chart', grid: 'Show grid' }[key]}
          checked={settings[key]}
          onChange={(value) => update({ ...settings, [key]: value })}
        />
      ))}
      <Choice
        label="Chart height"
        value={settings.height}
        options={[
          ['default', 'Default'],
          ['220', 'Small (220px)'],
          ['300', 'Medium (300px)'],
          ['360', 'Large (360px)'],
        ]}
        onChange={(height) => update({ ...settings, height })}
      />
      {donut ? (
        <>
          <Choice
            label="Palette"
            value={settings.palette}
            options={[
              ['theme', 'Theme default'],
              ['pastel', 'Pastel'],
              ['vivid', 'Vivid'],
            ]}
            onChange={(palette) => update({ ...settings, palette })}
          />
          <Choice
            label="Donut thickness"
            value={settings.thickness}
            options={[
              ['16', 'Thin'],
              ['23', 'Default'],
              ['30', 'Thick'],
            ]}
            onChange={(thickness) => update({ ...settings, thickness })}
          />
        </>
      ) : (
        (savings ? (['savings'] as const) : series ? [series] : (['income', 'expense'] as const)).map((name) => {
          const key = `${name}Color` as 'incomeColor' | 'expenseColor' | 'savingsColor';
          return (
            <div key={key} className="component-appearance-color">
              <label>
                {name === 'savings' ? 'Goal allocations' : name === 'income' ? 'Income' : 'Expenses'} color
                <input
                  type="color"
                  aria-label={`${name} color`}
                  value={
                    settings[key] ||
                    getComputedStyle(document.documentElement)
                      .getPropertyValue(name === 'income' ? '--theme-positive' : '--theme-accent')
                      .trim() ||
                    '#b99aff'
                  }
                  onChange={(event) => update({ ...settings, [key]: event.target.value })}
                />
              </label>
              <button type="button" className="secondary" disabled={!settings[key]} onClick={() => update({ ...settings, [key]: '' })}>
                {settings[key] ? 'Use theme' : 'Following theme'}
              </button>
            </div>
          );
        })
      )}
    </AppearanceToolbar>
  );
}
