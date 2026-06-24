import { create } from 'zustand';
import {
  createTask,
  deleteTask,
  listTasksByDate,
  todayStr,
  toggleComplete,
  updateTask,
} from './db';
import type { NewTask, Task } from './types';

interface TaskState {
  date: string;
  tasks: Task[];
  loading: boolean;
  refresh: () => Promise<void>;
  setDate: (date: string) => Promise<void>;
  add: (t: NewTask) => Promise<void>;
  toggle: (id: number, completed: boolean) => Promise<void>;
  remove: (id: number) => Promise<void>;
  edit: (id: number, fields: Record<string, unknown>) => Promise<void>;
}

export const useTasks = create<TaskState>((set, get) => ({
  date: todayStr(),
  tasks: [],
  loading: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const tasks = await listTasksByDate(get().date);
      set({ tasks });
    } finally {
      set({ loading: false });
    }
  },
  setDate: async (date) => {
    set({ date });
    await get().refresh();
  },
  add: async (t) => {
    await createTask(t);
    await get().refresh();
  },
  toggle: async (id, completed) => {
    await toggleComplete(id, completed);
    await get().refresh();
  },
  remove: async (id) => {
    await deleteTask(id);
    await get().refresh();
  },
  edit: async (id, fields) => {
    await updateTask(id, fields);
    await get().refresh();
  },
}));
