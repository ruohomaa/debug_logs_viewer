import type { LogEvent, LoadedLog } from '../types';
import { formatDuration } from '../logParser';

interface Props {
  events: LogEvent[];
  logs: LoadedLog[];
}

export default function StatsBar({ events, logs }: Props) {
  const selectedLogs = logs.filter((l) => l.selected);
  const timestamps = events.map((e) => e.absoluteTimestamp).filter((t) => t > 0);
  const minT = timestamps.length ? Math.min(...timestamps) : 0;
  const maxT = timestamps.length ? Math.max(...timestamps) : 0;
  const errorCount = events.filter((e) => e.level === 'ERROR' || e.level === 'FATAL').length;

  return (
    <div className="flex gap-5 px-5 py-2 bg-[var(--surface2)] border-b border-[var(--border)] text-xs text-[var(--text-dim)]">
      <span>
        Logs: <strong className="text-[var(--text)] font-semibold">{selectedLogs.length}</strong>
      </span>
      <span>
        Events:{' '}
        <strong className="text-[var(--text)] font-semibold">{events.length.toLocaleString()}</strong>
      </span>
      <span>
        Window:{' '}
        <strong className="text-[var(--text)] font-semibold">
          {minT > 0
            ? `${new Date(minT).toLocaleTimeString()} — ${new Date(maxT).toLocaleTimeString()}`
            : 'N/A'}
        </strong>
      </span>
      <span>
        Duration:{' '}
        <strong className="text-[var(--text)] font-semibold">{formatDuration(maxT - minT)}</strong>
      </span>
      <span>
        Errors:{' '}
        <strong
          className="font-semibold"
          style={{ color: errorCount > 0 ? 'var(--danger)' : 'var(--text)' }}
        >
          {errorCount}
        </strong>
      </span>
    </div>
  );
}
