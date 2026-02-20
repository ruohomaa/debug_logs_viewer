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
  eventMatcher: (event: LogEvent) => boolean;
  isDynamic?: boolean;
}

const SF_SUBSYSTEMS: SFSubsystem[] = [
  {
    id: 'aura',
    label: 'Aura/LWC',
    color: '#0ea5e9',
    eventMatcher: (e) => /AuraDefinitionBundle|LightningController|ComponentController/i.test(e.detail) || /AURA/.test(e.eventType),
  },
  // 'code' subsystem removed in favor of dynamic participants
  {
    id: 'soql',
    label: 'SOQL',
    color: '#60a5fa',
    eventMatcher: (e) => /SOQL|SOSL/.test(e.eventType),
  },
  {
    id: 'dml',
    label: 'DML',
    color: '#4ecdc4',
    eventMatcher: (e) => /DML/.test(e.eventType),
  },
  {
    id: 'flow',
    label: 'Flow',
    color: '#c084fc',
    eventMatcher: (e) => /FLOW/.test(e.eventType),
  },
  // Trigger is also dynamic now usually, but we keep it if not caught by stack
  {
    id: 'validation',
    label: 'Validation',
    color: '#fbbf24',
    eventMatcher: (e) => /VALIDATION/.test(e.eventType),
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
  // 'SOQL_EXECUTE_BEGIN', // Too noisy, showing END with row count instead
  'SOQL_EXECUTE_END',
  // 'SOSL_EXECUTE_BEGIN', // Too noisy
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
  // 'VALIDATION_FORMULA', // Too noisy
  'VF_PAGE_MESSAGE',
  'LIMIT_USAGE_FOR_NS',
]);

const PARALLEL_TOLERANCE_MS = 1;

/** Determine which SF subsystem an event belongs to */
function getSFSubsystem(event: LogEvent): string {
  for (const sys of SF_SUBSYSTEMS) {
    if (sys.eventMatcher(event)) return sys.id;
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

/** Extract a participant name from a start event */
function extractParticipantName(event: LogEvent): string | null {
  if (event.eventType === 'CODE_UNIT_STARTED') {
    // e.g. "CODE_UNIT_STARTED|[EXTERNAL]|01q...|Description"
    // or "CODE_UNIT_STARTED|[EXTERNAL]|trigger:AccountTrigger on Account trigger event BeforeInsert|__sfdc_trigger/AccountTrigger"
    // Usually the last part is the name or description.
    const parts = event.detail.split('|');
    const name = parts.at(-1) || event.detail;
    // Clean up
    return name.replace(/^__sfdc_trigger\//, '');
  }
  if (event.eventType === 'METHOD_ENTRY' || event.eventType === 'CONSTRUCTOR_ENTRY') {
    // e.g. "METHOD_ENTRY|[1]|01p...|Class.Method"
    const parts = event.detail.split('|');
    const name = parts.at(-1) || event.detail;
    return name;
  }
  return null;
}

// Short labels for event types
function shortLabel(e: LogEvent): string {
  if (e.eventType === 'CODE_UNIT_STARTED' || e.eventType === 'METHOD_ENTRY' || e.eventType === 'CONSTRUCTOR_ENTRY') {
    const name = extractParticipantName(e);
    return name ? `${name}()` : e.eventType;
  }
  
  const d = e.detail.split('\n')[0];
  switch (e.eventType) {
    case 'CODE_UNIT_FINISHED':
    case 'METHOD_EXIT': 
    case 'CONSTRUCTOR_EXIT':
      return ''; // No label on return arrows usually
    case 'DML_BEGIN':
    case 'DML_END':
      return `DML: ${d.split('|').slice(1).join(' ').substring(0, 50)}`;
    case 'SOQL_EXECUTE_END': {
      // Format: [Elem]|Rows:X
      const match = /Rows:(\d+)/.exec(d);
      return match ? `SOQL: ${match[1]} rows` : 'SOQL Query';
    }
    case 'SOSL_EXECUTE_END': {
      const match = /Rows:(\d+)/.exec(d);
      return match ? `SOSL: ${match[1]} rows` : 'SOSL Query';
    }
    case 'USER_DEBUG':
      return `DEBUG: ${d.split('|').pop()?.substring(0, 50) || d.substring(0, 50)}`;
    case 'EXCEPTION_THROWN':
    case 'FATAL_ERROR':
      return d.substring(0, 60);
    case 'VALIDATION_RULE': {
      // Format: ID|RuleName
      const parts = d.split('|');
      return parts.length > 1 ? parts[1].substring(0, 50) : d.substring(0, 50);
    }
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
function eventColor(event: LogEvent): string {
  const sfSys = getSFSubsystem(event);
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

interface LayoutContext {
  selectedLogs: LoadedLog[];
  allMessages: DiagramMessage[];
  fragments: ParFragment[];
  calloutState: { lastEndpoint?: string };
  soqlQueries: Map<string, string> | undefined;
  eventRoutes: Map<LogEvent, { source: string; target: string }>;
}

const ACTIVATION_WIDTH = 12;

/** 
 * Build dynamic call stack and participant map.
 * Returns:
 * - routes: Map of event -> { source, target }
 * - participants: Map of participantId -> Participant info
 */
function analyzeCallStack(events: LogEvent[]): {
  routes: Map<LogEvent, { source: string; target: string }>;
  participants: Map<string, Participant>;
} {
  const routes = new Map<LogEvent, { source: string; target: string }>();
  const participants = new Map<string, Participant>();
  
  // Per-log stack state
  const logStacks = new Map<string, string[]>(); // logId -> stack of participant IDs

  // Ensure "client" exists
  participants.set('client', { id: 'client', label: 'Client', color: '#6c8cff', x: CLIENT_X });

  // Process events in chronological order (assuming they are sorted)
  for (const e of events) {
    const logId = e.sourceLogId || 'main';
    if (!logStacks.has(logId)) {
      logStacks.set(logId, ['client']);
    }
    const stack = logStacks.get(logId)!;
    const currentParticipant = stack[stack.length - 1];

    // Determine if this event starts/ends a new context
    if (e.eventType === 'CODE_UNIT_STARTED' || e.eventType === 'METHOD_ENTRY' || e.eventType === 'CONSTRUCTOR_ENTRY') {
      const name = extractParticipantName(e);
      if (name) {
        const participantId = `dynamic:${name}`;
        
        // Register participant if new
        if (!participants.has(participantId)) {
          participants.set(participantId, {
            id: participantId,
            label: name,
            color: e.eventType === 'CODE_UNIT_STARTED' ? '#f472b6' : '#8b90a0', // Pink for triggers/units, Grey for methods
            x: 0, // Placeholder, will layout later
          });
        }
        
        // Route: Caller -> New Participant
        routes.set(e, { source: currentParticipant, target: participantId });
        
        // Push to stack
        stack.push(participantId);
        continue;
      }
    } else if (e.eventType === 'CODE_UNIT_FINISHED' || e.eventType === 'METHOD_EXIT' || e.eventType === 'CONSTRUCTOR_EXIT') {
       // Pop from stack
       // Ideally we check if it matches the top, but for now just pop
       if (stack.length > 1) { // Don't pop client
         const finishedParticipant = stack.pop()!;
         const returnTo = stack[stack.length - 1];
         routes.set(e, { source: finishedParticipant, target: returnTo });
         continue;
       }
    }

    // Default routing (System events, Debug, etc)
    // If it's a known system event, route accordingly
    const sfSys = getSFSubsystem(e);
    if (sfSys !== 'other' && !['code', 'trigger'].includes(sfSys)) {
         // It's a system event like DML or SOQL
         // Current participant calls System
         const sysId = `sf:${sfSys}`;
         // We treat this as a self-contained call usually? 
         // Or as "Event on current participant"?
         // Current logic says:
         // DML_BEGIN: ? -> ?
         // If we want DML to have a column: Current -> DML
         routes.set(e, { source: currentParticipant, target: sysId });
         continue;
    }

    // Regular event (DEBUG, etc) on the current participant
    routes.set(e, { source: currentParticipant, target: currentParticipant });
  }

  return { routes, participants };
}

/** Build participant map from active events */
function buildParticipantMap(
  events: LogEvent[], 
  dynamicParticipants: Map<string, Participant>
): Map<string, Participant> {
  const map = new Map<string, Participant>();
  
  // Start with Client (already in dynamicParticipants usually, but ensure order)
  map.set('client', dynamicParticipants.get('client')!);

  // Collect active SF subsystems (excluding code/trigger if we want dynamic only)
  // Actually, we want to mix dynamic participants with fixed system ones?
  // Let's take ALL dynamic participants first, then add active system ones.
  
  // Actually, better to just merge.
  // We need to determine X positions.
  
  let currentX = CLIENT_X + SF_COLUMN_WIDTH; // Start after Client

  // Add all dynamic code/method participants
  for (const [id, p] of dynamicParticipants) {
    if (id === 'client') continue;
    // Update X
    map.set(id, { ...p, x: currentX });
    currentX += SF_COLUMN_WIDTH;
  }

  // Add system participants if used and not already covered?
  const activeSFSystems = new Set<string>();
  for (const e of events) {
    const sfSys = getSFSubsystem(e);
    if (sfSys !== 'other' && !['code', 'trigger'].includes(sfSys)) {
        activeSFSystems.add(sfSys);
    }
  }

  // Create SF subsystem participants (DML, SOQL, etc)
  for (const sys of SF_SUBSYSTEMS) {
    if (activeSFSystems.has(sys.id)) {
      map.set(`sf:${sys.id}`, {
        id: `sf:${sys.id}`,
        label: sys.label,
        color: sys.color,
        x: currentX,
        isSFSubsystem: true,
      });
      currentX += SF_COLUMN_WIDTH;
    }
  }
  
  // Create external endpoint participants
  const externalEndpoints = new Set<string>();
  for (const e of events) {
      if (e.eventType === 'CALLOUT_REQUEST') {
          externalEndpoints.add(extractCalloutEndpoint(e.detail));
      }
  }

  let epX = Math.max(ENDPOINT_START_X, currentX + 50);
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
  soqlQueries: Map<string, string> | undefined,
  eventRoutes: Map<LogEvent, { source: string; target: string }>,
): { messages: DiagramMessage[]; endY: number } {
  const messages: DiagramMessage[] = [];
  let y = startY;
  for (const e of logEvents) {
    // Unique key for event lookup in routes - simple ref check if same obj, otherwise need ID
    // We can use a WeakMap if we pass objects, or Map<LogEvent, ...>
    // Just using the event object as key in a Map work fine if references are stable.
    // However, here we passed `eventRoutes` as Map<string, ...>. Let's use Map<LogEvent, ...>
    
    // Fallback route if not in stack
    let route = eventRoutes.get(e);
    if (!route) {
      // Fallback: simple default routing
      const sfSys = getSFSubsystem(e);
      if (sfSys !== 'other') {
        route = { source: `sf:${sfSys}`, target: `sf:${sfSys}` };
      } else {
        // Default to client
        route = { source: 'client', target: 'client' };
      }
    }
    
    let calloutEndpoint: string | undefined;
    let sourceParticipant = route.source;
    let targetParticipant = route.target;
    
    if (/CALLOUT_REQUEST/.test(e.eventType)) {
      calloutEndpoint = extractCalloutEndpoint(e.detail);
      calloutState.lastEndpoint = calloutEndpoint;
      const sfSys = getSFSubsystem(e);
      sourceParticipant = `sf:${sfSys}`;
      targetParticipant = `external:${calloutEndpoint}`;
    } else if (/CALLOUT_RESPONSE/.test(e.eventType)) {
      calloutEndpoint = calloutState.lastEndpoint || extractCalloutEndpoint(e.detail);
      sourceParticipant = `external:${calloutEndpoint}`;
      targetParticipant = `sf:code`; // responses come back to code
    }

    let label = shortLabel(e);
    if (e.eventType === 'SOQL_EXECUTE_END' && soqlQueries) {
      const lid = e.sourceLogId || '';
      const query = soqlQueries.get(`${lid}:${e.lineNum}`);
      if (query) {
        // Extract rows
        const match = /Rows:(\d+)/.exec(e.detail);
        const rows = match ? match[1] : '?';
        // Extract clean query
        // typically "SOQL_EXECUTE_BEGIN|Aggregations:0|SELECT ..."
        let cleanQuery = query;
        if (cleanQuery.includes('|SELECT')) {
            cleanQuery = cleanQuery.substring(cleanQuery.indexOf('|SELECT') + 1);
        } else if (cleanQuery.includes('SELECT')) {
            cleanQuery = cleanQuery.substring(cleanQuery.indexOf('SELECT'));
        }
        label = `SOQL: ${rows} rows - ${cleanQuery}`;
      }
    }
    
    messages.push({
      event: e,
      y,
      label,
      color: eventColor(e),
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
  currentY: number,
  ctx: LayoutContext,
): number {
  const fragYStart = currentY;
  let y = currentY + PAR_LABEL_HEIGHT;
  const sections: ParSection[] = [];
  let sectionIdx = 0;

  for (const [logId, logEvents] of byLog) {
    const log = ctx.selectedLogs.find((l) => l.id === logId);
    if (!log) continue;

    if (sectionIdx > 0) {
      y += SECTION_DIVIDER_HEIGHT;
    }

    const sectionYStart = y - (sectionIdx > 0 ? SECTION_DIVIDER_HEIGHT : 0);
    const { messages: sectionMsgs, endY } = layoutMessages(
      logEvents, 
      y, 
      ctx.calloutState, 
      ctx.soqlQueries, 
      ctx.eventRoutes
    );
    ctx.allMessages.push(...sectionMsgs);
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
  ctx.fragments.push({ yStart: fragYStart, yEnd: y, sections });
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
    // Pre-scan for SOQL query text
    const soqlQueries = new Map<string, string>(); // `${logId}:${endLineNum}` -> queryText
    const lastSoqlBegin = new Map<string, string>(); // logId -> queryText

    // Iterate sorted events to map SOQL BEGIN to END
    // We assume events are sorted by time/line.
    // If multiple logs, events are interleaved by time. But we track per logId.
    for (const e of events) {
      const lid = e.sourceLogId || '';
      if (e.eventType === 'SOQL_EXECUTE_BEGIN') {
        const d = e.detail;
        const query = d.substring(d.indexOf('Aggregations:') + 13) || d; // Extract query if messy
        lastSoqlBegin.set(lid, query);
      } else if (e.eventType === 'SOQL_EXECUTE_END') {
        const query = lastSoqlBegin.get(lid);
        if (query) {
          soqlQueries.set(`${lid}:${e.lineNum}`, query);
          lastSoqlBegin.delete(lid); // clear after use (assuming no nesting)
        }
      }
    }

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
    // First, analyze dynamic participants and call stack
    const { routes: eventRoutes, participants: dynamicParticipants } = analyzeCallStack(filtered);

    // Merge into full participant map
    const participants = buildParticipantMap(filtered, dynamicParticipants);
    
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

    const layoutCtx: LayoutContext = {
      selectedLogs,
      allMessages,
      fragments,
      calloutState,
      soqlQueries,
      eventRoutes
    };

    for (const group of groups) {
      const byLog = new Map<string, LogEvent[]>();
      for (const e of group) {
        const lid = e.sourceLogId || '';
        if (!byLog.has(lid)) byLog.set(lid, []);
        byLog.get(lid)!.push(e);
      }

      if (byLog.size > 1) {
        currentY = layoutParFragment(
          byLog,
          currentY,
          layoutCtx
        );
      } else {
        const { messages: seqMsgs, endY } = layoutMessages(
          group, 
          currentY, 
          calloutState, 
          soqlQueries,
          eventRoutes
        );
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
