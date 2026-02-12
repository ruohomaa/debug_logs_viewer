import type { LogEvent } from '../types';

interface Props {
  event: LogEvent | null;
  onClose: () => void;
}

export default function DetailPanel({ event, onClose }: Props) {
  if (!event) return null;

  return (
    <div
      className={`fixed right-0 top-[52px] w-[500px] h-[calc(100vh-52px)] bg-[var(--surface)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl transition-transform duration-200 ${
        event ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold">Event Detail</h3>
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

      {/* Raw content */}
      <div className="flex-1 overflow-auto px-4 py-3">
        <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-[var(--text-dim)]">
          {event.raw}
        </pre>
      </div>
    </div>
  );
}
