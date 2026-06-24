import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { listTasksByDate, pickCurrentTask, todayStr } from '../db';
import type { Task } from '../types';

/**
 * The "minimized" state of the app: a small always-on-top floating pill in the
 * bottom-right corner showing the most relevant task by schedule. Clicking it
 * restores the full day panel.
 */
export default function MiniWidget() {
  const [task, setTask] = useState<Task | null>(null);

  useEffect(() => {
    const load = async () => {
      const tasks = await listTasksByDate(todayStr());
      setTask(pickCurrentTask(tasks));
    };
    load();
    const unlisten = Promise.all([
      listen('tasks-updated', load),
      listen('mini-refresh', load),
    ]);
    // Re-evaluate "current" every minute as the clock advances.
    const timer = window.setInterval(load, 60_000);
    return () => {
      unlisten.then((fns) => fns.forEach((f) => f()));
      window.clearInterval(timer);
    };
  }, []);

  return (
    <button
      className="mini"
      onClick={() => invoke('restore_main').catch(console.error)}
      title="Abrir panel"
    >
      <span className="mini-dot" style={{ background: task?.color ?? '#7aa2f7' }} />
      <span className="mini-text">
        <span className="mini-title">{task ? task.title : 'Sin tareas'}</span>
        {task?.start_time && <span className="mini-time">{task.start_time}</span>}
      </span>
      <span className="mini-open" aria-hidden>
        ⤢
      </span>
    </button>
  );
}
