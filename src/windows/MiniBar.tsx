import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  getCurrentWindow,
  currentMonitor,
  PhysicalPosition,
  PhysicalSize,
} from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { getSetting, listTasksByDate, setSetting, todayStr } from '../db';
import type { Task } from '../types';
import { Pin, Expand, Clock, Check, Minimize, Grip, NoteIcon } from '../components/Icons';

type Edge = 'top' | 'bottom' | 'left' | 'right';
interface Dock {
  edge: Edge;
  /** Fraction (0..1) along the edge: y for left/right, x for top/bottom. */
  offset: number;
}

const BAR_SIZE = { w: 320, h: 54 };
const TAB_SIZE = { w: 60, h: 60 };
const MARGIN = 10; // logical px gap kept from the screen edge
const DEFAULT_DOCK: Dock = { edge: 'right', offset: 0.85 };
const DOCK_SETTING_KEY = 'mini_dock';

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

async function loadDock(): Promise<Dock> {
  const raw = await getSetting(DOCK_SETTING_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.offset === 'number' &&
        ['top', 'bottom', 'left', 'right'].includes(parsed.edge)
      ) {
        return parsed as Dock;
      }
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_DOCK;
}

function saveDock(dock: Dock) {
  setSetting(DOCK_SETTING_KEY, JSON.stringify(dock)).catch(console.error);
}

/** Resize + reposition the window flush against the given dock edge. */
async function applyPlacement(level: 1 | 2, dock: Dock) {
  const monitor = await currentMonitor();
  if (!monitor) return;
  const win = getCurrentWindow();
  const sf = monitor.scaleFactor;
  const logical = level === 2 ? TAB_SIZE : BAR_SIZE;
  const w = Math.round(logical.w * sf);
  const h = Math.round(logical.h * sf);
  const margin = Math.round(MARGIN * sf);
  const { x: mx, y: my } = monitor.position;
  const { width: mw, height: mh } = monitor.size;

  let x: number;
  let y: number;
  if (dock.edge === 'left' || dock.edge === 'right') {
    x = dock.edge === 'left' ? mx + margin : mx + mw - w - margin;
    const range = Math.max(0, mh - h - margin * 2);
    y = my + margin + dock.offset * range;
  } else {
    y = dock.edge === 'top' ? my + margin : my + mh - h - margin;
    const range = Math.max(0, mw - w - margin * 2);
    x = mx + margin + dock.offset * range;
  }

  await win.setSize(new PhysicalSize(w, h));
  await win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
}

/** After a free drag, find the nearest screen edge and the offset along it. */
async function computeDockFromDrag(): Promise<Dock | null> {
  const win = getCurrentWindow();
  const monitor = await currentMonitor();
  if (!monitor) return null;
  const pos = await win.outerPosition();
  const size = await win.outerSize();
  const { x: mx, y: my } = monitor.position;
  const { width: mw, height: mh } = monitor.size;
  const margin = Math.round(MARGIN * monitor.scaleFactor);

  const cx = pos.x + size.width / 2;
  const cy = pos.y + size.height / 2;
  const distLeft = cx - mx;
  const distRight = mx + mw - cx;
  const distTop = cy - my;
  const distBottom = my + mh - cy;
  const min = Math.min(distLeft, distRight, distTop, distBottom);

  let edge: Edge;
  let offset: number;
  if (min === distLeft || min === distRight) {
    edge = min === distLeft ? 'left' : 'right';
    const range = Math.max(1, mh - size.height - margin * 2);
    offset = clamp01((pos.y - my - margin) / range);
  } else {
    edge = min === distTop ? 'top' : 'bottom';
    const range = Math.max(1, mw - size.width - margin * 2);
    offset = clamp01((pos.x - mx - margin) / range);
  }
  return { edge, offset };
}

/**
 * Collapsed state of the app, with two levels: a compact bar (next task +
 * day progress) and an even smaller tab (just the pending count). Both are
 * draggable but only ever snap flush against one of the four screen edges —
 * dragging never leaves them floating mid-screen.
 */
export default function MiniBar() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pinned, setPinned] = useState(true);
  const [level, setLevel] = useState<1 | 2>(1);
  const dockRef = useRef<Dock>(DEFAULT_DOCK);
  const moveTimer = useRef<number | null>(null);

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

  // Restore the last dock position once, when this window is first created.
  useEffect(() => {
    (async () => {
      const dock = await loadDock();
      dockRef.current = dock;
      await applyPlacement(1, dock);
    })();
  }, []);

  // The OS drives the drag; we just watch window-moved events and, once they
  // go quiet (drag released), snap to the nearest edge and persist it.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onMoved(() => {
        if (moveTimer.current) window.clearTimeout(moveTimer.current);
        moveTimer.current = window.setTimeout(async () => {
          const dock = await computeDockFromDrag();
          if (!dock) return;
          dockRef.current = dock;
          await applyPlacement(level, dock);
          saveDock(dock);
        }, 160);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [level]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    getCurrentWindow().startDragging().catch(console.error);
  };

  const togglePin = async () => {
    const next = !pinned;
    setPinned(next);
    await getCurrentWindow().setAlwaysOnTop(next);
  };

  const expandToPanel = () => invoke('restore_main').catch(console.error);

  const collapseToTab = async () => {
    setLevel(2);
    await applyPlacement(2, dockRef.current);
  };

  const expandToBar = async () => {
    setLevel(1);
    await applyPlacement(1, dockRef.current);
  };

  const total = tasks.length;
  const done = tasks.filter((t) => t.completed === 1).length;
  const pending = tasks
    .filter((t) => t.completed === 0)
    .sort((a, b) => (a.start_time || '99').localeCompare(b.start_time || '99'));
  const next = pending[0];
  const pct = total ? Math.round((done / total) * 100) : 0;
  const empty = total === 0 || !next;

  if (level === 2) {
    return (
      <div className="minitab">
        <button className="minitab-grip" onMouseDown={startDrag} title="Mover" aria-label="Mover">
          <Grip size={12} />
        </button>
        <button className="minitab-body" onClick={expandToBar} title="Abrir" aria-label="Abrir">
          <NoteIcon size={14} />
          <span className="minitab-count">{pending.length}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="minibar">
      <button className="minibar-grip" onMouseDown={startDrag} title="Mover" aria-label="Mover">
        <Grip size={13} />
      </button>

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

      <div className="minibar-tools">
        <button className={`pin${pinned ? ' on' : ''}`} title="Fijar encima" onClick={togglePin}>
          <Pin size={15} strokeWidth={1.9} />
        </button>
        <button className="ghost sm" title="Minimizar más" onClick={collapseToTab}>
          <Minimize size={15} strokeWidth={1.9} />
        </button>
        <button className="ghost sm" title="Expandir panel" onClick={expandToPanel}>
          <Expand size={15} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}
