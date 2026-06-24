import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification';
import { reminderFrom, todayStr } from '../db';
import { useTasks } from '../store';
import { COLORS, type Task } from '../types';

function prettyDate(d: string): string {
  const date = new Date(`${d}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export default function MainPanel() {
  const { date, tasks, refresh, setDate, add, toggle, remove } = useTasks();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [remind, setRemind] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
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

  const shiftDay = (delta: number) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(todayStr(d));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const remind_at = remind ? reminderFrom(date, start || '09:00') : null;
    await add({
      title: title.trim(),
      scheduled_date: date,
      start_time: start || null,
      end_time: end || null,
      remind_at,
      color,
    });
    setTitle('');
    setStart('');
    setEnd('');
    setRemind(false);
    titleRef.current?.focus();
  };

  const pending = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  return (
    <div className="panel">
      <header className="panel-head" data-tauri-drag-region>
        <div className="date-nav">
          <button className="ghost" onClick={() => shiftDay(-1)} title="Día anterior">
            ‹
          </button>
          <div className="date-label">
            <strong>{prettyDate(date)}</strong>
            {date !== todayStr() && (
              <button className="link" onClick={() => setDate(todayStr())}>
                hoy
              </button>
            )}
          </div>
          <button className="ghost" onClick={() => shiftDay(1)} title="Día siguiente">
            ›
          </button>
        </div>
      </header>

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
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>Fin</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="field check">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
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
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`color ${c}`}
              />
            ))}
          </div>
          <button type="submit" className="primary">
            Agregar
          </button>
        </div>
      </form>

      <div className="task-list">
        {pending.length === 0 && done.length === 0 && (
          <p className="empty">Sin tareas para este día.</p>
        )}
        {pending.map((t) => (
          <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} />
        ))}
        {done.length > 0 && <div className="section-sep">Completadas</div>}
        {done.map((t) => (
          <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} />
        ))}
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
  const openSticky = () => invoke('open_sticky_note', { id: task.id }).catch(console.error);
  return (
    <div className={`task${task.completed ? ' completed' : ''}`}>
      <span className="dot" style={{ background: task.color }} />
      <button
        className="checkbox"
        onClick={() => onToggle(task.id, !task.completed)}
        title={task.completed ? 'Marcar pendiente' : 'Completar'}
      >
        {task.completed ? '✓' : ''}
      </button>
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        {(task.start_time || task.remind_at) && (
          <div className="task-meta">
            {task.start_time && <span>{task.start_time}</span>}
            {task.end_time && <span>– {task.end_time}</span>}
            {task.remind_at && <span className="bell">🔔</span>}
          </div>
        )}
      </div>
      <div className="task-actions">
        <button className="ghost sm" onClick={openSticky} title="Abrir como nota">
          ▢
        </button>
        <button className="ghost sm danger" onClick={() => onRemove(task.id)} title="Borrar">
          ✕
        </button>
      </div>
    </div>
  );
}
