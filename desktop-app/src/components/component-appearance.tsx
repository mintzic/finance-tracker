import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Settings, X } from 'lucide-react';

export const chartDefaults = {
  legend: true,
  tooltips: true,
  animation: true,
  grid: true,
  height: 'default',
  palette: 'theme',
  thickness: '23',
  incomeColor: '',
  expenseColor: '',
  savingsColor: '',
};
export const tableDefaults = { density: 'comfortable', fontSize: '10', striped: false, dividers: true, icons: true, account: true, category: true, date: true };
const choices: Record<string, string[]> = {
  height: ['default', '220', '300', '360'],
  palette: ['theme', 'pastel', 'vivid'],
  thickness: ['16', '23', '30'],
  density: ['comfortable', 'compact'],
  fontSize: ['10', '12', '14'],
};

export function useComponentAppearance<T extends Record<string, string | boolean>>(scope: string, defaults: T) {
  const key = `folio.component-appearance.v1.${scope}`;
  const load = () => {
    try {
      const raw = localStorage.getItem(key);

      if (raw === null) {
        return { key, settings: defaults, status: '' };
      }

      const value: unknown = JSON.parse(raw);

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid settings');
      }

      const settings = { ...defaults };
      for (const field of Object.keys(defaults) as (keyof T & string)[]) {
        const candidate = (value as Record<string, unknown>)[field];
        const valid =
          typeof defaults[field] === 'boolean'
            ? typeof candidate === 'boolean'
            : typeof candidate === 'string' &&
              (field.endsWith('Color') ? candidate === '' || /^#[0-9a-f]{6}$/i.test(candidate) : choices[field]?.includes(candidate));

        if (!valid) {
          throw new Error('Invalid settings');
        }

        settings[field] = candidate as T[typeof field];
      }
      return { key, settings, status: '' };
    } catch {
      return { key, settings: defaults, status: 'Saved settings could not be read or were invalid. Defaults are being used.' };
    }
  };
  const [state, setState] = useState(load);

  if (state.key !== key) {
    setState(load());
  }

  const update = (settings: T) => {
    let status = 'Saved on this device.';
    try {
      localStorage.setItem(key, JSON.stringify(settings));
    } catch {
      status = 'Applied for this session only. Local storage is unavailable.';
    }
    setState({ key, settings, status });
  };
  return { settings: state.settings, update, status: state.status };
}

export function AppearanceToolbar({
  title,
  scope,
  status,
  onReset,
  children,
}: {
  title: string;
  scope: string;
  status: string;
  onReset: () => void;
  children: ReactNode;
}) {
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) {return;}

    const position = () => {
      const panel = popover.current;
      const button = trigger.current;

      if (!panel || !button) {return;}

      const bounds = button.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const below = window.innerHeight - bounds.bottom - 16;
      const above = bounds.top - 16;
      const placeBelow = below >= height || below >= above;
      panel.style.maxHeight = `${Math.max(0, placeBelow ? below : above)}px`;
      panel.style.left = `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`;
      panel.style.top = `${placeBelow ? bounds.bottom + 6 : Math.max(8, bounds.top - Math.min(height, above) - 6)}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);
  const close = () => {
    popover.current?.hidePopover();
    trigger.current?.focus();
  };
  return (
    <div className="component-appearance-toolbar">
      <button
        ref={trigger}
        type="button"
        className="icon-button"
        aria-label={`${title} appearance settings`}
        aria-haspopup="dialog"
        aria-expanded={open}
        popoverTarget={`${id}-popover`}>
        <Settings size={15} />
      </button>
      <div
        ref={popover}
        id={`${id}-popover`}
        popover="auto"
        role="dialog"
        className="component-appearance-popover"
        aria-labelledby={id}
        onToggle={(event) => setOpen(event.newState === 'open')}>
        <div className="editor-inner">
          <div className="panel-heading">
            <h2 id={id}>{title} appearance</h2>
            <button type="button" className="icon-button" aria-label="Close appearance settings" onClick={close}>
              <X size={16} />
            </button>
          </div>
          <p className="small muted">Customize {scope}. Changes save automatically.</p>
          <div className="form-stack component-appearance-controls">{children}</div>
          <p className="small muted" role="status">
            {status || 'Using saved settings or defaults.'}
          </p>
          <div className="editor-actions">
            <button type="button" className="secondary" onClick={onReset}>
              Reset defaults
            </button>
            <button type="button" className="primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="component-appearance-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
