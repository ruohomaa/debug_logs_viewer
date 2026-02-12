import { useState, useMemo, useRef, useCallback } from 'react';
import type { LogEvent } from '../types';
import { getLevelColor } from '../constants';
import { formatDuration } from '../logParser';

interface Props {
  events: LogEvent[];
  showGaps: boolean;
  density: 'default' | 'compact' | 'comfortable';
  onSelectEvent: (event: LogEvent) => void;
}

const PAGE_SIZE = 400;

export default function EventList({ events, showGaps, density, onSelectEvent }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset visible count when events change
  const eventsRef = useRef(events);
  if (eventsRef.current !== events) {
    eventsRef.current = events;
    if (visibleCount !== PAGE_SIZE) {
      setVisibleCount(PAGE_SIZE);
    }
  }

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, events.length));
    }
  }, [events.length]);

  const visibleEvents = useMemo(() => events.slice(0, visibleCount), [events, visibleCount]);

  const paddingY = density === 'compact' ? 'py-px' : density === 'comfortable' ? 'py-1.5' : 'py-1';
  const fontSize = density === 'compact' ? 'text-[11px]' : density === 'comfortable' ? 'text-[13px]' : 'text-xs';

  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-dim)] text-sm">
        No events match the current filters
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-auto">
      <div className="px-3 py-2">
        {visibleEvents.map((e, i) => {
          // Gap indicator
          let gap: number | null = null;
          if (showGaps && i > 0) {
            const prevEvent = i > 0 ? events[i - 1] : null;
            if (prevEvent) {
              const diff = e.absoluteTimestamp - prevEvent.absoluteTimestamp;
              if (diff > 1000) gap = diff;
            }
          }

          return (
            <div key={`${e.sourceLogId}-${e.lineNum}-${i}`}>
              {gap !== null && (
                <div
                  className={`grid grid-cols-[160px_140px_1fr] gap-2 ${paddingY} px-2 ${fontSize} font-mono border-l-[3px] border-l-[var(--accent)]`}
                  style={{ background: 'rgba(108,140,255,0.04)' }}
                >
                  <span className="text-[var(--accent)]">⏱ {formatDuration(gap!)}</span>
                  <span className="text-[var(--text-dim)]">GAP</span>
                  <span />
                </div>
              )}
              <div
                className={`grid grid-cols-[160px_140px_1fr] gap-2 ${paddingY} px-2 ${fontSize} font-mono border-b border-b-[rgba(46,51,68,0.4)] hover:bg-[var(--surface2)] cursor-pointer transition-colors`}
                onClick={() => onSelectEvent(e)}
                title="Click for full detail"
              >
                <span className="text-[var(--text-dim)] whitespace-nowrap flex items-center">
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1.5 flex-shrink-0"
                    style={{ background: e.sourceColor || '#6c8cff' }}
                  />
                  {e.timeStr}
                </span>
                <span
                  className="font-medium whitespace-nowrap overflow-hidden text-ellipsis"
                  style={{ color: getLevelColor(e.level) }}
                >
                  {e.eventType}
                </span>
                <span className="text-[var(--text-dim)] whitespace-nowrap overflow-hidden text-ellipsis">
                  {e.detail.split('\n')[0].substring(0, 200)}
                </span>
              </div>
            </div>
          );
        })}
        {visibleCount < events.length && (
          <div className="text-center text-xs text-[var(--text-dim)] py-4">
            Showing {visibleCount.toLocaleString()} of {events.length.toLocaleString()} events — scroll for more
          </div>
        )}
      </div>
    </div>
  );
}
