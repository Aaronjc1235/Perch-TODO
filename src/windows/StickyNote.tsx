import { useCallback, useEffect, useRef, useState } from 'react';
import { getTask, updateTask } from '../db';
import { COLORS, type Task } from '../types';
import { Pin, Close } from '../components/Icons';
import { closeSelf, setAlwaysOnTopSelf } from '../win';

export default function StickyNote({ id }: { id: number }) {
  const [task, setTask] = useState<Task | null>(null);
  const [pinned, setPinned] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    getTask(id).then((t) => setTask(t));
  }, [id]);

  // Debounced persistence so typing stays snappy.
  const queueSave = useCallback((fields: Partial<Task>) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      updateTask(id, fields as Record<string, unknown>).catch(console.error);
    }, 400);
  }, [id]);

  const togglePin = async () => {
    const next = !pinned;
    setPinned(next);
    await setAlwaysOnTopSelf(next);
  };

  if (!task) {
    return (
      <div className="sticky" style={{ background: '#1a1b26' }} data-tauri-drag-region>
        <div className="sticky-body muted">Nota no encontrada</div>
      </div>
    );
  }

  return (
    <div className="sticky" style={{ background: task.color }}>
      <div className="sticky-bar" data-tauri-drag-region>
        <div className="sticky-swatches">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`swatch xs${c === task.color ? ' active' : ''}`}
              style={{ background: c }}
              onClick={() => {
                setTask({ ...task, color: c });
                updateTask(id, { color: c }).catch(console.error);
              }}
              aria-label={`color ${c}`}
            />
          ))}
        </div>
        <div className="sticky-tools">
          <button className={`pin${pinned ? ' on' : ''}`} onClick={togglePin} title="Fijar encima">
            <Pin size={15} strokeWidth={1.9} />
          </button>
          <button className="pin" onClick={() => closeSelf()} title="Cerrar nota">
            <Close size={15} />
          </button>
        </div>
      </div>

      <input
        className="sticky-title"
        value={task.title}
        placeholder="Título"
        onChange={(e) => {
          setTask({ ...task, title: e.target.value });
          queueSave({ title: e.target.value });
        }}
      />
      <textarea
        className="sticky-body"
        value={task.notes}
        placeholder="Escribe una nota…"
        onChange={(e) => {
          setTask({ ...task, notes: e.target.value });
          queueSave({ notes: e.target.value });
        }}
      />
    </div>
  );
}
