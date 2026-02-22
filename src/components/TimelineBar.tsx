import { useMemo, useRef } from 'react';
import type { LogEvent, LoadedLog } from '../types';

interface Props {
  events: LogEvent[];
  logs: LoadedLog[];
  onClickTimestamp?: (timestamp: number) => void;
}

export default function TimelineBar({ events, logs, onClickTimestamp }: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  const { minT, span } = useMemo(() => {
    const timestamps = events.map((e) => e.absoluteTimestamp).filter((t) => t > 0);
    if (timestamps.length === 0) return { minT: 0, maxT: 0, span: 1 };
    
    let min = timestamps[0];
    let max = timestamps[0];
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] < min) min = timestamps[i];
      if (timestamps[i] > max) max = timestamps[i];
    }
    
    return { minT: min, maxT: max, span: max - min || 1 };
  }, [events]);

  const selectedLogs = logs.filter((l) => l.selected);

  // Sample event markers (max 600 to avoid DOM overload)
  const markers = useMemo(() => {
    const step = Math.max(1, Math.floor(events.length / 600));
    const result: { x: number; h: number; color: string }[] = [];
    for (let i = 0; i < events.length; i += step) {
      const e = events[i];
      const x = ((e.absoluteTimestamp - minT) / span) * 100;
      const isError = e.level === 'ERROR' || e.level === 'FATAL';
      const isWarn = e.level === 'WARN';
      result.push({
        x,
        h: isError ? 48 : isWarn ? 32 : 16,
        color: isError ? '#ff6b6b' : e.sourceColor || '#6c8cff',
      });
    }
    return result;
  }, [events, minT, span]);

  const tickCount = 10;
  const labelCount = 6;

  if (events.length === 0) {
    return (
      <div className="bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3">
        <div className="h-12 bg-[var(--surface2)] rounded-md flex items-center justify-center text-xs text-[var(--text-dim)]">
          No events to display
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3">
      {/* Bar */}
      <div
        ref={barRef}
        className="relative h-12 bg-[var(--surface2)] rounded-md overflow-hidden mb-1.5 cursor-crosshair"
        onClick={(e) => {
          if (!onClickTimestamp || !barRef.current) return;
          const rect = barRef.current.getBoundingClientRect();
          const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const timestamp = minT + fraction * span;
          onClickTimestamp(timestamp);
        }}
      >
        {/* Tick marks */}
        {Array.from({ length: tickCount + 1 }).map((_, i) => (
          <div
            key={`tick-${i}`}
            className="absolute top-0 w-px h-full"
            style={{
              left: `${(i / tickCount) * 100}%`,
              background: 'rgba(255,255,255,0.06)',
            }}
          />
        ))}

        {/* Log range segments */}
        {selectedLogs.map((log) => {
          const logEvents = events.filter((e) => e.sourceLogId === log.id);
          if (logEvents.length === 0) return null;
          const ts = logEvents.map((e) => e.absoluteTimestamp);
          
          let lo = ts[0];
          let hi = ts[0];
          for (let i = 1; i < ts.length; i++) {
            if (ts[i] < lo) lo = ts[i];
            if (ts[i] > hi) hi = ts[i];
          }
          
          const left = ((lo - minT) / span) * 100;
          const width = Math.max(((hi - lo) / span) * 100, 0.5);
          return (
            <div
              key={log.id}
              className="absolute top-0 h-full opacity-40 hover:opacity-70 transition-opacity cursor-pointer"
              style={{ left: `${left}%`, width: `${width}%`, background: log.color }}
              title={`${log.name}: ${new Date(lo).toLocaleTimeString()} — ${new Date(hi).toLocaleTimeString()}`}
            />
          );
        })}

        {/* Event density markers */}
        {markers.map((m, i) => (
          <div
            key={i}
            className="absolute bottom-0 rounded-sm"
            style={{
              left: `${m.x}%`,
              height: `${m.h}px`,
              width: '2px',
              background: m.color,
              opacity: 0.6,
            }}
          />
        ))}
      </div>

      {/* Labels */}
      <div className="flex justify-between text-[10px] text-[var(--text-dim)] font-mono">
        {Array.from({ length: labelCount }).map((_, i) => {
          const t = minT + (span * i) / (labelCount - 1);
          return <span key={i}>{new Date(t).toLocaleTimeString()}</span>;
        })}
      </div>
    </div>
  );
}
