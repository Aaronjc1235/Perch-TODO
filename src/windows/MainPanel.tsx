import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification';
import { addHours, nowTime, reminderFrom, todayStr } from '../db';
import { useTasks } from '../store';
import { COLORS, type Task } from '../types';
import TimeField from '../components/TimeField';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  NoteIcon,
  Close,
  Bell,
  Clock,
  Plus,
  Minimize,
  Pin,
} from '../components/Icons';

function prettyDate(d: string): string {
  const date = new Date(`${d}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export default function MainPanel() {
  const { date, tasks, refresh, setDate, add, toggle, remove, clearCompleted } = useTasks();
  const [title, setTitle] = useState('');
  // Default to the machine's current local time, end one hour later.
  const [start, setStart] = useState(() => nowTime());
  const [end, setEnd] = useState(() => addHours(nowTime(), 1));
  const [remind, setRemind] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Initial load + ensure notification permission.
  useEffect(() => {
    refresh();
    (async () => {
      if (!(await isPermissionGranted())) {
        await requestPermission();
      }
    })();
  }, [refresh]);

  // Refresh when the scheduler (or another window) changes data, and focus the
  // input when "Agregar tarea rápida" is chosen from the tray.
  useEffect(() => {
    const unlisten = Promise.all([
      listen('tasks-updated', () => refresh()),
      listen('quick-add', () => titleRef.current?.focus()),
    ]);
    return () => {
      unlisten.then((fns) => fns.forEach((f) => f()));
    };
  }, [refresh]);

  const togglePin = async () => {
    const next = !pinned;
    setPinned(next);
    await getCurrentWindow().setAlwaysOnTop(next);
  };

  const minimize = () => invoke('minimize_to_widget').catch(console.error);

  const shiftDay = (delta: number) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(todayStr(d));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    const remind_at = remind ? reminderFrom(date, start || '09:00') : null;
    try {
      await add({
        title: title.trim(),
        scheduled_date: date,
        start_time: start || null,
        end_time: end || null,
        remind_at,
        color,
      });
      setTitle('');
      setStart(nowTime());
      setEnd(addHours(nowTime(), 1));
      setRemind(false);
      titleRef.current?.focus();
    } catch (err) {
      setError(String(err));
    }
  };

  const pending = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);
  const isToday = date === todayStr();

  return (
    <div className="panel">
      <div className="panel-titlebar" data-tauri-drag-region>
        <NoteIcon size={15} />
        <span className="brand">Perch TODO</span>
        <button
          className={`pin${pinned ? ' on' : ''}`}
          onClick={togglePin}
          title="Fijar encima de todo"
          style={{ marginLeft: 'auto' }}
        >
          <Pin size={15} strokeWidth={1.9} />
        </button>
        <button className="ghost sm" title="Minimizar a barra" onClick={minimize} aria-label="Minimizar">
          <Minimize size={16} />
        </button>
        <button
          className="ghost sm"
          title="Cerrar (sigue activo en segundo plano)"
          onClick={() => getCurrentWindow().hide()}
          aria-label="Cerrar"
        >
          <Close size={15} strokeWidth={1.9} />
        </button>
      </div>

      <div className="panel-head" data-tauri-drag-region>
        <div className="date-nav">
          <button className="ghost" onClick={() => shiftDay(-1)} aria-label="Día anterior">
            <ChevronLeft size={18} />
          </button>
          <div className="date-label">
            <strong
              className={!isToday ? 'clickable' : undefined}
              onClick={!isToday ? () => setDate(todayStr()) : undefined}
              title={!isToday ? 'Volver a hoy' : undefined}
            >
              {prettyDate(date)}
            </strong>
          </div>
          <button className="ghost" onClick={() => shiftDay(1)} aria-label="Día siguiente">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <form className="add-form" onSubmit={submit}>
        <input
          ref={titleRef}
          className="title-input"
          placeholder="Nueva tarea…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="add-row">
          <label className="field">
            <span>Inicio</span>
            <TimeField value={start} onChange={setStart} ariaLabel="Inicio" />
          </label>
          <label className="field">
            <span>Fin</span>
            <TimeField value={end} onChange={setEnd} ariaLabel="Fin" />
          </label>
          <label className="field check">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            <span className="box">
              <Check size={12} strokeWidth={3} />
            </span>
            <span>Recordar</span>
          </label>
        </div>
        <div className="add-row">
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`swatch${c === color ? ' active' : ''}`}
                style={{ background: c, color: c }}
                onClick={() => setColor(c)}
                aria-label={`color ${c}`}
              />
            ))}
          </div>
          <button type="submit" className="primary">
            <Plus size={16} strokeWidth={2.4} />
            Agregar
          </button>
        </div>
        {error && <div className="form-error">No se pudo agregar: {error}</div>}
      </form>

      <div style={{ height: 1, background: 'var(--border)' }} />

      <div className="task-list task-list--cards">
        {pending.length === 0 && done.length === 0 && (
          <p className="empty">Sin tareas para este día.</p>
        )}
        {pending.map((t) => (
          <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} />
        ))}
        {done.length > 0 && (
          <>
            <button className="section-sep clickable-sep" onClick={() => setShowDone((v) => !v)}>
              <span className={`chevron${showDone ? ' open' : ''}`}>
                <ChevronRight size={12} />
              </span>
              <span className="label">Completadas ({done.length})</span>
              <span className="rule" />
              {showDone && (
                <span
                  className="clear-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearCompleted();
                  }}
                >
                  Limpiar
                </span>
              )}
            </button>
            {showDone && done.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onRemove,
}: {
  task: Task;
  onToggle: (id: number, completed: boolean) => void;
  onRemove: (id: number) => void;
}) {
  const done = !!task.completed;
  const openSticky = () => invoke('open_sticky_note', { id: task.id }).catch(console.error);
  const time = task.start_time
    ? `${task.start_time}${task.end_time ? ' – ' + task.end_time : ''}`
    : '';

  return (
    <div className={`task${done ? ' completed' : ''}`}>
      <button
        className="checkbox"
        onClick={() => onToggle(task.id, !done)}
        aria-label={done ? 'Marcar pendiente' : 'Completar'}
      >
        {done && <Check size={13} strokeWidth={3} />}
      </button>
      <div className="task-main">
        <div className="task-title">
          <span className="dot" style={{ background: task.color }} />
          {task.title}
        </div>
        {(time || task.remind_at) && (
          <div className="task-meta">
            {time && (
              <span className="chip">
                <Clock size={12} />
                {time}
              </span>
            )}
            {task.remind_at && (
              <span className="chip reminder">
                <Bell size={12} />
                {task.remind_at.slice(11, 16)}
              </span>
            )}
          </div>
        )}
      </div>
      {!done && (
        <div className="task-actions">
          <button className="ghost sm" onClick={openSticky} title="Abrir como nota">
            <NoteIcon size={16} strokeWidth={1.8} />
          </button>
          <button className="ghost sm danger" onClick={() => onRemove(task.id)} title="Borrar">
            <Close size={15} strokeWidth={1.9} />
          </button>
        </div>
      )}
    </div>
  );
}
