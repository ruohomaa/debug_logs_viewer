// ── Shared event category definitions for filtering ──

export interface EventCategory {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly match: (eventType: string) => boolean;
}

export const EVENT_CATEGORIES: EventCategory[] = [
  { id: 'execution', label: 'Execution', color: '#6c8cff', match: (t) => /EXECUTION/.test(t) },
  { id: 'code-unit', label: 'Code Units', color: '#8b90a0', match: (t) => /CODE_UNIT|METHOD|CONSTRUCTOR/.test(t) },
  { id: 'dml', label: 'DML', color: '#4ecdc4', match: (t) => /DML/.test(t) },
  { id: 'soql', label: 'SOQL/SOSL', color: '#60a5fa', match: (t) => /SOQL|SOSL/.test(t) },
  { id: 'callout', label: 'Callouts', color: '#fb923c', match: (t) => /CALLOUT/.test(t) },
  { id: 'trigger', label: 'Triggers', color: '#f472b6', match: (t) => /TRIGGER/.test(t) },
  { id: 'flow', label: 'Flows', color: '#c084fc', match: (t) => /FLOW/.test(t) },
  { id: 'debug', label: 'Debug', color: '#ffd93d', match: (t) => /USER_DEBUG/.test(t) },
  { id: 'error', label: 'Errors', color: '#ff6b6b', match: (t) => /EXCEPTION|FATAL|ERROR/.test(t) },
  { id: 'other', label: 'Other', color: '#8b90a0', match: (t) => /VALIDATION|VF_|LIMIT/.test(t) },
];

export function getCategoryId(eventType: string): string {
  for (const cat of EVENT_CATEGORIES) {
    if (cat.match(eventType)) return cat.id;
  }
  return 'other';
}
