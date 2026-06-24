export interface Task {
  id: number;
  title: string;
  notes: string;
  scheduled_date: string; // 'YYYY-MM-DD'
  start_time: string | null; // 'HH:MM'
  end_time: string | null; // 'HH:MM'
  remind_at: string | null; // 'YYYY-MM-DDTHH:MM:SS' (local)
  reminded: number; // 0/1
  completed: number; // 0/1
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export type NewTask = {
  title: string;
  notes?: string;
  scheduled_date: string;
  start_time?: string | null;
  end_time?: string | null;
  remind_at?: string | null;
  color?: string;
};

/** Sticky-note palette (Tokyo Night flavoured). */
export const COLORS = [
  '#7aa2f7', // blue
  '#bb9af7', // purple
  '#9ece6a', // green
  '#e0af68', // yellow
  '#f7768e', // red
  '#7dcfff', // cyan
];
