import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { listTasksByDate, todayStr } from '../db';
import type { Task } from '../types';
import { Pin, Expand, Clock, Check } from '../components/Icons';

/**
 * Collapsed state of the app: a small always-on-top bar in the bottom-right
 * corner with a day-progress ring and the next pending task. Clicking
 * "expand" restores the main day panel.
 */
export default function MiniBar() {
  const [tasks, setTasks] = useState<Task[]>([]);
  // The window is created always-on-top by the Rust side, so reflect that.
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const load = () => listTasksByDate(todayStr()).then(setTasks);
    load();
    const unlisten = Promise.all([
      listen('tasks-updated', load),
      listen('mini-refresh', load),
    ]);
    const timer = window.setInterval(load, 60_000);
    return () => {
      unlisten.then((fns) => fns.forEach((f) => f()));
      window.clearInterval(timer);
    };
  }, []);

  const togglePin = async () => {
    const next = !pinned;
    setPinned(next);
    await getCurrentWindow().setAlwaysOnTop(next);
  };

  const expand = () => invoke('restore_main').catch(console.error);

  const total = tasks.length;
  const done = tasks.filter((t) => t.completed === 1).length;
  const pending = tasks
    .filter((t) => t.completed === 0)
    .sort((a, b) => (a.start_time || '99').localeCompare(b.start_time || '99'));
  const next = pending[0];
  const pct = total ? Math.round((done / total) * 100) : 0;
  const empty = total === 0 || !next;

  return (
    <div className="minibar">
      {empty ? (
        <div className="minibar-status empty">
          <Check size={16} />
        </div>
      ) : (
        <div className="minibar-status" style={{ ['--pct' as string]: `${pct}%` }}>
          <span className="count">{pending.length}</span>
        </div>
      )}

      <div className="minibar-text">
        {empty ? (
          <>
            <span className="line">Sin tareas</span>
            <span className="sub">Todo listo por hoy</span>
          </>
        ) : (
          <>
            <span className="line">{next.title}</span>
            <span className="sub">
              <Clock size={11} />
              {next.start_time ? `${next.start_time} · ` : ''}
              {done} de {total} hoy
            </span>
          </>
        )}
      </div>

      <div className="minibar-tools" data-tauri-drag-region>
        <button className={`pin${pinned ? ' on' : ''}`} title="Fijar encima" onClick={togglePin}>
          <Pin size={15} strokeWidth={1.9} />
        </button>
        <button className="ghost sm" title="Expandir" onClick={expand}>
          <Expand size={15} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}
