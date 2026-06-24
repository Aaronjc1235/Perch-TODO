import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  getCurrentWindow,
  currentMonitor,
  cursorPosition,
  PhysicalPosition,
  PhysicalSize,
  type Monitor,
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
// side — there is no "vertical bar" shape, so crossing onto a side edge
// always forces the square tab.
const TAB_SIZE_HORIZONTAL = { w: 240, h: 34 };
const TAB_SIZE_SQUARE = { w: 60, h: 60 };
const MARGIN = 10; // logical px gap kept from the screen edge
const DEFAULT_DOCK: Dock = { edge: 'right', offset: 0.85 };
const DOCK_SETTING_KEY = 'mini_dock';
// Cursor must move this many physical px from mousedown before a press
// becomes a drag (otherwise it's a click).
const DRAG_THRESHOLD = 4;
// How close (physical px) the cursor must get to a perpendicular screen edge
// before the widget transfers onto that edge mid-drag.
const EDGE_TRANSFER_ZONE = 40;

function sizeForLevel(level: 1 | 2, edge: Edge): { w: number; h: number } {
  if (level === 1) return BAR_SIZE;
  return edge === 'top' || edge === 'bottom' ? TAB_SIZE_HORIZONTAL : TAB_SIZE_SQUARE;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
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

/**
 * Collapsed state of the app, with two levels: a compact bar (next task +
 * day progress) and an even smaller tab (just the pending count).
 *
 * Dragging is fully manual (not the native OS window-drag): we poll the
 * global cursor position every frame and move the window ourselves. This is
 * what lets us CONSTRAIN movement to a single axis along whichever edge the
 * widget is currently docked to (e.g. only left/right while on the top
 * edge), and live-detect when the cursor crosses into a perpendicular edge's
 * zone to transfer the dock there — neither of which is possible with a
 * free-form native window drag. It also means click vs. drag is entirely
 * our own decision (a movement threshold), so the same clickable areas can
 * both be dragged and clicked, anywhere on the widget.
 */
export default function MiniBar() {
  const [tasks, setTasks] = useState<Task[]>([]);
  // Not pinned by default: the minimized widget shouldn't overlay other
  // windows unless the user explicitly turns the pin on.
  const [pinned, setPinned] = useState(false);
  const [level, setLevel] = useState<1 | 2>(1);
  const [edge, setEdge] = useState<Edge>(DEFAULT_DOCK.edge);
  const dockRef = useRef<Dock>(DEFAULT_DOCK);
  const levelRef = useRef<1 | 2>(1);
  // Set true the instant a press turns into a real drag; checked by the
  // click handlers so a drag-release never also fires as a click.
  const suppressClickRef = useRef(false);

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

  // Manual drag loop. Excludes anything marked [data-no-drag] (the small
  // pin/collapse/expand icon buttons) so those stay click-only; everywhere
  // else — including the task-text "open panel" button — supports both
  // click and drag.
  useEffect(() => {
    let rafId: number | null = null;
    let dragging = false;
    let startCursor: { x: number; y: number } | null = null;
    let monitor: Monitor | null = null;
    let onUp: (() => void) | null = null;

    const stopLoop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const finishDrag = async () => {
      stopLoop();
      if (onUp) {
        window.removeEventListener('mouseup', onUp);
        onUp = null;
      }
      if (!dragging || !monitor) {
        dragging = false;
        return;
      }
      dragging = false;
      // Persist the offset along the (possibly new) edge from the window's
      // actual settled position.
      const win = getCurrentWindow();
      const pos = await win.outerPosition();
      const size = await win.outerSize();
      const margin = Math.round(MARGIN * monitor.scaleFactor);
      const { x: mx, y: my } = monitor.position;
      const { width: mw, height: mh } = monitor.size;
      const finalEdge = dockRef.current.edge;
      let offset: number;
      if (finalEdge === 'left' || finalEdge === 'right') {
        const range = Math.max(1, mh - size.height - margin * 2);
        offset = clamp01((pos.y - my - margin) / range);
      } else {
        const range = Math.max(1, mw - size.width - margin * 2);
        offset = clamp01((pos.x - mx - margin) / range);
      }
      const dock = { edge: finalEdge, offset };
      dockRef.current = dock;
      saveDock(dock);
    };

    const tick = async () => {
      if (!startCursor || !monitor) return;
      const cursor = await cursorPosition();

      if (!dragging) {
        const dx = cursor.x - startCursor.x;
        const dy = cursor.y - startCursor.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) {
          rafId = requestAnimationFrame(tick);
          return;
        }
        dragging = true;
        suppressClickRef.current = true;
      }

      const sf = monitor.scaleFactor;
      const { x: mx, y: my } = monitor.position;
      const { width: mw, height: mh } = monitor.size;
      const zone = Math.round(EDGE_TRANSFER_ZONE * sf);

      // Constrained to the current edge's axis; live-detect a perpendicular
      // edge crossing to transfer the dock (and force the tab shape, since
      // there's no vertical-bar variant for a side edge).
      let nextEdge = dockRef.current.edge;
      if (nextEdge === 'top' || nextEdge === 'bottom') {
        if (cursor.x - mx < zone) nextEdge = 'left';
        else if (mx + mw - cursor.x < zone) nextEdge = 'right';
      } else {
        if (cursor.y - my < zone) nextEdge = 'top';
        else if (my + mh - cursor.y < zone) nextEdge = 'bottom';
      }

      let nextLevel = levelRef.current;
      if (nextEdge !== dockRef.current.edge) {
        if (nextEdge === 'left' || nextEdge === 'right') nextLevel = 2;
        dockRef.current = { ...dockRef.current, edge: nextEdge };
        setEdge(nextEdge);
        if (nextLevel !== levelRef.current) {
          levelRef.current = nextLevel;
          setLevel(nextLevel);
        }
      }

      const size = sizeForLevel(nextLevel, nextEdge);
      const margin = Math.round(MARGIN * sf);
      const w = Math.round(size.w * sf);
      const h = Math.round(size.h * sf);
      let x: number;
      let y: number;
      if (nextEdge === 'left' || nextEdge === 'right') {
        x = nextEdge === 'left' ? mx + margin : mx + mw - w - margin;
        y = clamp(cursor.y - h / 2, my + margin, my + mh - h - margin);
      } else {
        y = nextEdge === 'top' ? my + margin : my + mh - h - margin;
        x = clamp(cursor.x - w / 2, mx + margin, mx + mw - w - margin);
      }

      const win = getCurrentWindow();
      await win.setSize(new PhysicalSize(w, h));
      await win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));

      rafId = requestAnimationFrame(tick);
    };

    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
      e.preventDefault();
      dragging = false;

      // Register the mouseup listener FIRST, synchronously, before any
      // awaiting — a fast click can otherwise release the button before
      // currentMonitor()/cursorPosition() resolve below, leaving the
      // resulting rAF loop with no listener left to ever stop it (it would
      // then just keep following the cursor forever on the next move).
      let cancelled = false;
      onUp = () => {
        cancelled = true;
        finishDrag();
      };
      window.addEventListener('mouseup', onUp, { once: true });

      Promise.all([currentMonitor(), cursorPosition()]).then(([m, c]) => {
        if (cancelled) return;
        monitor = m;
        startCursor = { x: c.x, y: c.y };
        rafId = requestAnimationFrame(tick);
      });
    };

    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
      if (onUp) window.removeEventListener('mouseup', onUp);
      stopLoop();
    };
  }, []);

  const togglePin = async () => {
    const next = !pinned;
    setPinned(next);
    await getCurrentWindow().setAlwaysOnTop(next);
  };

  const expandToPanel = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    invoke('restore_main').catch(console.error);
  };

  const collapseToTab = async () => {
    setLevel(2);
    await applyPlacement(2, dockRef.current);
  };

  const expandToBar = async () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
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
        <div className="minitab minitab--horizontal">
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
          <button
            className={`pin minitab-pin${pinned ? ' on' : ''}`}
            data-no-drag
            title="Fijar encima"
            onClick={togglePin}
          >
            <Pin size={12} strokeWidth={1.9} />
          </button>
        </div>
      );
    }

    return (
      <div className="minitab">
        <button
          className={`pin minitab-pin minitab-pin--square${pinned ? ' on' : ''}`}
          data-no-drag
          title="Fijar encima"
          onClick={togglePin}
        >
          <Pin size={10} strokeWidth={2} />
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

      <div className="minibar-tools" data-no-drag>
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
