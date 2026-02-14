import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import type { LogEvent, LoadedLog } from '../types';
import { isAsyncDispatch } from '../logParser';

interface Props {
  readonly events: LogEvent[];
  readonly logs: LoadedLog[];
  readonly onSelectEvent: (event: LogEvent) => void;
}

// ── Event types worth showing in the diagram ──
const SIGNIFICANT_EVENTS = new Set([
  'CODE_UNIT_STARTED',
  'CODE_UNIT_FINISHED',
  'METHOD_ENTRY',
  'METHOD_EXIT',
  'CONSTRUCTOR_ENTRY',
  'CONSTRUCTOR_EXIT',
  'DML_BEGIN',
  'DML_END',
  'SOQL_EXECUTE_BEGIN',
  'SOQL_EXECUTE_END',
  'SOSL_EXECUTE_BEGIN',
  'SOSL_EXECUTE_END',
  'CALLOUT_REQUEST',
  'CALLOUT_RESPONSE',
  'EXECUTION_STARTED',
  'EXECUTION_FINISHED',
  'FLOW_START_INTERVIEW_BEGIN',
  'FLOW_START_INTERVIEW_END',
  'FLOW_ELEMENT_BEGIN',
  'FLOW_ELEMENT_END',
  'TRIGGER_STARTED',
  'TRIGGER_FINISHED',
  'USER_DEBUG',
  'EXCEPTION_THROWN',
  'FATAL_ERROR',
  'VALIDATION_RULE',
  'VALIDATION_FORMULA',
  'VF_PAGE_MESSAGE',
  'LIMIT_USAGE_FOR_NS',
]);

const PARALLEL_TOLERANCE_MS = 1;

/** Extract the host/endpoint from a CALLOUT_REQUEST or CALLOUT_RESPONSE detail string */
function extractCalloutEndpoint(detail: string): string {
  // Try to extract a URL from the detail
  const urlMatch = /https?:\/\/([^/\s|]+)/.exec(detail);
  if (urlMatch) return urlMatch[1];
  // Try to extract an endpoint= or Named Credential
  const namedMatch = /(?:Named(?:Credential)?|endpoint)[=:\s]+([^\s|,]+)/i.exec(detail);
  if (namedMatch) return namedMatch[1];
  // Fallback: first segment after splitting on | that looks like a host
  const parts = detail.split('|');
  for (const part of parts) {
    const trimmed = part.trim();
    if (/^https?:\/\//.test(trimmed)) {
      try { return new URL(trimmed).host; } catch { /* ignore */ }
    }
  }
  return 'External Service';
}

/** Format elapsed milliseconds as a readable relative string */
function formatRelativeMs(ms: number): string {
  if (ms < 0) return '+0 ms';
  if (ms < 1000) return `+${Math.round(ms)} ms`;
  if (ms < 10000) return `+${(ms / 1000).toFixed(2)} s`;
  if (ms < 60000) return `+${(ms / 1000).toFixed(1)} s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `+${min}m ${sec}s`;
}

// ── Message direction: who is talking to whom ──
type ArrowDir = 'client-to-server' | 'server-to-client' | 'server-to-external' | 'external-to-server' | 'self-server';

function getArrowDirection(eventType: string): ArrowDir {
  if (/EXECUTION_STARTED/.test(eventType)) return 'client-to-server';
  if (/EXECUTION_FINISHED/.test(eventType)) return 'server-to-client';
  if (/CALLOUT_REQUEST/.test(eventType)) return 'server-to-external';
  if (/CALLOUT_RESPONSE/.test(eventType)) return 'external-to-server';
  return 'self-server';
}

// Short labels for event types
function shortLabel(e: LogEvent): string {
  const d = e.detail.split('\n')[0];
  switch (e.eventType) {
    case 'CODE_UNIT_STARTED':
    case 'CODE_UNIT_FINISHED': {
      const parts = d.split('|');
      const name = parts.at(-1) || d;
      return name.length > 60 ? name.substring(0, 57) + '...' : name;
    }
    case 'METHOD_ENTRY':
    case 'METHOD_EXIT': {
      const parts = d.split('|');
      return parts.at(-1) || d;
    }
    case 'DML_BEGIN':
    case 'DML_END':
      return `DML: ${d.split('|').slice(1).join(' ').substring(0, 50)}`;
    case 'SOQL_EXECUTE_BEGIN':
    case 'SOQL_EXECUTE_END':
      return `SOQL: ${d.substring(0, 55)}`;
    case 'USER_DEBUG':
      return `DEBUG: ${d.split('|').pop()?.substring(0, 50) || d.substring(0, 50)}`;
    case 'EXCEPTION_THROWN':
    case 'FATAL_ERROR':
      return d.substring(0, 60);
    case 'CALLOUT_REQUEST': {
      const endpoint = extractCalloutEndpoint(d);
      // Try to extract HTTP method
      const methodMatch = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i.exec(d);
      const method = methodMatch ? methodMatch[1].toUpperCase() + ' ' : '';
      return `${method}${endpoint}`.substring(0, 50);
    }
    case 'CALLOUT_RESPONSE': {
      // Try to extract status code
      const statusMatch = /\b(\d{3})\b/.exec(d);
      const status = statusMatch ? `[${statusMatch[1]}] ` : '';
      const ep = extractCalloutEndpoint(d);
      return `${status}${ep}`.substring(0, 50);
    }
    case 'EXECUTION_STARTED':
      return 'Request';
    case 'EXECUTION_FINISHED':
      return 'Response';
    default:
      return d.substring(0, 55) || e.eventType;
  }
}

// Color for event type
function eventColor(eventType: string): string {
  if (/SOQL|SOSL/.test(eventType)) return '#60a5fa';
  if (/DML/.test(eventType)) return '#4ecdc4';
  if (/CALLOUT/.test(eventType)) return '#fb923c';
  if (/EXCEPTION|FATAL|ERROR/.test(eventType)) return '#ff6b6b';
  if (/TRIGGER/.test(eventType)) return '#f472b6';
  if (/FLOW/.test(eventType)) return '#c084fc';
  if (/USER_DEBUG/.test(eventType)) return '#ffd93d';
  if (/EXECUTION/.test(eventType)) return '#6c8cff';
  if (/CODE_UNIT|METHOD|CONSTRUCTOR/.test(eventType)) return '#8b90a0';
  return '#8b90a0';
}

// Determine participant label from the log Operation field
function participantLabel(log: LoadedLog): string {
  const op = log.apexLog?.Operation || log.name;
  if (/\bAPI\b/i.test(op)) return 'API';
  if (/\bBatch\b/i.test(op)) return 'Batch Apex';
  if (/\bSchedule/i.test(op)) return 'Scheduled Apex';
  if (/\bFuture\b/i.test(op)) return 'Future';
  if (/\bQueueable\b/i.test(op)) return 'Queueable';
  if (/\bVF\b|Visualforce/i.test(op)) return 'Visualforce';
  if (/\bLightning\b|Aura|LWC/i.test(op)) return 'Lightning';
  return 'Client';
}

// ── Layout types ──
interface DiagramMessage {
  event: LogEvent;
  y: number;
  label: string;
  color: string;
  direction: ArrowDir;
  isError: boolean;
  sourceLogId: string;
  sourceLogName: string;
  sourceColor: string;
  calloutEndpoint?: string;
  asyncType?: 'future' | 'queueable' | null;
}

interface ParFragment {
  yStart: number;
  yEnd: number;
  sections: ParSection[];
}

interface ParSection {
  logId: string;
  logName: string;
  logColor: string;
  yStart: number;
  yEnd: number;
}

// ── Layout constants ──
const HEADER_HEIGHT = 60;
const CLIENT_X = 140;
const SERVER_X = 430;
const ENDPOINT_START_X = 680;
const ENDPOINT_SPACING = 200;
const MSG_HEIGHT = 32;
const MSG_GAP = 4;
const LEFT_MARGIN = 60;
const BASE_DIAGRAM_WIDTH = 900;
const PAR_PADDING = 12;
const PAR_LABEL_HEIGHT = 22;
const SECTION_DIVIDER_HEIGHT = 20;
const ACTIVATION_WIDTH = 12;

/** Group consecutive events that share the same timestamp (within tolerance) */
function groupEventsByTimestamp(filtered: LogEvent[]): LogEvent[][] {
  const groups: LogEvent[][] = [];
  let i = 0;
  while (i < filtered.length) {
    const baseTs = filtered[i].absoluteTimestamp;
    const group: LogEvent[] = [filtered[i]];
    let j = i + 1;
    while (j < filtered.length && Math.abs(filtered[j].absoluteTimestamp - baseTs) <= PARALLEL_TOLERANCE_MS) {
      group.push(filtered[j]);
      j++;
    }
    groups.push(group);
    i = j;
  }
  return groups;
}

/** Lay out messages for a set of events */
function layoutMessages(
  logEvents: LogEvent[],
  startY: number,
  calloutState: { lastEndpoint?: string },
): { messages: DiagramMessage[]; endY: number } {
  const messages: DiagramMessage[] = [];
  let y = startY;
  for (const e of logEvents) {
    const direction = getArrowDirection(e.eventType);
    let calloutEndpoint: string | undefined;
    if (direction === 'server-to-external') {
      calloutEndpoint = extractCalloutEndpoint(e.detail);
      calloutState.lastEndpoint = calloutEndpoint;
    } else if (direction === 'external-to-server') {
      // Use the endpoint from the preceding CALLOUT_REQUEST
      calloutEndpoint = calloutState.lastEndpoint || extractCalloutEndpoint(e.detail);
    }
    messages.push({
      event: e,
      y,
      label: shortLabel(e),
      color: eventColor(e.eventType),
      direction,
      isError: e.level === 'ERROR' || e.level === 'FATAL',
      sourceLogId: e.sourceLogId || '',
      sourceLogName: e.sourceLogName || '',
      sourceColor: e.sourceColor || '#6c8cff',
      calloutEndpoint,
      asyncType: isAsyncDispatch(e),
    });
    y += MSG_HEIGHT + MSG_GAP;
  }
  return { messages, endY: y };
}

/** Lay out a par fragment with sections per log */
function layoutParFragment(
  byLog: Map<string, LogEvent[]>,
  selectedLogs: LoadedLog[],
  currentY: number,
  allMessages: DiagramMessage[],
  fragments: ParFragment[],
  calloutState: { lastEndpoint?: string },
): number {
  const fragYStart = currentY;
  let y = currentY + PAR_LABEL_HEIGHT;
  const sections: ParSection[] = [];
  let sectionIdx = 0;

  for (const [logId, logEvents] of byLog) {
    const log = selectedLogs.find((l) => l.id === logId);
    if (!log) continue;

    if (sectionIdx > 0) {
      y += SECTION_DIVIDER_HEIGHT;
    }

    const sectionYStart = y - (sectionIdx > 0 ? SECTION_DIVIDER_HEIGHT : 0);
    const { messages: sectionMsgs, endY } = layoutMessages(logEvents, y, calloutState);
    allMessages.push(...sectionMsgs);
    y = endY;

    sections.push({
      logId,
      logName: log.name,
      logColor: log.color,
      yStart: sectionYStart,
      yEnd: y,
    });
    sectionIdx++;
  }

  y += PAR_PADDING;
  fragments.push({ yStart: fragYStart, yEnd: y, sections });
  return y;
}

/** Compute activation bars per log spanning first to last message */
function computeActivationBars(
  msgs: DiagramMessage[],
): { yStart: number; yEnd: number; color: string }[] {
  const byLog = new Map<string, { yStart: number; yEnd: number; color: string }>();
  for (const m of msgs) {
    const existing = byLog.get(m.sourceLogId);
    if (existing) {
      existing.yEnd = Math.max(existing.yEnd, m.y);
    } else {
      byLog.set(m.sourceLogId, { yStart: m.y, yEnd: m.y, color: m.sourceColor });
    }
  }
  return [...byLog.values()];
}

interface ArrowOpts {
  fromX: number;
  toX: number;
  arrowY: number;
  color: string;
  opacity: number;
  strokeW: number;
  label: string;
  dashed: boolean;
}

/** Render an arrow between two X positions */
function renderArrowBetween(opts: ArrowOpts) {
  const { fromX, toX, arrowY, color, opacity, strokeW, label, dashed } = opts;
  const arrowSize = 7;
  const goingRight = toX > fromX;
  const tipX = toX;
  const baseX = goingRight ? toX - arrowSize : toX + arrowSize;

  return (
    <g>
      <line
        x1={fromX} y1={arrowY}
        x2={baseX} y2={arrowY}
        stroke={color} strokeWidth={strokeW}
        strokeDasharray={dashed ? '6 3' : undefined}
        opacity={opacity}
      />
      <polygon
        points={`${tipX},${arrowY} ${baseX},${arrowY - arrowSize / 2} ${baseX},${arrowY + arrowSize / 2}`}
        fill={color} opacity={opacity}
      />
      <text
        x={(fromX + toX) / 2} y={arrowY - 6}
        textAnchor="middle" fill={color}
        fontSize={9} fontWeight={500} fontFamily="system-ui" opacity={opacity}
      >
        {label}
      </text>
    </g>
  );
}

/** Render an arrow based on direction */
function renderArrow(msg: DiagramMessage, arrowY: number, isHovered: boolean, endpointXMap: Map<string, number>) {
  const color = msg.isError ? '#ff6b6b' : msg.color;
  const opacity = isHovered ? 1 : 0.7;
  const strokeW = isHovered ? 1.8 : 1.2;
  const labelMaxLen = endpointXMap.size > 0 ? 45 : 65;
  const truncLabel = msg.label.length > labelMaxLen
    ? msg.label.substring(0, labelMaxLen - 3) + '...'
    : msg.label;

  if (msg.direction === 'client-to-server') {
    return renderArrowBetween({ fromX: CLIENT_X, toX: SERVER_X, arrowY, color, opacity, strokeW, label: truncLabel, dashed: false });
  }

  if (msg.direction === 'server-to-client') {
    return renderArrowBetween({ fromX: SERVER_X, toX: CLIENT_X, arrowY, color, opacity, strokeW, label: truncLabel, dashed: true });
  }

  if (msg.direction === 'server-to-external') {
    const extX = (msg.calloutEndpoint && endpointXMap.get(msg.calloutEndpoint)) || ENDPOINT_START_X;
    return renderArrowBetween({ fromX: SERVER_X, toX: extX, arrowY, color, opacity, strokeW, label: truncLabel, dashed: false });
  }

  if (msg.direction === 'external-to-server') {
    const extX = (msg.calloutEndpoint && endpointXMap.get(msg.calloutEndpoint)) || ENDPOINT_START_X;
    return renderArrowBetween({ fromX: extX, toX: SERVER_X, arrowY, color, opacity, strokeW, label: truncLabel, dashed: true });
  }

  // self-server: loop on the server lifeline
  const loopWidth = 60;
  const loopHeight = 14;
  const arrowSize = 7;
  return (
    <g>
      <polyline
        points={`${SERVER_X},${arrowY - loopHeight / 2} ${SERVER_X + loopWidth},${arrowY - loopHeight / 2} ${SERVER_X + loopWidth},${arrowY + loopHeight / 2} ${SERVER_X + arrowSize},${arrowY + loopHeight / 2}`}
        fill="none" stroke={color} strokeWidth={strokeW} opacity={opacity}
      />
      <polygon
        points={`${SERVER_X},${arrowY + loopHeight / 2} ${SERVER_X + arrowSize},${arrowY + loopHeight / 2 - arrowSize / 2} ${SERVER_X + arrowSize},${arrowY + loopHeight / 2 + arrowSize / 2}`}
        fill={color} opacity={opacity}
      />
      <text
        x={SERVER_X + loopWidth + 6} y={arrowY + 3}
        fill={color} fontSize={9} fontWeight={500} fontFamily="system-ui" opacity={opacity}
      >
        {truncLabel}
      </text>
    </g>
  );
}

// ── Main component ──

export default function SequenceDiagram({ events, logs, onSelectEvent }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'significant'>('significant');

  const selectedLogs = useMemo(() => logs.filter((l) => l.selected), [logs]);

  const clientLabel = useMemo(() => {
    if (selectedLogs.length === 0) return 'Client';
    const labels = selectedLogs.map(participantLabel);
    const counts = new Map<string, number>();
    for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
    let best = labels[0];
    let bestCount = 0;
    for (const [label, count] of counts) {
      if (count > bestCount) { best = label; bestCount = count; }
    }
    return best;
  }, [selectedLogs]);

  // Collect unique callout endpoints from CALLOUT_REQUEST events only
  // (responses inherit the endpoint from their preceding request)
  const calloutEndpoints = useMemo(() => {
    const endpoints = new Set<string>();
    for (const e of events) {
      if (e.eventType === 'CALLOUT_REQUEST') {
        endpoints.add(extractCalloutEndpoint(e.detail));
      }
    }
    return [...endpoints];
  }, [events]);

  // Map each endpoint to its X position
  const endpointXMap = useMemo(() => {
    const map = new Map<string, number>();
    calloutEndpoints.forEach((ep, i) => {
      map.set(ep, ENDPOINT_START_X + i * ENDPOINT_SPACING);
    });
    return map;
  }, [calloutEndpoints]);

  // Dynamic diagram width based on number of endpoints
  const diagramWidth = useMemo(() => {
    if (calloutEndpoints.length === 0) return BASE_DIAGRAM_WIDTH;
    const lastX = ENDPOINT_START_X + (calloutEndpoints.length - 1) * ENDPOINT_SPACING;
    return Math.max(BASE_DIAGRAM_WIDTH, lastX + 120);
  }, [calloutEndpoints]);

  // Build diagram layout
  const { messages, parFragments, totalHeight } = useMemo(() => {
    const filtered = (filter === 'significant'
      ? events.filter((e) => SIGNIFICANT_EVENTS.has(e.eventType))
      : events
    );

    if (filtered.length === 0 || selectedLogs.length === 0) {
      return { messages: [] as DiagramMessage[], parFragments: [] as ParFragment[], totalHeight: HEADER_HEIGHT + 100 };
    }

    const allMessages: DiagramMessage[] = [];
    const fragments: ParFragment[] = [];
    let currentY = HEADER_HEIGHT + 20;
    const groups = groupEventsByTimestamp(filtered);
    const calloutState: { lastEndpoint?: string } = {};

    for (const group of groups) {
      const byLog = new Map<string, LogEvent[]>();
      for (const e of group) {
        const lid = e.sourceLogId || '';
        if (!byLog.has(lid)) byLog.set(lid, []);
        byLog.get(lid)!.push(e);
      }

      if (byLog.size > 1) {
        currentY = layoutParFragment(byLog, selectedLogs, currentY, allMessages, fragments, calloutState);
      } else {
        const { messages: seqMsgs, endY } = layoutMessages(group, currentY, calloutState);
        allMessages.push(...seqMsgs);
        currentY = endY;
      }
    }

    return { messages: allMessages, parFragments: fragments, totalHeight: currentY + 40 };
  }, [events, filter, selectedLogs]);

  // Zoom controls
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.25, 3)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.25, 0.25)), []);
  const handleZoomReset = useCallback(() => setZoom(1), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '=') { e.preventDefault(); handleZoomIn(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); handleZoomOut(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); handleZoomReset(); }
    };
    globalThis.addEventListener('keydown', handler);
    return () => globalThis.removeEventListener('keydown', handler);
  }, [handleZoomIn, handleZoomOut, handleZoomReset]);

  if (selectedLogs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-dim)] text-sm">
        No logs selected
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-dim)] text-sm gap-2">
        <span>No {filter === 'significant' ? 'significant ' : ''}events to display</span>
        {filter === 'significant' && (
          <button
            onClick={() => setFilter('all')}
            className="px-3 py-1 text-xs bg-[var(--surface2)] text-[var(--accent)] border border-[var(--border)] rounded-md hover:bg-[var(--border)] cursor-pointer transition-colors"
          >
            Show all events
          </button>
        )}
      </div>
    );
  }

  const activationBars = computeActivationBars(messages);
  const baseTimestamp = messages.length > 0 ? messages[0].event.absoluteTimestamp : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Controls */}
      <div className="flex flex-col bg-[var(--surface)] border-b border-[var(--border)]">
        <div className="flex items-center gap-3 px-5 py-2">
          <span className="text-xs text-[var(--text-dim)]">Events:</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'significant')}
            className="px-2.5 py-1 bg-[var(--surface2)] border border-[var(--border)] rounded-md text-[var(--text)] text-xs outline-none cursor-pointer"
          >
            <option value="significant">Significant only</option>
            <option value="all">All events</option>
          </select>
          <span className="text-xs text-[var(--text-dim)]">
            {messages.length} events · {parFragments.length} par fragment{parFragments.length === 1 ? '' : 's'}
          </span>
          <span className="flex-1" />
          <span className="text-xs text-[var(--text-dim)]">Zoom:</span>
          <button onClick={handleZoomOut} className="w-6 h-6 flex items-center justify-center bg-[var(--surface2)] border border-[var(--border)] rounded text-[var(--text)] text-xs hover:bg-[var(--border)] cursor-pointer transition-colors">-</button>
          <span className="text-xs text-[var(--text)] min-w-[40px] text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} className="w-6 h-6 flex items-center justify-center bg-[var(--surface2)] border border-[var(--border)] rounded text-[var(--text)] text-xs hover:bg-[var(--border)] cursor-pointer transition-colors">+</button>
          <button onClick={handleZoomReset} className="px-2 py-0.5 bg-[var(--surface2)] border border-[var(--border)] rounded text-[var(--text)] text-xs hover:bg-[var(--border)] cursor-pointer transition-colors">Reset</button>
        </div>
      </div>

      {/* Diagram */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        <svg
          width={diagramWidth * zoom}
          height={totalHeight * zoom}
          viewBox={`0 0 ${diagramWidth} ${totalHeight}`}
          style={{ minWidth: '100%' }}
        >
          <rect width={diagramWidth} height={totalHeight} fill="var(--bg)" />

          {/* ── Participant: Client ── */}
          <rect x={CLIENT_X - 60} y={8} width={120} height={40} rx={6}
            fill="#6c8cff" fillOpacity={0.15} stroke="#6c8cff" strokeWidth={1.5}
          />
          <text x={CLIENT_X} y={32} textAnchor="middle" fill="#6c8cff"
            fontSize={12} fontWeight={600} fontFamily="system-ui"
          >
            {clientLabel}
          </text>
          <line x1={CLIENT_X} y1={HEADER_HEIGHT} x2={CLIENT_X} y2={totalHeight}
            stroke="#6c8cff" strokeWidth={1} strokeDasharray="6 4" opacity={0.3}
          />

          {/* ── Participant: Salesforce (Server) ── */}
          <rect x={SERVER_X - 60} y={8} width={120} height={40} rx={6}
            fill="#4ecdc4" fillOpacity={0.15} stroke="#4ecdc4" strokeWidth={1.5}
          />
          <text x={SERVER_X} y={32} textAnchor="middle" fill="#4ecdc4"
            fontSize={12} fontWeight={600} fontFamily="system-ui"
          >
            Salesforce
          </text>
          <line x1={SERVER_X} y1={HEADER_HEIGHT} x2={SERVER_X} y2={totalHeight}
            stroke="#4ecdc4" strokeWidth={1} strokeDasharray="6 4" opacity={0.3}
          />

          {/* ── Participant: External Service endpoints ── */}
          {calloutEndpoints.map((ep) => {
            const epX = endpointXMap.get(ep) || ENDPOINT_START_X;
            const displayLabel = ep.length > 20 ? ep.substring(0, 17) + '...' : ep;
            return (
              <g key={`participant-${ep}`}>
                <rect x={epX - 70} y={8} width={140} height={40} rx={6}
                  fill="#fb923c" fillOpacity={0.15} stroke="#fb923c" strokeWidth={1.5}
                />
                <text x={epX} y={26} textAnchor="middle" fill="#fb923c"
                  fontSize={10} fontWeight={600} fontFamily="system-ui"
                >
                  {displayLabel}
                </text>
                <text x={epX} y={40} textAnchor="middle" fill="#fb923c"
                  fontSize={8} fontFamily="system-ui" opacity={0.6}
                >
                  External
                </text>
                <line x1={epX} y1={HEADER_HEIGHT} x2={epX} y2={totalHeight}
                  stroke="#fb923c" strokeWidth={1} strokeDasharray="6 4" opacity={0.3}
                />
              </g>
            );
          })}

          {/* ── Activation bars on server lifeline ── */}
          {activationBars.map((bar) => (
            <rect
              key={`act-${bar.yStart}-${bar.yEnd}`}
              x={SERVER_X - ACTIVATION_WIDTH / 2}
              y={bar.yStart - 4}
              width={ACTIVATION_WIDTH}
              height={bar.yEnd - bar.yStart + MSG_HEIGHT}
              rx={2}
              fill={bar.color} fillOpacity={0.12}
              stroke={bar.color} strokeWidth={0.8} strokeOpacity={0.4}
            />
          ))}

          {/* ── Par fragments ── */}
          {parFragments.map((frag) => (
            <g key={`par-${frag.yStart}`}>
              {/* Fragment frame */}
              <rect
                x={LEFT_MARGIN} y={frag.yStart}
                width={diagramWidth - LEFT_MARGIN - 40}
                height={frag.yEnd - frag.yStart}
                fill="transparent" stroke="#ffd93d" strokeWidth={1.5} opacity={0.6}
              />
              {/* "par" label tab */}
              <polygon
                points={`${LEFT_MARGIN},${frag.yStart} ${LEFT_MARGIN + 50},${frag.yStart} ${LEFT_MARGIN + 60},${frag.yStart + PAR_LABEL_HEIGHT / 2} ${LEFT_MARGIN + 50},${frag.yStart + PAR_LABEL_HEIGHT} ${LEFT_MARGIN},${frag.yStart + PAR_LABEL_HEIGHT}`}
                fill="#ffd93d" fillOpacity={0.15} stroke="#ffd93d" strokeWidth={1} opacity={0.7}
              />
              <text
                x={LEFT_MARGIN + 8} y={frag.yStart + PAR_LABEL_HEIGHT - 6}
                fill="#ffd93d" fontSize={11} fontWeight={700} fontFamily="system-ui"
              >
                par
              </text>

              {/* Section dividers and labels */}
              {frag.sections.map((section, si) => (
                <g key={`section-${section.logId}`}>
                  {si > 0 && (
                    <line
                      x1={LEFT_MARGIN} y1={section.yStart}
                      x2={diagramWidth - 40} y2={section.yStart}
                      stroke="#ffd93d" strokeWidth={1} strokeDasharray="8 4" opacity={0.5}
                    />
                  )}
                  <text
                    x={LEFT_MARGIN + 8}
                    y={section.yStart + (si > 0 ? SECTION_DIVIDER_HEIGHT - 4 : PAR_LABEL_HEIGHT + 12)}
                    fill={section.logColor} fontSize={9} fontWeight={500}
                    fontFamily="system-ui" opacity={0.9}
                  >
                    [{section.logName.length > 50 ? section.logName.substring(0, 47) + '...' : section.logName}]
                  </text>
                </g>
              ))}
            </g>
          ))}

          {/* ── Messages (arrows) ── */}
          {messages.map((msg, idx) => {
            const isHovered = hoveredIdx === idx;
            const arrowY = msg.y + MSG_HEIGHT / 2;

            return (
              <g
                key={`${msg.sourceLogId}-${msg.event.lineNum}`}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                onClick={() => onSelectEvent(msg.event)}
                style={{ cursor: 'pointer' }}
              >
                {renderArrow(msg, arrowY, isHovered, endpointXMap)}

                {/* Async dispatch badge */}
                {msg.asyncType && (() => {
                  const asyncColor = msg.asyncType === 'future' ? '#fb923c' : '#c084fc';
                  const asyncLabel = msg.asyncType === 'future' ? '⚡ future' : '⚡ queueable';
                  const badgeWidth = msg.asyncType === 'future' ? 52 : 70;
                  const badgeX = msg.direction === 'self-server'
                    ? SERVER_X + 68
                    : msg.direction === 'client-to-server'
                      ? (CLIENT_X + SERVER_X) / 2
                      : (CLIENT_X + SERVER_X) / 2;
                  const badgeY = arrowY + 6;
                  return (
                    <g>
                      <rect
                        x={badgeX - badgeWidth / 2} y={badgeY}
                        width={badgeWidth} height={14} rx={7}
                        fill={asyncColor} fillOpacity={0.2}
                        stroke={asyncColor} strokeWidth={0.8} strokeOpacity={0.6}
                      />
                      <text
                        x={badgeX} y={badgeY + 10}
                        textAnchor="middle" fill={asyncColor}
                        fontSize={8} fontWeight={600} fontFamily="system-ui"
                      >
                        {asyncLabel}
                      </text>
                    </g>
                  );
                })()}

                {/* Relative elapsed time */}
                {(() => {
                  const timeText = formatRelativeMs(msg.event.absoluteTimestamp - baseTimestamp);
                  const textWidth = timeText.length * 5.6 + 8;
                  return (
                    <>
                      <rect
                        x={LEFT_MARGIN - 4 - textWidth} y={arrowY - 8}
                        width={textWidth} height={16} rx={4}
                        fill={isHovered ? 'var(--surface-hover, rgba(255,255,255,0.12))' : 'transparent'}
                      />
                      <text
                        x={LEFT_MARGIN - 8} y={arrowY + 4}
                        textAnchor="end" fill="var(--text-dim)"
                        fontSize={10} fontFamily="'SF Mono', 'Cascadia Code', 'Fira Code', monospace"
                        fontWeight={isHovered ? 600 : 400}
                        opacity={isHovered ? 1 : 0.65}
                      >
                        {timeText}
                      </text>
                    </>
                  );
                })()}

                {/* Source log color indicator */}
                <circle
                  cx={LEFT_MARGIN - 8} cy={arrowY - 7} r={3}
                  fill={msg.sourceColor} opacity={isHovered ? 1 : 0.5}
                />

                {/* Hover tooltip */}
                {isHovered && (
                  <g>
                    <rect
                      x={CLIENT_X + 10} y={msg.y - 18}
                      width={Math.min(msg.sourceLogName.length * 6 + msg.event.eventType.length * 6 + 60, 400)}
                      height={16} rx={3}
                      fill="var(--surface)" stroke="var(--border)" strokeWidth={1}
                    />
                    <text
                      x={CLIENT_X + 16} y={msg.y - 7}
                      fill="var(--text)" fontSize={9} fontFamily="system-ui"
                    >
                      {msg.sourceLogName} · {msg.event.eventType} · Line {msg.event.lineNum}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
