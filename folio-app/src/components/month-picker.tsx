import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { today } from '@/lib/money';
import './month-picker.css';

export function MonthPicker({ month, language, onSelect }: { month: string; language: string; onSelect: (month: string) => void }) {
  const currentMonth = today().slice(0, 7);
  const currentYear = Number(currentMonth.slice(0, 4));
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const label = new Date(`${month}-01T12:00:00`).toLocaleDateString(language, { month: 'long', year: 'numeric' });

  useEffect(() => {
    if (!open) {
      return;
    }

    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return (
    <div
      className="month-picker"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          trigger.current?.focus();
        }
      }}>
      <button
        type="button"
        ref={trigger}
        className="month-picker-trigger"
        aria-label={`Select month: ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setYear(Math.min(Number(month.slice(0, 4)), currentYear));
          setOpen(!open);
        }}>
        <CalendarDays size={16} />
        {label}
      </button>
      {open && (
        <div id={id} className="month-picker-popup" role="group" aria-label="Select month">
          <div className="month-picker-year">
            <button type="button" className="icon-button" aria-label="Previous year" disabled={year <= 1900} onClick={() => setYear(year - 1)}>
              <ChevronLeft size={16} />
            </button>
            <strong aria-live="polite">{year}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Next year"
              disabled={year >= Math.min(currentYear, 9998)}
              onClick={() => setYear(year + 1)}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="month-picker-grid">
            {Array.from({ length: 12 }, (_, index) => {
              const value = `${year}-${String(index + 1).padStart(2, '0')}`;
              const date = new Date(`${value}-01T12:00:00`);
              return (
                <button
                  type="button"
                  key={value}
                  disabled={value > currentMonth}
                  aria-label={date.toLocaleDateString(language, { month: 'long', year: 'numeric' })}
                  aria-pressed={value === month}
                  onClick={() => {
                    setOpen(false);
                    trigger.current?.focus();
                    onSelect(value);
                  }}>
                  {date.toLocaleDateString(language, { month: 'short' })}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
