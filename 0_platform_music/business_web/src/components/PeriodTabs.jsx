import { PERIODS } from '../api';

export default function PeriodTabs({ value, onChange }) {
  return (
    <div className="seg" role="tablist" aria-label="기간">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          role="tab"
          aria-selected={value === p.key}
          className={value === p.key ? 'is-on' : ''}
          onClick={() => onChange(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
