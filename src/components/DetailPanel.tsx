import { useMemo } from 'react';
import type { LogEvent } from '../types';

interface Props {
  readonly event: LogEvent | null;
  readonly onClose: () => void;
}

/** Parse flow interview limit lines into structured data */
function parseLimits(detail: string): { name: string; used: number; max: number }[] {
  const limits: { name: string; used: number; max: number }[] = [];
  for (const line of detail.split('\n')) {
    // Typical format: "Number of SOQL queries: 0 out of 100"
    const m = /^(.+?):\s*(\d+)\s+out\s+of\s+(\d+)/i.exec(line);
    if (m) {
      limits.push({ name: m[1].trim(), used: Number(m[2]), max: Number(m[3]) });
    }
  }
  return limits;
}

const FLOW_LIMIT_EVENTS = new Set([
  'FLOW_START_INTERVIEW_LIMIT_USAGE',
  'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE',
  'FLOW_BULK_ELEMENT_LIMIT_USAGE',
]);

export default function DetailPanel({ event, onClose }: Props) {
  const isLimitsEvent = FLOW_LIMIT_EVENTS.has(event?.eventType ?? '');
  const limits = useMemo(() => {
    if (!isLimitsEvent || !event) return [];
    return parseLimits(event.detail);
  }, [event, isLimitsEvent]);

  if (!event) return null;

  return (
    <div
      className={`fixed right-0 top-[52px] w-[500px] h-[calc(100vh-52px)] bg-[var(--surface)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl transition-transform duration-200 ${
        event ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold">
          {isLimitsEvent ? 'Flow Interview Limits Usage' : 'Event Detail'}
        </h3>
        <button
          onClick={onClose}
          className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl px-2 py-0.5 rounded hover:bg-[var(--surface2)] cursor-pointer transition-colors bg-transparent border-none"
        >
          ×
        </button>
      </div>

      {/* Meta */}
      <div className="px-4 py-3 border-b border-[var(--border)] space-y-1 text-xs">
        <div className="flex gap-4">
          <span className="text-[var(--text-dim)]">Source:</span>
          <span className="font-medium flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: event.sourceColor || '#6c8cff' }}
            />
            {event.sourceLogName}
          </span>
        </div>
        <div className="flex gap-4">
          <span className="text-[var(--text-dim)]">Time:</span>
          <span className="font-mono">{event.timeStr}</span>
        </div>
        <div className="flex gap-4">
          <span className="text-[var(--text-dim)]">Type:</span>
          <span className="font-medium">{event.eventType}</span>
        </div>
        <div className="flex gap-4">
          <span className="text-[var(--text-dim)]">Level:</span>
          <span>{event.level}</span>
        </div>
        <div className="flex gap-4">
          <span className="text-[var(--text-dim)]">Category:</span>
          <span>{event.category}</span>
        </div>
        <div className="flex gap-4">
          <span className="text-[var(--text-dim)]">Line:</span>
          <span>#{event.lineNum}</span>
        </div>
      </div>

      {/* Content: limits table or raw text */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {isLimitsEvent && limits.length > 0 ? (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="py-1.5 pr-2 font-medium">Limit</th>
                <th className="py-1.5 px-2 font-medium text-right w-16">Used</th>
                <th className="py-1.5 px-2 font-medium text-right w-16">Max</th>
                <th className="py-1.5 pl-2 font-medium w-24">Usage</th>
              </tr>
            </thead>
            <tbody>
              {limits.map((l) => {
                const pct = l.max > 0 ? (l.used / l.max) * 100 : 0;
                let barColor = '#4ecdc4';
                if (pct > 75) barColor = '#ff6b6b';
                else if (pct > 50) barColor = '#ffd93d';
                return (
                  <tr
                    key={l.name}
                    className="border-b border-[var(--border)] border-opacity-30"
                  >
                    <td className="py-1.5 pr-2 font-mono text-[var(--text)]">
                      {l.name}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      <span style={{ color: l.used > 0 ? barColor : 'var(--text-dim)' }}>
                        {l.used}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-[var(--text-dim)]">
                      {l.max}
                    </td>
                    <td className="py-1.5 pl-2">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="h-1.5 rounded-full flex-1"
                          style={{
                            background: 'var(--surface2)',
                          }}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(pct, 100)}%`,
                              background: barColor,
                            }}
                          />
                        </div>
                        <span
                          className="text-[10px] font-mono w-8 text-right"
                          style={{ color: barColor }}
                        >
                          {Math.round(pct)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-[var(--text-dim)]">
            {event.raw}
          </pre>
        )}
      </div>
    </div>
  );
}
