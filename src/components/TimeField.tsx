import { useEffect, useRef, useState } from 'react';

type Mode = '12h' | '24h';
type Meridiem = 'AM' | 'PM';

function parseValue(value: string): { h24: number; min: number } | null {
  const [hStr, mStr] = (value || '').split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (value && !Number.isNaN(h) && !Number.isNaN(m)) {
    return { h24: Math.max(0, Math.min(23, h)), min: Math.max(0, Math.min(59, m)) };
  }
  return null;
}

function toDisplay12(h24: number): { h12: string; meridiem: Meridiem } {
  const meridiem: Meridiem = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { h12: String(h12), meridiem };
}

function to24(h12: number, meridiem: Meridiem): number {
  if (meridiem === 'AM') return h12 === 12 ? 0 : h12;
  return h12 === 12 ? 12 : h12 + 12;
}

function buildInitial(value: string, mode: Mode) {
  const p = parseValue(value);
  if (!p) return { hStr: '', minStr: '', meridiem: 'AM' as Meridiem };
  if (mode === '12h') {
    const { h12, meridiem } = toDisplay12(p.h24);
    return { hStr: h12, minStr: String(p.min).padStart(2, '0'), meridiem };
  }
  return { hStr: String(p.h24), minStr: String(p.min).padStart(2, '0'), meridiem: 'AM' as Meridiem };
}

export default function TimeField({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem('tf-mode');
    return saved === '24h' ? '24h' : '12h';
  });

  const init = buildInitial(value, mode);
  const [hStr, setHStr] = useState(init.hStr);
  const [minStr, setMinStr] = useState(init.minStr);
  const [meridiem, setMeridiem] = useState<Meridiem>(init.meridiem);
  const lastEmit = useRef(value);

  useEffect(() => {
    if (value === lastEmit.current) return;
    const p = parseValue(value);
    if (!p) { setHStr(''); setMinStr(''); return; }
    if (mode === '12h') {
      const { h12, meridiem: mer } = toDisplay12(p.h24);
      setHStr(h12); setMinStr(String(p.min).padStart(2, '0')); setMeridiem(mer);
    } else {
      setHStr(String(p.h24)); setMinStr(String(p.min).padStart(2, '0'));
    }
    lastEmit.current = value;
  }, [value, mode]);

  const emit = (h: string, m: string, mer: Meridiem, currentMode: Mode) => {
    if (!h || Number.isNaN(Number(h))) { lastEmit.current = ''; onChange(''); return; }
    const hNum = Math.max(0, Number(h));
    const mNum = Math.max(0, Math.min(59, Number(m) || 0));
    const h24 = currentMode === '12h' ? to24(hNum, mer) : Math.min(23, hNum);
    const out = `${String(h24).padStart(2, '0')}:${String(mNum).padStart(2, '0')}`;
    lastEmit.current = out;
    onChange(out);
  };

  const getCurrentH24 = (): number => {
    const hNum = Number(hStr);
    if (Number.isNaN(hNum) || !hStr) return -1;
    return mode === '12h' ? to24(hNum, meridiem) : Math.min(23, hNum);
  };

  const stepHour = (delta: 1 | -1) => {
    const h24 = getCurrentH24();
    const base = h24 < 0 ? new Date().getHours() : h24;
    const newH24 = ((base + delta) + 24) % 24;
    if (mode === '12h') {
      const { h12, meridiem: mer } = toDisplay12(newH24);
      setHStr(h12); setMeridiem(mer); emit(h12, minStr, mer, mode);
    } else {
      const s = String(newH24);
      setHStr(s); emit(s, minStr, meridiem, mode);
    }
  };

  const stepMin = (delta: 1 | -1) => {
    const m = Number(minStr) || 0;
    const newM = ((m + delta) + 60) % 60;
    const s = String(newM).padStart(2, '0');
    setMinStr(s); emit(hStr, s, meridiem, mode);
  };

  const toggleMeridiem = () => {
    const next: Meridiem = meridiem === 'AM' ? 'PM' : 'AM';
    setMeridiem(next);
    emit(hStr || '12', minStr, next, mode);
  };

  const toggleMode = () => {
    const next: Mode = mode === '12h' ? '24h' : '12h';
    localStorage.setItem('tf-mode', next);
    const h24 = getCurrentH24();
    if (h24 >= 0) {
      if (next === '24h') {
        setHStr(String(h24));
      } else {
        const { h12, meridiem: mer } = toDisplay12(h24);
        setHStr(h12); setMeridiem(mer);
      }
    }
    setMode(next);
  };

  const maxH = mode === '24h' ? 23 : 12;
  const minH = mode === '24h' ? 0 : 1;

  const onHourChange = (raw: string) => {
    let v = raw.replace(/\D/g, '').slice(0, 2);
    if (v && Number(v) > maxH) v = String(maxH);
    setHStr(v);
    emit(v, minStr, meridiem, mode);
  };

  const onMinChange = (raw: string) => {
    let v = raw.replace(/\D/g, '').slice(0, 2);
    if (v && Number(v) > 59) v = '59';
    setMinStr(v);
    emit(hStr, v, meridiem, mode);
  };

  return (
    <div className="timefield" role="group" aria-label={ariaLabel}>
      <div className="tf-col">
        <button type="button" className="tf-spin-btn" onClick={() => stepHour(1)} tabIndex={-1} aria-label="Subir hora">▲</button>
        <input
          className="tf-num"
          inputMode="numeric"
          maxLength={2}
          placeholder="--"
          value={hStr}
          aria-label={`${ariaLabel ?? ''} hora`}
          onChange={(e) => onHourChange(e.target.value)}
          onBlur={() => {
            if (!hStr) return;
            const n = Number(hStr);
            setHStr(String(Math.min(maxH, Math.max(minH, Number.isNaN(n) ? minH : n))));
          }}
        />
        <button type="button" className="tf-spin-btn" onClick={() => stepHour(-1)} tabIndex={-1} aria-label="Bajar hora">▼</button>
      </div>
      <span className="tf-colon">:</span>
      <div className="tf-col">
        <button type="button" className="tf-spin-btn" onClick={() => stepMin(1)} tabIndex={-1} aria-label="Subir minutos">▲</button>
        <input
          className="tf-num"
          inputMode="numeric"
          maxLength={2}
          placeholder="--"
          value={minStr}
          aria-label={`${ariaLabel ?? ''} minutos`}
          onChange={(e) => onMinChange(e.target.value)}
          onBlur={() => setMinStr((m) => (m === '' ? '' : m.padStart(2, '0')))}
        />
        <button type="button" className="tf-spin-btn" onClick={() => stepMin(-1)} tabIndex={-1} aria-label="Bajar minutos">▼</button>
      </div>
      {mode === '12h' && (
        <button
          type="button"
          className={`tf-ampm${meridiem === 'AM' ? ' is-am' : ''}`}
          onClick={toggleMeridiem}
          title="Cambiar AM / PM"
          aria-label={`Meridiano ${meridiem}, cambiar`}
        >
          <span className="tf-ampm-label">{meridiem}</span>
        </button>
      )}
      <button
        type="button"
        className="tf-mode"
        onClick={toggleMode}
        title={mode === '12h' ? 'Cambiar a formato 24h' : 'Cambiar a formato 12h'}
      >
        {mode}
      </button>
    </div>
  );
}
