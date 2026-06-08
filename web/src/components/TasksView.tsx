/* TasksView — direct port of V3TasksApp from
   tmp/.../zouk-rethink/v3-bold.jsx, wired to real /api/tasks data. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { TaskRecord, TaskStatus } from '../types';
import * as api from '../lib/api';
import { Avatar } from './zk/primitives';
import ViewHeader from './ViewHeader';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const KANBAN_COLS: { key: TaskStatus; label: string; dot: string }[] = [
  { key: 'todo',        label: 'Todo',        dot: 'var(--zk-ink-mute)' },
  { key: 'in_progress', label: 'In progress', dot: 'var(--zk-info)' },
  { key: 'in_review',   label: 'In review',   dot: 'var(--zk-warn)' },
  { key: 'done',        label: 'Done · 7d',   dot: 'var(--zk-ok)' },
];

function relTime(iso?: string | null) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function KanbanCard({ task }: { task: TaskRecord }) {
  const { agents, humans } = useApp();
  const author = task.claimedByName || task.createdByName || null;
  const avatarSrc = useMemo(() => {
    if (!author) return undefined;
    const ag = agents.find((a) => a.name === author || a.displayName === author);
    if (ag?.picture) return ag.picture;
    const hu = humans.find((h) => h.name === author);
    return hu?.picture || hu?.gravatarUrl || undefined;
  }, [author, agents, humans]);
  const isAgent = author ? agents.some((a) => a.name === author || a.displayName === author) : false;

  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--zk-bg-1)',
        border: '1px solid var(--zk-line)',
        borderRadius: 8,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 180ms var(--zk-ease-out), background 180ms var(--zk-ease-out)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--zk-line-bright)';
        e.currentTarget.style.background = 'var(--zk-bg-2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--zk-line)';
        e.currentTarget.style.background = 'var(--zk-bg-1)';
      }}
    >
      <div style={{ display: 'grid', gap: 5 }}>
        <span
          style={{
            fontFamily: 'var(--zk-font-mono)',
            fontSize: 10,
            color: 'var(--zk-ink-low)',
            letterSpacing: '0.04em',
          }}
        >
          #{task.taskNumber}
        </span>
        <span style={{ display: 'block', fontSize: 13, lineHeight: 1.4, color: 'var(--zk-ink)' }}>
          {task.title}
        </span>
      </div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 12,
          fontFamily: 'var(--zk-font-mono)', fontSize: 10,
          color: 'var(--zk-ink-mute)',
        }}
      >
        {author && (
          <Avatar
            src={avatarSrc}
            name={author}
            size="sm"
            kind={isAgent ? 'agent' : 'human'}
          />
        )}
        {task.channelName && <span>#{task.channelName}</span>}
        <span className="zk-grow" />
        {task.updatedAt && <span style={{ color: 'var(--zk-ink-low)' }}>{relTime(task.updatedAt)}</span>}
      </div>
    </div>
  );
}

function emptyCopyForStatus(label: string) {
  if (label.startsWith('Todo')) return 'No queued tasks';
  if (label.startsWith('In progress')) return 'Nothing running';
  if (label.startsWith('In review')) return 'No review queue';
  return 'No recent completions';
}

function KanbanColumn({
  label, dot, items,
}: { label: string; dot: string; items: TaskRecord[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--zk-bg-0)', minHeight: 0 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 10px',
        }}
      >
        <span className="zk-row" style={{ gap: 8 }}>
          <span className="zk-dot" style={{ background: dot, width: 6, height: 6 }} />
          <span
            style={{
              fontFamily: 'var(--zk-font-mono)', fontSize: 10,
              letterSpacing: 0, color: 'var(--zk-ink-dim)', fontWeight: 650,
            }}
          >
            {label}
          </span>
        </span>
        <span
          style={{
            fontFamily: 'var(--zk-font-mono)', fontSize: 10,
            color: 'var(--zk-ink-mute)',
            background: 'var(--zk-bg-2)', border: '1px solid var(--zk-line)',
            padding: '0 6px', borderRadius: 999,
          }}
        >
          {items.length}
        </span>
      </div>
      <div
        className="zk-scroll"
        style={{
          flex: 1, minHeight: 0, overflow: 'auto',
          padding: '0 12px 16px',
          display: 'grid', gap: 6, alignContent: 'start',
        }}
      >
        {items.length === 0 ? (
          <div
            style={{
              padding: '28px 10px',
              textAlign: 'left',
              fontFamily: 'var(--zk-font-sans)',
              fontSize: 12,
              color: 'var(--zk-ink-low)',
              border: '1px dashed var(--zk-line-2)',
              borderRadius: 8,
              background: 'var(--zk-bg-1)',
            }}
          >
            {emptyCopyForStatus(label)}
          </div>
        ) : (
          items.map((t) => <KanbanCard key={t.taskNumber} task={t} />)
        )}
      </div>
    </div>
  );
}

function BoardEmptyState() {
  return (
    <div
      className="zk-grow"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--zk-bg-0)',
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          padding: 24,
          border: '1px solid var(--zk-line)',
          borderRadius: 10,
          background: 'var(--zk-bg-1)',
          boxShadow: 'var(--zk-shadow-1)',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 8,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--zk-bg-2)',
            border: '1px solid var(--zk-line-2)',
            marginBottom: 14,
          }}
        >
          <ClipboardList size={18} color="var(--zk-ink-mute)" />
        </div>
        <h2 className="zk-display" style={{ margin: 0, fontSize: 18, color: 'var(--zk-ink)' }}>
          No tasks yet
        </h2>
        <p style={{ margin: '7px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--zk-ink-mute)' }}>
          Claimed work will appear here as it moves from todo to review and done.
        </p>
      </div>
    </div>
  );
}

export default function TasksView() {
  const { activeWorkspaceId, tasksVersion } = useApp();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');

  const load = useCallback(async (cancelled: () => boolean) => {
    setError(null);
    try {
      const fetched = await api.fetchTasks();
      if (cancelled()) return;
      setTasks(fetched);
    } catch (e) {
      if (cancelled()) return;
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      if (!cancelled()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTasks([]);
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [activeWorkspaceId, load, tasksVersion]);

  const buckets = useMemo(() => {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const m: Record<TaskStatus, TaskRecord[]> = { todo: [], in_progress: [], in_review: [], done: [] };
    for (const t of tasks) {
      if (t.status === 'done') {
        const ts = t.updatedAt ? new Date(t.updatedAt).getTime() : NaN;
        if (!Number.isFinite(ts) || ts < cutoff) continue;
      }
      if (!(t.status in m)) continue;
      m[t.status].push(t);
    }
    for (const k of Object.keys(m) as TaskStatus[]) {
      m[k].sort((a, b) => {
        const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bt - at;
      });
    }
    return m;
  }, [tasks]);

  const total = tasks.length;
  const inFlight = buckets.in_progress.length;

  return (
    <div
      style={{
        height: '100%', width: '100%',
        display: 'flex', flexDirection: 'column',
        background: 'var(--zk-bg-0)', color: 'var(--zk-ink)',
        minHeight: 0,
      }}
    >
      <ViewHeader
        title="Tasks"
        meta={`${total} total · ${inFlight} in flight`}
        actions={
          <div className="zk-seg">
            <button
              type="button"
              className={view === 'board' ? 'is-active' : ''}
              onClick={() => setView('board')}
            >
              Board
            </button>
            <button
              type="button"
              className={view === 'list' ? 'is-active' : ''}
              onClick={() => setView('list')}
            >
              List
            </button>
          </div>
        }
      />

      {error ? (
        <div className="zk-grow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div
            style={{
              padding: '12px 16px', borderRadius: 8,
              border: '1px solid rgba(217,119,119,0.3)',
              background: 'var(--zk-err-soft)',
              fontSize: 13, color: 'var(--zk-err)',
              fontFamily: 'var(--zk-font-mono)',
            }}
          >
            {error}
          </div>
        </div>
      ) : loading && tasks.length === 0 ? (
        <div className="zk-grow" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--zk-ink-mute)', fontFamily: 'var(--zk-font-mono)' }}>
            loading…
          </span>
        </div>
      ) : view === 'board' && total === 0 ? (
        <BoardEmptyState />
      ) : view === 'board' ? (
        <div
          style={{
            flex: 1, minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))',
            gap: 1,
            background: 'var(--zk-line)',
            overflowX: 'auto',
          }}
        >
          {KANBAN_COLS.map((c) => (
            <KanbanColumn
              key={c.key}
              label={c.label}
              dot={c.dot}
              items={buckets[c.key]}
            />
          ))}
        </div>
      ) : (
        <div className="zk-grow zk-scroll" style={{ overflow: 'auto', padding: '20px 28px 28px' }}>
          {tasks.length === 0 ? (
            <p
              style={{
                fontSize: 12, color: 'var(--zk-ink-mute)',
                textAlign: 'center', padding: '48px 0',
                fontFamily: 'var(--zk-font-mono)',
              }}
            >
              No tasks
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 8, maxWidth: 760 }}>
              {tasks.map((t) => <KanbanCard key={t.taskNumber} task={t} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
