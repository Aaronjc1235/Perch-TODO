import { useEffect, useRef, useState } from 'react';

type Meridiem = 'AM' | 'PM';

/** Parse a stored 24h 'HH:MM' into 12h display parts. */
function parse(value: string): { h12: string; min: string; meridiem: Meridiem } {
  const [hStr, mStr] = (value || '').split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (value && !Number.isNaN(h) && !Number.isNaN(m)) {
    const meridiem: Meridiem = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return { h12: String(h12), min: String(m).padStart(2, '0'), meridiem };
  }
  return { h12: '', min: '', meridiem: 'AM' };
}

/** Compose a stored 24h 'HH:MM' (or '' when the hour is empty). */
function compose(h12: string, min: string, meridiem: Meridiem): string {
  if (h12 === '' || Number.isNaN(Number(h12))) return '';
  const h = Math.min(12, Math.max(1, Number(h12)));
  const m = min === '' || Number.isNaN(Number(min)) ? 0 : Math.min(59, Math.max(0, Number(min)));
  const h24 = meridiem === 'AM' ? (h === 12 ? 0 : h) : h === 12 ? 12 : h + 12;
  return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 12-hour time input with an explicit AM/PM toggle (the ⇅ arrow flips it).
 * Emits a 24h 'HH:MM' string so storage stays locale-independent.
 */
export default function TimeField({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  const initial = parse(value);
  const [h12, setH12] = useState(initial.h12);
  const [min, setMin] = useState(initial.min);
  const [meridiem, setMeridiem] = useState<Meridiem>(initial.meridiem);
  const lastEmit = useRef(value);

  // Re-sync only on EXTERNAL value changes (e.g. form reset), never on our own
  // emits — otherwise re-padding would fight the user mid-typing.
  useEffect(() => {
    if (value === lastEmit.current) return;
    const p = parse(value);
    setH12(p.h12);
    setMin(p.min);
    setMeridiem(p.meridiem);
    lastEmit.current = value;
  }, [value]);

  const emit = (hh: string, mm: string, mer: Meridiem) => {
    const out = compose(hh, mm, mer);
    lastEmit.current = out;
    onChange(out);
  };

  const onHour = (raw: string) => {
    let v = raw.replace(/\D/g, '').slice(0, 2);
    if (Number(v) > 12) v = '12';
    setH12(v);
    emit(v, min, meridiem);
  };

  const onMin = (raw: string) => {
    let v = raw.replace(/\D/g, '').slice(0, 2);
    if (Number(v) > 59) v = '59';
    setMin(v);
    emit(h12, v, meridiem);
  };

  const toggle = () => {
    const next: Meridiem = meridiem === 'AM' ? 'PM' : 'AM';
    setMeridiem(next);
    emit(h12 || '12', min, next);
  };

  return (
    <div className="timefield" role="group" aria-label={ariaLabel}>
      <input
        className="tf-num"
        inputMode="numeric"
        maxLength={2}
        placeholder="--"
        value={h12}
        aria-label={`${ariaLabel ?? ''} hora`}
        onChange={(e) => onHour(e.target.value)}
        onBlur={() => h12 && setH12(String(Number(h12) || 12))}
      />
      <span className="tf-colon">:</span>
      <input
        className="tf-num"
        inputMode="numeric"
        maxLength={2}
        placeholder="--"
        value={min}
        aria-label={`${ariaLabel ?? ''} minutos`}
        onChange={(e) => onMin(e.target.value)}
        onBlur={() => setMin((m) => (m === '' ? '' : m.padStart(2, '0')))}
      />
      <button
        type="button"
        className="tf-ampm"
        onClick={toggle}
        title="Cambiar AM / PM"
        aria-label={`Meridiano ${meridiem}, cambiar`}
      >
        <span className="tf-ampm-label">{meridiem}</span>
        <span className="tf-arrow" aria-hidden>
          ⇅
        </span>
      </button>
    </div>
  );
}
