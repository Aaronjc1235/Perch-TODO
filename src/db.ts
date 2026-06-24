import Database from '@tauri-apps/plugin-sql';
import type { NewTask, Task } from './types';

let dbPromise: Promise<Database> | null = null;

/** Lazily load (and migrate) the shared SQLite database. */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load('sqlite:todo.db');
  }
  return dbPromise;
}

// ---- date / time helpers (all local, fixed-width so the Rust scheduler can
// compare them lexicographically) -------------------------------------------

export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nowDateTime(d = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${todayStr(d)}T${hh}:${mm}:${ss}`;
}

/** Current local wall-clock time as 'HH:MM' (24h, machine timezone). */
export function nowTime(d = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Add a number of hours to a 'HH:MM' value, wrapping within the same day. */
export function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const total = (((h + hours) % 24) + 24) % 24;
  return `${String(total).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Build a local reminder timestamp from a date + 'HH:MM'. */
export function reminderFrom(date: string, time: string): string {
  return `${date}T${time}:00`;
}

// ---- CRUD ------------------------------------------------------------------

export async function listTasksByDate(date: string): Promise<Task[]> {
  const db = await getDb();
  return db.select<Task[]>(
    `SELECT * FROM tasks WHERE scheduled_date = $1
     ORDER BY completed ASC,
              COALESCE(NULLIF(start_time, ''), '99:99') ASC,
              position ASC, id ASC`,
    [date],
  );
}

export async function getTask(id: number): Promise<Task | null> {
  const db = await getDb();
  const rows = await db.select<Task[]>('SELECT * FROM tasks WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function createTask(t: NewTask): Promise<number> {
  const db = await getDb();
  const now = nowDateTime();
  const res = await db.execute(
    `INSERT INTO tasks
       (title, notes, scheduled_date, start_time, end_time, remind_at, color, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      t.title,
      t.notes ?? '',
      t.scheduled_date,
      t.start_time ?? null,
      t.end_time ?? null,
      t.remind_at ?? null,
      t.color ?? '#7aa2f7',
      now,
      now,
    ],
  );
  return res.lastInsertId ?? 0;
}

const UPDATABLE = [
  'title',
  'notes',
  'scheduled_date',
  'start_time',
  'end_time',
  'remind_at',
  'reminded',
  'completed',
  'color',
  'position',
] as const;

type Updatable = (typeof UPDATABLE)[number];

export async function updateTask(id: number, fields: Partial<Record<Updatable, unknown>>): Promise<void> {
  const keys = Object.keys(fields).filter((k): k is Updatable => (UPDATABLE as readonly string[]).includes(k));
  if (keys.length === 0) return;
  const db = await getDb();
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const values = keys.map((k) => fields[k]);
  // updated_at always bumped; remind_at change re-arms the reminder.
  const reArm = keys.includes('remind_at');
  const extra = reArm ? ', reminded = 0' : '';
  values.push(nowDateTime());
  await db.execute(
    `UPDATE tasks SET ${sets.join(', ')}, updated_at = $${keys.length + 1}${extra} WHERE id = $${keys.length + 2}`,
    [...values, id],
  );
}

export async function toggleComplete(id: number, completed: boolean): Promise<void> {
  await updateTask(id, { completed: completed ? 1 : 0 });
}

export async function deleteTask(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM tasks WHERE id = $1', [id]);
}

export async function deleteCompleted(date: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM tasks WHERE scheduled_date = $1 AND completed = 1', [date]);
}

// ---- key/value settings (autostart flag, mini-widget dock position, etc.) --

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = $1',
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2',
    [key, value],
  );
}
