import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import type { LogEvent, LoadedLog } from '../types';
import { isAsyncDispatch } from '../logParser';

interface Props {
  readonly events: LogEvent[];
  readonly logs: LoadedLog[];
  readonly onSelectEvent: (event: LogEvent) => void;
}

// ── Salesforce subsystem participants ──
interface SFSubsystem {
  id: string;
  label: string;
  color: string;
  eventMatcher: (eventType: string) => boolean;
}

const SF_SUBSYSTEMS: SFSubsystem[] = [
  {
    id: 'code',
    label: 'Code',
    color: '#8b90a0',
    eventMatcher: (et) => /CODE_UNIT|METHOD_ENTRY|METHOD_EXIT|CONSTRUCTOR/.test(et),
  },
  {
    id: 'soql',
    label: 'SOQL',
    color: '#60a5fa',
    eventMatcher: (et) => /SOQL|SOSL/.test(et),
  },
  {
    id: 'dml',
    label: 'DML',
    color: '#4ecdc4',
    eventMatcher: (et) => /DML/.test(et),
  },
  {
    id: 'flow',
    label: 'Flow',
    color: '#c084fc',
    eventMatcher: (et) => /FLOW/.test(et),
  },
  {
    id: 'trigger',
    label: 'Trigger',
    color: '#f472b6',
    eventMatcher: (et) => /TRIGGER/.test(et),
  },
  {
    id: 'validation',
    label: 'Validation',
    color: '#fbbf24',
    eventMatcher: (et) => /VALIDATION/.test(et),
  },
  {
    id: 'debug',
    label: 'Debug',
    color: '#ffd93d',
    eventMatcher: (et) => et === 'USER_DEBUG',
  },
  {
    id: 'error',
    label: 'Error',
    color: '#ff6b6b',
    eventMatcher: (et) => /EXCEPTION|FATAL|ERROR/.test(et),
  },
];

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

/** Determine which SF subsystem an event belongs to */
function getSFSubsystem(eventType: string): string {
  for (const sys of SF_SUBSYSTEMS) {
    if (sys.eventMatcher(eventType)) return sys.id;
  }
  return 'other';
}

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

/** Arrow source and target: either "client", "sf:<subsystem>", or "external:<endpoint>" */
type ArrowSource = string; // "client" or "sf:code" etc
type ArrowTarget = string; // "sf:code" or "external:endpoint" etc

function getArrowRoute(eventType: string): { source: ArrowSource; target: ArrowTarget } {
  if (/EXECUTION_STARTED/.test(eventType)) {
    return { source: 'client', target: 'sf:code' };
  }
  if (/EXECUTION_FINISHED/.test(eventType)) {
    return { source: 'sf:code', target: 'client' };
  }
  if (/CALLOUT_REQUEST/.test(eventType)) {
    const sfSys = getSFSubsystem(eventType);
    return { source: `sf:${sfSys}`, target: 'external' }; // target filled at render time
  }
  if (/CALLOUT_RESPONSE/.test(eventType)) {
    return { source: 'external', target: 'sf:code' }; // source filled at render time
  }
  // Self-messages on a Salesforce subsystem
  const sfSys = getSFSubsystem(eventType);
  return { source: `sf:${sfSys}`, target: `sf:${sfSys}` };
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
  const sfSys = getSFSubsystem(eventType);
  const subsys = SF_SUBSYSTEMS.find((s) => s.id === sfSys);
  if (subsys && sfSys !== 'other') return subsys.color;
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

/** Participant metadata for layout and rendering */
interface Participant {
  id: string; // "client", "sf:code", "external:endpoint"
  label: string;
  color: string;
  x: number; // computed layout position
  isSFSubsystem?: boolean;
}

// ── Layout types ──
interface DiagramMessage {
  event: LogEvent;
  y: number;
  label: string;
  color: string;
  sourceParticipant: string; // participant ID
  targetParticipant: string; // participant ID
  calloutEndpoint?: string; // for callout requests/responses
  isError: boolean;
  sourceLogId: string;
  sourceLogName: string;
  sourceColor: string;
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
const SF_START_X = 280; // First Salesforce subsystem column
const SF_COLUMN_WIDTH = 140; // Width allocated to each SF subsystem column
const ENDPOINT_START_X = 1200; // External services start after all SF subsystems
const ENDPOINT_SPACING = 200;
const MSG_HEIGHT = 32;
const MSG_GAP = 4;
const LEFT_MARGIN = 60;
const BASE_DIAGRAM_WIDTH = 1400;
const PAR_PADDING = 12;
const PAR_LABEL_HEIGHT = 22;
const SECTION_DIVIDER_HEIGHT = 20;
const ACTIVATION_WIDTH = 12;

/** Build participant map from active events */
function buildParticipantMap(events: LogEvent[]): Map<string, Participant> {
  const map = new Map<string, Participant>();
  
  // Client participant
  map.set('client', { id: 'client', label: 'Client', color: '#6c8cff', x: CLIENT_X });
  
  // Collect active SF subsystems
  const activeSFSystems = new Set<string>();
  const externalEndpoints = new Set<string>();
  for (const e of events) {
    const sfSys = getSFSubsystem(e.eventType);
    if (sfSys !== 'other') activeSFSystems.add(sfSys);
    if (e.eventType === 'CALLOUT_REQUEST') {
      externalEndpoints.add(extractCalloutEndpoint(e.detail));
    }
  }
  
  // Create SF subsystem participants
  let sfX = SF_START_X;
  for (const sys of SF_SUBSYSTEMS) {
    if (activeSFSystems.has(sys.id)) {
      map.set(`sf:${sys.id}`, {
        id: `sf:${sys.id}`,
        label: sys.label,
        color: sys.color,
        x: sfX,
        isSFSubsystem: true,
      });
      sfX += SF_COLUMN_WIDTH;
    }
  }
  
  // Create external endpoint participants
  let epX = ENDPOINT_START_X;
  for (const ep of externalEndpoints) {
    map.set(`external:${ep}`, {
      id: `external:${ep}`,
      label: ep,
      color: '#fb923c',
      x: epX,
    });
    epX += ENDPOINT_SPACING;
  }
  
  return map;
}

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
    const route = getArrowRoute(e.eventType);
    let calloutEndpoint: string | undefined;
    let sourceParticipant = route.source;
    let targetParticipant = route.target;
    
    if (/CALLOUT_REQUEST/.test(e.eventType)) {
      calloutEndpoint = extractCalloutEndpoint(e.detail);
      calloutState.lastEndpoint = calloutEndpoint;
      const sfSys = getSFSubsystem(e.eventType);
      sourceParticipant = `sf:${sfSys}`;
      targetParticipant = `external:${calloutEndpoint}`;
    } else if (/CALLOUT_RESPONSE/.test(e.eventType)) {
      calloutEndpoint = calloutState.lastEndpoint || extractCalloutEndpoint(e.detail);
      sourceParticipant = `external:${calloutEndpoint}`;
      targetParticipant = `sf:code`; // responses come back to code
    }
    
    messages.push({
      event: e,
      y,
      label: shortLabel(e),
      color: eventColor(e.eventType),
      sourceParticipant,
      targetParticipant,
      calloutEndpoint,
      isError: e.level === 'ERROR' || e.level === 'FATAL',
      sourceLogId: e.sourceLogId || '',
      sourceLogName: e.sourceLogName || '',
      sourceColor: e.sourceColor || '#6c8cff',
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

/** Compute activation bars for each log on each SF subsystem it touches */
function computeActivationBars(
  msgs: DiagramMessage[],
): { participantId: string; yStart: number; yEnd: number; color: string }[] {
  type ActivationKey = `${string}|${string}`; // "logId|participantId"
  const bars = new Map<ActivationKey, { yStart: number; yEnd: number; color: string; participantId: string }>();
  
  for (const msg of msgs) {
    // Track activations on the source participant if it's a SF subsystem
    if (msg.sourceParticipant.startsWith('sf:')) {
      const key: ActivationKey = `${msg.sourceLogId}|${msg.sourceParticipant}`;
      const existing = bars.get(key);
      if (existing) {
        existing.yEnd = Math.max(existing.yEnd, msg.y);
      } else {
        bars.set(key, { yStart: msg.y, yEnd: msg.y, color: msg.sourceColor, participantId: msg.sourceParticipant });
      }
    }
  }
  
  return [...bars.values()];
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

/** Render an arrow based on source and target participants */
function renderArrow(
  msg: DiagramMessage,
  arrowY: number,
  isHovered: boolean,
  participants: Map<string, Participant>,
) {
  const sourceParticipant = participants.get(msg.sourceParticipant);
  const targetParticipant = participants.get(msg.targetParticipant);
  if (!sourceParticipant || !targetParticipant) return null;

  const color = msg.isError ? '#ff6b6b' : msg.color;
  const opacity = isHovered ? 1 : 0.7;
  const strokeW = isHovered ? 1.8 : 1.2;
  const truncLabel = msg.label.length > 50
    ? msg.label.substring(0, 47) + '...'
    : msg.label;

  // Self-message (on same participant)
  if (msg.sourceParticipant === msg.targetParticipant) {
    const loopWidth = 60;
    const loopHeight = 14;
    const arrowSize = 7;
    const x = sourceParticipant.x;
    return (
      <g>
        <polyline
          points={`${x},${arrowY - loopHeight / 2} ${x + loopWidth},${arrowY - loopHeight / 2} ${x + loopWidth},${arrowY + loopHeight / 2} ${x + arrowSize},${arrowY + loopHeight / 2}`}
          fill="none" stroke={color} strokeWidth={strokeW} opacity={opacity}
        />
        <polygon
          points={`${x},${arrowY + loopHeight / 2} ${x + arrowSize},${arrowY + loopHeight / 2 - arrowSize / 2} ${x + arrowSize},${arrowY + loopHeight / 2 + arrowSize / 2}`}
          fill={color} opacity={opacity}
        />
        <text
          x={x + loopWidth + 6} y={arrowY + 3}
          fill={color} fontSize={9} fontWeight={500} fontFamily="system-ui" opacity={opacity}
        >
          {truncLabel}
        </text>
      </g>
    );
  }

  // Message between participants
  return renderArrowBetween({
    fromX: sourceParticipant.x,
    toX: targetParticipant.x,
    arrowY,
    color,
    opacity,
    strokeW,
    label: truncLabel,
    dashed: msg.targetParticipant.startsWith('client') || /RESPONSE|external-to/.test(msg.event.eventType),
  });
}

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

  // Build diagram layout
  const { messages, participants, parFragments, totalHeight, diagramWidth, activationBars } = useMemo(() => {
    const filtered = (filter === 'significant'
      ? events.filter((e) => SIGNIFICANT_EVENTS.has(e.eventType))
      : events
    );

    if (filtered.length === 0 || selectedLogs.length === 0) {
      return {
        messages: [] as DiagramMessage[],
        participants: new Map<string, Participant>(),
        parFragments: [] as ParFragment[],
        totalHeight: HEADER_HEIGHT + 100,
        diagramWidth: BASE_DIAGRAM_WIDTH,
        activationBars: [] as { participantId: string; yStart: number; yEnd: number; color: string }[],
      };
    }

    // Build participant map
    const participants = buildParticipantMap(filtered);
    
    // Compute diagram width based on rightmost participant
    let maxX = CLIENT_X;
    for (const p of participants.values()) {
      maxX = Math.max(maxX, p.x + 100);
    }
    const diagramWidth = Math.max(BASE_DIAGRAM_WIDTH, maxX + 120);

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

    const activationBars = computeActivationBars(allMessages);
    return {
      messages: allMessages,
      participants,
      parFragments: fragments,
      totalHeight: currentY + 40,
      diagramWidth,
      activationBars,
    };
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

          {/* ── Participants ── */}
          {Array.from(participants.values()).map((p) => {
            const displayLabel = p.label.length > 20 ? p.label.substring(0, 17) + '...' : p.label;
            return (
              <g key={`participant-${p.id}`}>
                <rect x={p.x - 60} y={8} width={120} height={40} rx={6}
                  fill={p.color} fillOpacity={0.15} stroke={p.color} strokeWidth={1.5}
                />
                <text x={p.x} y={32} textAnchor="middle" fill={p.color}
                  fontSize={12} fontWeight={600} fontFamily="system-ui"
                >
                  {p.id === 'client' ? clientLabel : displayLabel}
                </text>
                <line x1={p.x} y1={HEADER_HEIGHT} x2={p.x} y2={totalHeight}
                  stroke={p.color} strokeWidth={1} strokeDasharray="6 4" opacity={0.3}
                />
              </g>
            );
          })}

          {/* ── Activation bars ── */}
          {activationBars.map((bar) => {
            const participant = participants.get(bar.participantId);
            if (!participant) return null;
            return (
              <rect
                key={`act-${bar.participantId}-${bar.yStart}-${bar.yEnd}`}
                x={participant.x - ACTIVATION_WIDTH / 2}
                y={bar.yStart - 4}
                width={ACTIVATION_WIDTH}
                height={bar.yEnd - bar.yStart + MSG_HEIGHT}
                rx={2}
                fill={bar.color} fillOpacity={0.12}
                stroke={bar.color} strokeWidth={0.8} strokeOpacity={0.4}
              />
            );
          })}

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
                {renderArrow(msg, arrowY, isHovered, participants)}

                {/* Async dispatch badge */}
                {msg.asyncType && (() => {
                  const asyncColor = msg.asyncType === 'future' ? '#fb923c' : '#c084fc';
                  const asyncLabel = msg.asyncType === 'future' ? '⚡ future' : '⚡ queueable';
                  const badgeWidth = msg.asyncType === 'future' ? 52 : 70;
                  const sourceParticipant = participants.get(msg.sourceParticipant);
                  const targetParticipant = participants.get(msg.targetParticipant);
                  if (!sourceParticipant || !targetParticipant) return null;
                  const badgeX = (sourceParticipant.x + targetParticipant.x) / 2;
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
                  const timeText = `+${Math.round(msg.event.absoluteTimestamp - baseTimestamp)} ms`;
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
