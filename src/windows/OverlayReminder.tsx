import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getTask } from '../db';
import type { Task } from '../types';
import { Bell, Close, Clock } from '../components/Icons';
import { closeSelf } from '../win';

export default function OverlayReminder({ id }: { id: number }) {
  const [task, setTask] = useState<Task | null>(null);

  useEffect(() => {
    getTask(id).then(setTask);
    const unlisten = listen('overlay-refresh', () => getTask(id).then(setTask));
    return () => {
      unlisten.then((f) => f());
    };
  }, [id]);

  const done = () => invoke('complete_task', { id }).catch(console.error);
  const snooze = (minutes: number) =>
    invoke('snooze_task', { id, minutes }).catch(console.error);
  const close = () => invoke('dismiss_overlay', { id }).catch(() => closeSelf());

  return (
    <div className="overlay">
      <div className="overlay-head" data-tauri-drag-region>
        <span className="overlay-tag" style={{ background: task?.color ?? '#7aa2f7' }} />
        <span className="overlay-kicker">
          <Bell size={13} />
          Recordatorio
        </span>
        <button className="overlay-x" onClick={close} aria-label="Cerrar">
          <Close size={15} />
        </button>
      </div>
      <div className="overlay-title">{task?.title ?? '…'}</div>
      {task?.start_time && (
        <div className="overlay-time">
          <Clock size={14} />
          A las {task.start_time}
        </div>
      )}
      <div className="overlay-actions">
        <button className="primary" onClick={done}>
          Hecho
        </button>
        <button className="ghost" onClick={() => snooze(5)}>
          +5 min
        </button>
        <button className="ghost" onClick={() => snooze(10)}>
          +10 min
        </button>
      </div>
    </div>
  );
}
