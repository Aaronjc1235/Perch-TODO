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
import { Pin, Expand, Clock, Check, Minimize, NoteIcon } from '../components/Icons';

type Edge = 'top' | 'bottom' | 'left' | 'right';
interface Dock {
  edge: Edge;
  /** Fraction (0..1) along the edge: y for left/right, x for top/bottom. */
  offset: number;
}

const BAR_SIZE = { w: 320, h: 54 };
// Nivel 2 takes two shapes: a slim horizontal strip when docked top/bottom
// (there's room to stay wide and thin), or a small square when docked to a
// side (a horizontal strip would be awkward jammed against a vertical edge).
const TAB_SIZE_HORIZONTAL = { w: 240, h: 34 };
const TAB_SIZE_SQUARE = { w: 60, h: 60 };
const MARGIN = 10; // logical px gap kept from the screen edge
const DEFAULT_DOCK: Dock = { edge: 'right', offset: 0.85 };
const DOCK_SETTING_KEY = 'mini_dock';
// How long to wait, after the window stops moving, before treating a drag as
// finished and snapping it. Must be long enough that a brief pause mid-drag
// doesn't get mistaken for the end of the gesture.
const SETTLE_MS = 220;
// Safety net: if a mousedown never produces any movement (a plain click) and
// for some reason never gets cleared, force the "armed" flag off after this.
const ARM_TIMEOUT_MS = 1500;

function sizeForLevel(level: 1 | 2, edge: Edge): { w: number; h: number } {
  if (level === 1) return BAR_SIZE;
  return edge === 'top' || edge === 'bottom' ? TAB_SIZE_HORIZONTAL : TAB_SIZE_SQUARE;
}

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
  const logical = sizeForLevel(level, dock.edge);
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
 * day progress) and an even smaller tab (just the pending count). The whole
 * surface is draggable — Tauri's `data-tauri-drag-region="deep"` already
 * exempts real <button> elements, so clicking pin/collapse/expand never
 * starts a drag. Either level only ever snaps flush against one of the four
 * screen edges; it can't be left floating mid-screen.
 */
export default function MiniBar() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pinned, setPinned] = useState(true);
  const [level, setLevel] = useState<1 | 2>(1);
  const [edge, setEdge] = useState<Edge>(DEFAULT_DOCK.edge);
  const dockRef = useRef<Dock>(DEFAULT_DOCK);
  const levelRef = useRef<1 | 2>(1);
  const armedRef = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const armTimer = useRef<number | null>(null);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

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
      setEdge(dock.edge);
      await applyPlacement(1, dock);
    })();
  }, []);

  // Dragging is handled entirely by Tauri's native data-tauri-drag-region
  // (see the root element below) — it already ignores real <button>s, so we
  // don't need a dedicated grip. What we still need is to know when a drag
  // session is happening, so we only snap-to-edge in response to genuine
  // user movement and never react to our own setPosition/setSize calls
  // (that feedback loop was the cause of the "pulsing" near side edges).
  useEffect(() => {
    const disarm = () => {
      armedRef.current = false;
      if (armTimer.current) {
        window.clearTimeout(armTimer.current);
        armTimer.current = null;
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      armedRef.current = true;
      if (armTimer.current) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(disarm, ARM_TIMEOUT_MS);
    };

    let unlistenMoved: (() => void) | undefined;
    getCurrentWindow()
      .onMoved(() => {
        if (!armedRef.current) return; // ignore moves we caused ourselves
        if (settleTimer.current) window.clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(async () => {
          disarm(); // stop reacting before we reposition it ourselves
          const dock = await computeDockFromDrag();
          if (!dock) return;
          dockRef.current = dock;
          setEdge(dock.edge);
          await applyPlacement(levelRef.current, dock);
          saveDock(dock);
        }, SETTLE_MS);
      })
      .then((fn) => {
        unlistenMoved = fn;
      });

    // Capture phase: Tauri's own drag-region script listens on `document` in
    // the bubble phase and calls stopImmediatePropagation() once it decides to
    // start a native drag — a bubble-phase listener of ours would never see
    // that event. Capture always runs before any bubble-phase listener, so
    // this fires regardless of what the native script does afterward.
    window.addEventListener('mousedown', onMouseDown, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      unlistenMoved?.();
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      if (armTimer.current) window.clearTimeout(armTimer.current);
    };
  }, []);

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
    const horizontal = edge === 'top' || edge === 'bottom';

    if (horizontal) {
      return (
        <div className="minitab minitab--horizontal" data-tauri-drag-region="deep">
          <button
            className="minitab-body minitab-body--horizontal"
            onClick={expandToBar}
            title="Abrir barra"
            aria-label="Abrir barra"
          >
            <span className={`minitab-dot${empty ? ' empty' : ''}`} />
            <span className="minitab-count">{pending.length}</span>
            {!empty && (
              <>
                <span className="minitab-sep">|</span>
                {next.start_time && <span className="minitab-time">{next.start_time}</span>}
                <span className="minitab-next-title">{next.title}</span>
              </>
            )}
          </button>
        </div>
      );
    }

    return (
      <div className="minitab" data-tauri-drag-region="deep">
        <button className="minitab-body" onClick={expandToBar} title="Abrir" aria-label="Abrir">
          <NoteIcon size={14} />
          <span className="minitab-count">{pending.length}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="minibar" data-tauri-drag-region="deep">
      {empty ? (
        <div className="minibar-status empty">
          <Check size={16} />
        </div>
      ) : (
        <div className="minibar-status" style={{ ['--pct' as string]: `${pct}%` }}>
          <span className="count">{pending.length}</span>
        </div>
      )}

      <button className="minibar-text" onClick={expandToPanel} title="Abrir panel">
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
      </button>

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
