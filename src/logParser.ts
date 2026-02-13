import type { LogEvent, LogLevel, LogMeta } from './types';

/**
 * Parse Salesforce debug log content into structured events.
 *
 * Salesforce debug log format:
 *   HH:MM:SS.sss (nanoseconds)|EVENT_TYPE|details...
 */
export function parseSalesforceLog(
  content: string,
  logDate?: string
): { events: LogEvent[]; meta: LogMeta } {
  const lines = content.split('\n');
  const events: LogEvent[] = [];
  let headerFinished = false;
  let apiVersion: string | undefined;
  let inferredDate = logDate;

  // Scan header for metadata
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i].trim();
    if (line.startsWith('API Version:')) {
      apiVersion = line.split(':').slice(1).join(':').trim();
    }
    const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch && !inferredDate) {
      inferredDate = dateMatch[1];
    }
  }

  if (!inferredDate) {
    inferredDate = new Date().toISOString().slice(0, 10);
  }

  // Parse event lines
  const tsRegex = /^(\d{2}:\d{2}:\d{2}\.\d+)\s*\((\d+)\)\|([A-Z_]+)\|?(.*)?$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(tsRegex);

    if (match) {
      headerFinished = true;
      const timeStr = match[1];
      const nanos = parseInt(match[2], 10);
      const eventType = match[3];
      const detail = match[4] || '';

      const level = inferLevel(eventType, detail);
      const category = categorize(eventType);

      // Compute absolute timestamp
      const parts = timeStr.split(':');
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const s = parseFloat(parts[2]);
      const secInt = Math.floor(s);
      const msInt = Math.round((s - secInt) * 1000);
      const dateObj = new Date(inferredDate + 'T00:00:00Z');
      dateObj.setUTCHours(h, m, secInt, msInt);
      const absoluteTimestamp = dateObj.getTime();

      events.push({
        lineNum: i + 1,
        timeStr,
        nanos,
        eventType,
        detail,
        level,
        category,
        raw: line,
        absoluteTimestamp,
        sortKey: absoluteTimestamp * 1e6 + nanos,
      });
    } else if (headerFinished && events.length > 0 && line.trim()) {
      // Continuation line — append to previous event
      events[events.length - 1].detail += '\n' + line;
      events[events.length - 1].raw += '\n' + line;
    }
  }

  const meta: LogMeta = {
    apiVersion,
    eventCount: events.length,
    startTime: events.length > 0 ? events[0].absoluteTimestamp : 0,
    endTime: events.length > 0 ? events[events.length - 1].absoluteTimestamp : 0,
    duration: events.length > 0
      ? events[events.length - 1].absoluteTimestamp - events[0].absoluteTimestamp
      : 0,
  };

  return { events, meta };
}

function inferLevel(eventType: string, detail: string): LogLevel {
  if (/FATAL/.test(eventType) || /FATAL/.test(detail)) return 'FATAL';
  if (/EXCEPTION|ERROR/.test(eventType)) return 'ERROR';
  if (/WARN/.test(eventType)) return 'WARN';
  if (/USER_DEBUG/.test(eventType)) {
    if (/\|ERROR\|/.test(detail)) return 'ERROR';
    if (/\|WARN\|/.test(detail)) return 'WARN';
    if (/\|INFO\|/.test(detail)) return 'INFO';
    if (/\|FINE\b/.test(detail)) return 'FINE';
    if (/\|FINER\b/.test(detail)) return 'FINER';
    if (/\|FINEST\b/.test(detail)) return 'FINEST';
    return 'DEBUG';
  }
  if (/DML|SOQL|SOSL/.test(eventType)) return 'INFO';
  return 'DEBUG';
}

function categorize(eventType: string): string {
  if (/SOQL|SOSL/.test(eventType)) return 'SOQL/SOSL';
  if (/DML/.test(eventType)) return 'DML';
  if (/CODE_UNIT|METHOD|CONSTRUCTOR|STATIC/.test(eventType)) return 'Code Unit';
  if (/CALLOUT/.test(eventType)) return 'Callout';
  if (/VALIDATION/.test(eventType)) return 'Validation';
  if (/FLOW/.test(eventType)) return 'Flow';
  if (/TRIGGER/.test(eventType)) return 'Trigger';
  if (/USER_DEBUG/.test(eventType)) return 'User Debug';
  if (/LIMIT/.test(eventType)) return 'Limits';
  if (/HEAP|CPU/.test(eventType)) return 'Performance';
  if (/EXCEPTION|ERROR|FATAL/.test(eventType)) return 'Error';
  if (/EXECUTION/.test(eventType)) return 'Execution';
  if (/VF_|VISUALFORCE/.test(eventType)) return 'Visualforce';
  if (/SYSTEM/.test(eventType)) return 'System';
  if (/VARIABLE/.test(eventType)) return 'Variables';
  if (/WF_/.test(eventType)) return 'Workflow';
  return 'Other';
}

/** Merge events from multiple logs and sort by timestamp */
export function combineLogEvents(
  logs: { events: LogEvent[]; id: string; name: string; color: string }[]
): LogEvent[] {
  const all: LogEvent[] = [];
  for (const log of logs) {
    for (const e of log.events) {
      all.push({
        ...e,
        sourceLogId: log.id,
        sourceLogName: log.name,
        sourceColor: log.color,
      });
    }
  }
  all.sort((a, b) => a.sortKey - b.sortKey);
  return all;
}

/** Get unique categories from events */
export function getCategories(events: LogEvent[]): string[] {
  return [...new Set(events.map((e) => e.category))].sort();
}

/** Filter events by search, level, category */
export function filterEvents(
  events: LogEvent[],
  search: string,
  level: string,
  category: string
): LogEvent[] {
  let filtered = events;

  if (level !== 'all') {
    filtered = filtered.filter((e) => e.level === level);
  }
  if (category !== 'all') {
    filtered = filtered.filter((e) => e.category === category);
  }
  if (search) {
    try {
      const re = new RegExp(search, 'i');
      filtered = filtered.filter((e) => re.test(e.raw));
    } catch {
      const s = search.toLowerCase();
      filtered = filtered.filter((e) => e.raw.toLowerCase().includes(s));
    }
  }
  return filtered;
}

/** Format a duration in ms to human readable string */
export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0ms';
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  if (ms < 3600000) {
    const min = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    return `${min}m ${sec}s`;
  }
  const hr = Math.floor(ms / 3600000);
  const min = Math.round((ms % 3600000) / 60000);
  return `${hr}h ${min}m`;
}

/** Detect if an event represents an async dispatch (Future call or Queueable enqueue) */
export function isAsyncDispatch(event: LogEvent): 'future' | 'queueable' | null {
  const { eventType, detail } = event;
  const raw = event.raw;

  // Future method invocation — CODE_UNIT_STARTED with __sfdc_invocation (future pattern)
  if (eventType === 'CODE_UNIT_STARTED' && /\bfuture\b/i.test(detail)) return 'future';
  if (eventType === 'METHOD_ENTRY' && /\bfuture\b/i.test(detail)) return 'future';

  // Queueable enqueue — System.enqueueJob in the detail
  if (/System\.enqueueJob/i.test(detail)) return 'queueable';
  if (/\benqueueJob\b/i.test(detail)) return 'queueable';

  // LIMIT_USAGE_FOR_NS lines listing async invocations
  if (eventType === 'LIMIT_USAGE_FOR_NS') {
    if (/Number of future calls:\s*(\d+)/.test(raw)) {
      const match = /Number of future calls:\s*(\d+)/.exec(raw);
      if (match && Number.parseInt(match[1]) > 0) return 'future';
    }
    if (/Number of queueable jobs added:\s*(\d+)/.test(raw)) {
      const match = /Number of queueable jobs added:\s*(\d+)/.exec(raw);
      if (match && Number.parseInt(match[1]) > 0) return 'queueable';
    }
  }

  return null;
}
