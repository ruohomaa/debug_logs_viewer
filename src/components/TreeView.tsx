import { useState, useMemo, useCallback, useEffect } from 'react';
import { parse, type ApexLog } from '@apexdevtools/apex-log-parser';
import type { LoadedLog, LogEvent } from '../types';
import { buildApexLogTree } from '../apexLogTree';
import { formatDuration } from '../logParser';
import { getLevelColor } from '../constants';
import {
  setAllExpanded,
  filterTree,
  getEventIcon,
  type TreeNode,
} from '../logTree';

interface Props {
  events: LogEvent[];
  logs: LoadedLog[];
  density: 'default' | 'compact' | 'comfortable';
  onSelectEvent: (event: LogEvent) => void;
  connId?: string;
}

function linkifyText(text: string, connId?: string) {
  if (!connId) return text;

  const regex = /\b[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?\b/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const id = match[0];
    parts.push(
      <a
        key={match.index}
        href={`/api/open/${connId}/${id}`}
        target="_blank"
        rel="noreferrer"
        className="text-[var(--primary)] hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {id}
      </a>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export default function TreeView({ events, logs, density, onSelectEvent, connId }: Props) {
  const [treeFilter, setTreeFilter] = useState('');
  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  const [parsed, setParsed] = useState<Map<string, ApexLog>>(new Map());
  const [parseError, setParseError] = useState<string | null>(null);

  const neededLogs = useMemo(() => {
    const ids = new Set(events.map((e) => e.sourceLogId));
    return logs.filter((l) => ids.has(l.id));
  }, [events, logs]);

  const pendingLogs = useMemo(
    () => neededLogs.filter((l) => !parsed.has(l.id)),
    [neededLogs, parsed]
  );

  useEffect(() => {
    if (pendingLogs.length === 0) return;
    const controller = new AbortController();
    Promise.all(
      pendingLogs.map(async (l) => [l.id, await parse(l.rawContent, { signal: controller.signal })] as const)
    )
      .then((results) => {
        const liveIds = new Set(logs.map((l) => l.id));
        setParsed((prev) => {
          const next = new Map([...prev].filter(([id]) => liveIds.has(id)));
          for (const [id, log] of results) next.set(id, log);
          return next;
        });
        setParseError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setParseError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [pendingLogs, logs]);

  const isParsing = pendingLogs.length > 0 && !parseError;

  const rawTree = useMemo(() => buildApexLogTree(events, parsed), [events, parsed]);

  // Apply expand/collapse all
  const tree = useMemo(() => {
    let t = rawTree;
    if (expandAll === true) t = setAllExpanded(t, true);
    else if (expandAll === false) t = setAllExpanded(t, false);
    if (treeFilter) {
      const lower = treeFilter.toLowerCase();
      t = filterTree(t, (e) =>
        e.eventType.toLowerCase().includes(lower) ||
        e.detail.toLowerCase().includes(lower)
      );
    }
    return t;
  }, [rawTree, expandAll, treeFilter]);

  const paddingMap = { compact: 1, comfortable: 6, default: 3 } as const;
  const fontMap = { compact: 11, comfortable: 13, default: 12 } as const;
  const paddingY = paddingMap[density];
  const fontSize = fontMap[density];

  // Compute the start time for elapsed time display
  const startTime = events.length > 0 ? events[0].absoluteTimestamp : 0;

  if (events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-dim)] text-sm">
        No events match the current filters
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tree toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface)] border-b border-[var(--border)]">
        <input
          type="text"
          value={treeFilter}
          onChange={(e) => setTreeFilter(e.target.value)}
          placeholder="Filter tree nodes…"
          className="px-2 py-1 text-xs bg-[var(--surface2)] border border-[var(--border)] rounded text-[var(--text)] placeholder:text-[var(--text-dim)] outline-none focus:border-[var(--accent)] w-52"
        />
        <button
          onClick={() => setExpandAll(true)}
          className="px-2 py-1 text-[11px] bg-[var(--surface2)] text-[var(--text-dim)] border border-[var(--border)] rounded hover:bg-[var(--border)] cursor-pointer transition-colors"
          title="Expand all"
        >
          Expand All
        </button>
        <button
          onClick={() => setExpandAll(false)}
          className="px-2 py-1 text-[11px] bg-[var(--surface2)] text-[var(--text-dim)] border border-[var(--border)] rounded hover:bg-[var(--border)] cursor-pointer transition-colors"
          title="Collapse all"
        >
          Collapse All
        </button>
        {isParsing && <span className="text-[11px] text-[var(--text-dim)]">Parsing…</span>}
        {parseError && (
          <span className="text-[11px] text-[#ff6b6b] truncate" title={parseError}>
            Parse failed: {parseError}
          </span>
        )}
        <span className="text-[11px] text-[var(--text-dim)] ml-auto">
          {tree.length} root nodes
        </span>
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-auto px-2 py-1">
        {tree.map((node, i) => (
          <TreeNodeRow
            key={`${node.event.sourceLogId}-${node.event.lineNum}-${i}`}
            node={node}
            depth={0}
            paddingY={paddingY}
            fontSize={fontSize}
            startTime={startTime}
            onSelectEvent={onSelectEvent}
            connId={connId}
          />
        ))}
      </div>
    </div>
  );
}

// ── Single tree node (recursive) ──

function TreeNodeRow({
  node,
  depth,
  paddingY,
  fontSize,
  startTime,
  onSelectEvent,
  connId,
}: {
  node: TreeNode;
  depth: number;
  paddingY: number;
  fontSize: number;
  startTime: number;
  onSelectEvent: (event: LogEvent) => void;
  connId?: string;
}) {
  const [expanded, setExpanded] = useState(node.expanded);
  const hasChildren = node.children.length > 0;
  const { event } = node;
  const { icon, color } = getEventIcon(event.eventType);

  const toggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => !prev);
  }, []);

  const indentPx = depth * 20;

  return (
    <>
      <div
        role="treeitem"
        tabIndex={0}
        className="flex items-center gap-1 font-mono cursor-pointer hover:bg-[var(--surface2)] rounded transition-colors group"
        style={{
          paddingLeft: indentPx + 4,
          paddingTop: paddingY,
          paddingBottom: paddingY,
          fontSize,
        }}
        onClick={() => onSelectEvent(event)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectEvent(event); } }}
      >
        {/* Expand/collapse toggle */}
        <span
          role={hasChildren ? 'button' : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          className="w-4 h-4 flex items-center justify-center flex-shrink-0 select-none"
          onClick={hasChildren ? toggleExpand : undefined}
          onKeyDown={hasChildren ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(e as unknown as React.MouseEvent); } } : undefined}
          style={{
            cursor: hasChildren ? 'pointer' : 'default',
            color: 'var(--text-dim)',
          }}
        >
          {hasChildren ? (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="currentColor"
              style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
              }}
            >
              <path d="M3 1 L8 5 L3 9 Z" />
            </svg>
          ) : (
            <span style={{ width: 10 }} />
          )}
        </span>

        {/* Source log color dot */}
        {event.sourceColor && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: event.sourceColor }}
          />
        )}

        {/* Event icon */}
        <span
          className="flex-shrink-0 w-5 text-center"
          style={{ color }}
          title={event.eventType}
        >
          {icon}
        </span>

        {/* Event type */}
        <span
          className="font-medium whitespace-nowrap flex-shrink-0"
          style={{ color: getLevelColor(event.level) }}
        >
          {event.eventType}
        </span>

        {/* Elapsed time */}
        <span className="text-[var(--text-dim)] whitespace-nowrap flex-shrink-0 ml-1" title={event.timeStr}>
          +{formatDuration(event.absoluteTimestamp - startTime)}
        </span>

        {/* Duration badge (for BEGIN nodes) */}
        {node.durationMs !== undefined && node.durationMs > 0 && (
          <DurationBadge ms={node.durationMs} />
        )}

        {/* Detail (abbreviated) */}
        <span
          className="text-[var(--text-dim)] truncate ml-2 opacity-60 group-hover:opacity-100 transition-opacity"
          title={event.detail}
        >
          {linkifyText(abbreviateDetail(event.detail), connId)}
        </span>

        {/* Children count badge */}
        {hasChildren && (
          <span className="ml-auto text-[10px] text-[var(--text-dim)] opacity-50 flex-shrink-0 pr-2">
            {node.children.length}
          </span>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div
          className="relative"
          style={{ marginLeft: indentPx + 10 }}
        >
          {/* Vertical indent guide line */}
          <div
            className="absolute left-0 top-0 bottom-0 w-px"
            style={{ background: 'var(--border)' }}
          />
          {node.children.map((child, i) => (
            <TreeNodeRow
              key={`${child.event.sourceLogId}-${child.event.lineNum}-${i}`}
              node={child}
              depth={depth + 1}
              paddingY={paddingY}
              fontSize={fontSize}              startTime={startTime}              onSelectEvent={onSelectEvent}
              connId={connId}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Abbreviate long detail strings */
function abbreviateDetail(detail: string): string {
  if (!detail) return '';
  // Take first line only
  const firstLine = detail.split('\n')[0];
  if (firstLine.length > 120) return firstLine.slice(0, 117) + '…';
  return firstLine;
}

/** Color-coded duration badge */
function DurationBadge({ ms }: { ms: number }) {
  let bg: string;
  let fg: string;
  if (ms > 1000) {
    bg = 'rgba(255,107,107,0.15)';
    fg = '#ff6b6b';
  } else if (ms > 100) {
    bg = 'rgba(255,217,61,0.15)';
    fg = '#ffd93d';
  } else {
    bg = 'rgba(78,205,196,0.15)';
    fg = '#4ecdc4';
  }
  return (
    <span
      className="ml-1 px-1.5 rounded text-[10px] font-medium flex-shrink-0"
      style={{ background: bg, color: fg }}
    >
      {formatDuration(ms)}
    </span>
  );
}
