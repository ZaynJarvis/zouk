import { useCallback, useEffect, useMemo, useState } from 'react';
import { KanbanSquare, RefreshCw } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { TaskRecord, TaskStatus } from '../types';
import * as api from '../lib/api';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const COLUMNS: { status: TaskStatus; label: string; accent: string }[] = [
  { status: 'todo', label: 'TODO', accent: 'text-nc-muted border-nc-border' },
  { status: 'in_progress', label: 'IN PROGRESS', accent: 'text-nc-cyan border-nc-cyan/40' },
  { status: 'in_review', label: 'IN REVIEW', accent: 'text-nc-yellow border-nc-yellow/40' },
  { status: 'done', label: 'DONE · 7D', accent: 'text-nc-green border-nc-green/40' },
];

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function TaskCard({ task }: { task: TaskRecord }) {
  const channelLabel = task.channelName ? `#${task.channelName}` : null;
  const assignee = task.claimedByName;
  const creator = task.createdByName;

  return (
    <div className="border border-nc-border bg-nc-surface p-3 flex flex-col gap-2 hover:border-nc-border-bright transition-colors">
      <div className="flex items-start gap-2">
        <span className="font-mono text-2xs text-nc-muted shrink-0 pt-0.5">#{task.taskNumber}</span>
        <p className="text-sm text-nc-text-bright font-medium break-words leading-snug flex-1">
          {task.title}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs font-mono text-nc-muted">
        {channelLabel && <span className="text-nc-text">{channelLabel}</span>}
        {assignee ? (
          <span>
            <span className="opacity-60">by </span>
            <span className="text-nc-text">@{assignee}</span>
          </span>
        ) : creator ? (
          <span>
            <span className="opacity-60">from </span>
            <span className="text-nc-text">@{creator}</span>
          </span>
        ) : null}
        {task.updatedAt && <span className="ml-auto">{relativeTime(task.updatedAt)}</span>}
      </div>
    </div>
  );
}

function Column({
  label,
  accent,
  tasks,
}: {
  label: string;
  accent: string;
  tasks: TaskRecord[];
}) {
  return (
    <div className="flex-1 min-w-[240px] flex flex-col bg-nc-deep border border-nc-border">
      <div className={`flex items-center justify-between px-3 py-2 border-b ${accent}`}>
        <span className="font-display font-bold text-xs tracking-wider font-mono">
          {label}
        </span>
        <span className="text-2xs font-mono opacity-70">{tasks.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2 flex flex-col gap-2">
        {tasks.length === 0 ? (
          <p className="text-2xs text-nc-muted text-center py-6 font-mono opacity-60">
            —
          </p>
        ) : (
          tasks.map((t) => <TaskCard key={t.taskNumber} task={t} />)
        )}
      </div>
    </div>
  );
}

export default function TasksView() {
  const { tasksVersion } = useApp();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const fetched = await api.fetchTasks();
      setTasks(fetched);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, tasksVersion]);

  const grouped = useMemo(() => {
    const doneCutoff = Date.now() - SEVEN_DAYS_MS;
    const buckets: Record<TaskStatus, TaskRecord[]> = {
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
    };
    for (const t of tasks) {
      if (t.status === 'done') {
        const ts = t.updatedAt ? new Date(t.updatedAt).getTime() : NaN;
        if (!Number.isFinite(ts) || ts < doneCutoff) continue;
      }
      if (!(t.status in buckets)) continue;
      buckets[t.status].push(t);
    }
    for (const status of Object.keys(buckets) as TaskStatus[]) {
      buckets[status].sort((a, b) => {
        const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bt - at;
      });
    }
    return buckets;
  }, [tasks]);

  const totalVisible = grouped.todo.length + grouped.in_progress.length + grouped.in_review.length + grouped.done.length;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-nc-black">
      <div className="flex items-center justify-between border-b border-nc-border px-4 h-12 shrink-0 bg-nc-surface">
        <div className="flex items-center gap-2">
          <KanbanSquare size={16} className="text-nc-indigo" />
          <h2 className="font-display font-bold text-sm tracking-wider text-nc-text-bright font-mono">
            TASKS
          </h2>
          <span className="text-2xs font-mono text-nc-muted">
            · {totalVisible} visible
          </span>
        </div>
        <button
          onClick={() => { setLoading(true); load(); }}
          className="flex items-center gap-1.5 px-2 h-7 border border-nc-border text-2xs font-mono text-nc-muted hover:border-nc-indigo hover:text-nc-indigo transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          REFRESH
        </button>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="border border-nc-red/40 bg-nc-red/10 px-4 py-3 text-sm text-nc-red font-mono">
            {error}
          </div>
        </div>
      ) : loading && tasks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-2xs font-mono text-nc-muted">LOADING…</p>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0">
          <div className="h-full flex gap-3 p-3 min-w-fit">
            {COLUMNS.map((c) => (
              <Column
                key={c.status}
                label={c.label}
                accent={c.accent}
                tasks={grouped[c.status]}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
