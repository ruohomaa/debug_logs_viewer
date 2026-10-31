import type { LogEvent } from './types';

/** A node in the debug log tree; frames hold the events up to their exit line. */
export interface TreeNode {
  event: LogEvent;
  children: TreeNode[];
  expanded: boolean;
  /** Total frame duration in ms (only set on frame nodes) */
  durationMs?: number;
}

const FLOW_LIMIT_EVENT_TYPES = new Set([
  'FLOW_START_INTERVIEW_LIMIT_USAGE',
  'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE',
  'FLOW_BULK_ELEMENT_LIMIT_USAGE',
]);

/**
 * Pre-process events to group consecutive flow limit usage
 * events of the same type into a single synthetic event.
 */
export function groupFlowInterviewLimits(events: LogEvent[]): LogEvent[] {
  const result: LogEvent[] = [];
  let cursor = 0;
  while (cursor < events.length) {
    const evtType = events[cursor].eventType;
    if (!FLOW_LIMIT_EVENT_TYPES.has(evtType)) {
      result.push(events[cursor]);
      cursor++;
      continue;
    }
    // Collect consecutive limit events of the same type
    const start = cursor;
    while (
      cursor < events.length &&
      events[cursor].eventType === evtType
    ) {
      cursor++;
    }
    const limitLines = events.slice(start, cursor);
    result.push({
      ...limitLines[0],
      detail: limitLines.map((e) => e.detail).join('\n'),
      raw: limitLines.map((e) => e.raw).join('\n'),
    });
  }
  return result;
}

/** Determine if a node should be auto-expanded */
export function isImportantEvent(eventType: string): boolean {
  return (
    eventType === 'EXECUTION_STARTED' ||
    eventType === 'CODE_UNIT_STARTED'
  );
}

/** Get icon name + color for an event type (matching the Angular component's logic) */
export function getEventIcon(eventType: string): { icon: string; color: string } {
  // Group similar event types using maps for cleaner lookup
  const beginEvents: Record<string, { icon: string; color: string }> = {
    EXECUTION_STARTED: { icon: '▶', color: '#4ecdc4' },
    CODE_UNIT_STARTED: { icon: '{ }', color: '#4ecdc4' },
    SOQL_EXECUTE_BEGIN: { icon: '🔍', color: '#4ecdc4' },
    DML_BEGIN: { icon: '💾', color: '#4ecdc4' },
    METHOD_ENTRY: { icon: 'ƒ', color: '#4ecdc4' },
    CONSTRUCTOR_ENTRY: { icon: 'ƒ', color: '#4ecdc4' },
    SYSTEM_METHOD_ENTRY: { icon: 'ƒ', color: '#4ecdc4' },
    SYSTEM_CONSTRUCTOR_ENTRY: { icon: 'ƒ', color: '#4ecdc4' },
    WF_RULE_EVAL_BEGIN: { icon: '📏', color: '#4ecdc4' },
    FLOW_CREATE_INTERVIEW_BEGIN: { icon: '⬡', color: '#4ecdc4' },
    FLOW_START_INTERVIEWS_BEGIN: { icon: '⬡', color: '#4ecdc4' },
    FLOW_START_INTERVIEW_BEGIN: { icon: '⬡', color: '#4ecdc4' },
    FLOW_BULK_ELEMENT_BEGIN: { icon: '⬡', color: '#4ecdc4' },
    FLOW_ELEMENT_BEGIN: { icon: '⬡', color: '#4ecdc4' },
  };

  const endEvents: Record<string, { icon: string; color: string }> = {
    EXECUTION_FINISHED: { icon: '⏹', color: '#ff6b6b' },
    CODE_UNIT_FINISHED: { icon: '{ }', color: '#ff6b6b' },
    SOQL_EXECUTE_END: { icon: '🔍', color: '#ff6b6b' },
    DML_END: { icon: '💾', color: '#ff6b6b' },
    METHOD_EXIT: { icon: 'ƒ', color: '#ff6b6b' },
    CONSTRUCTOR_EXIT: { icon: 'ƒ', color: '#ff6b6b' },
    SYSTEM_METHOD_EXIT: { icon: 'ƒ', color: '#ff6b6b' },
    SYSTEM_CONSTRUCTOR_EXIT: { icon: 'ƒ', color: '#ff6b6b' },
    WF_RULE_EVAL_END: { icon: '📏', color: '#ff6b6b' },
    FLOW_CREATE_INTERVIEW_END: { icon: '⬡', color: '#ff6b6b' },
    FLOW_START_INTERVIEWS_END: { icon: '⬡', color: '#ff6b6b' },
    FLOW_START_INTERVIEW_END: { icon: '⬡', color: '#ff6b6b' },
    FLOW_ELEMENT_END: { icon: '⬡', color: '#ff6b6b' },
    FLOW_BULK_ELEMENT_END: { icon: '⬡', color: '#ff6b6b' },
  };

  const specialEvents: Record<string, { icon: string; color: string }> = {
    SOQL_EXECUTE_EXPLAIN: { icon: '📋', color: '#c084fc' },
    CALLOUT_REQUEST: { icon: '↗', color: '#60a5fa' },
    CALLOUT_RESPONSE: { icon: '↙', color: '#60a5fa' },
    LIMIT_USAGE_FOR_NS: { icon: '📊', color: '#ffd93d' },
    CUMULATIVE_LIMIT_USAGE: { icon: '📊', color: '#ffd93d' },
    CUMULATIVE_LIMIT_USAGE_END: { icon: '📊', color: '#ffd93d' },
    FLOW_START_INTERVIEW_LIMIT_USAGE: { icon: '📊', color: '#c084fc' },
    FLOW_INTERVIEW_FINISHED_LIMIT_USAGE: { icon: '📊', color: '#c084fc' },
    FLOW_BULK_ELEMENT_LIMIT_USAGE: { icon: '📊', color: '#c084fc' },
    WF_CRITERIA_BEGIN: { icon: '📏', color: '#c084fc' },
    WF_CRITERIA_END: { icon: '📏', color: '#c084fc' },
    WF_SPOOL_ACTION_BEGIN: { icon: '⏱', color: '#ffd93d' },
    WF_SPOOL_ACTION_END: { icon: '⏱', color: '#ffd93d' },
    WF_ACTION: { icon: '🎯', color: '#fb923c' },
    VALIDATION_RULE: { icon: '📏', color: '#c084fc' },
    VALIDATION_FORMULA: { icon: '📝', color: '#c084fc' },
    WF_FORMULA: { icon: '📝', color: '#c084fc' },
    VALIDATION_PASS: { icon: '✓', color: '#4ecdc4' },
    VALIDATION_FAIL: { icon: '✗', color: '#ff6b6b' },
    VALIDATION_ERROR: { icon: '⚠', color: '#ff4444' },
    USER_DEBUG: { icon: '⚡', color: '#ffd93d' },
    USER_INFO: { icon: '👤', color: '#8b90a0' },
    FATAL_ERROR: { icon: '💀', color: '#ff4444' },
    EXCEPTION_THROWN: { icon: '⚠', color: '#ff4444' },
    EMAIL_QUEUE: { icon: '✉', color: '#60a5fa' },
  };

  if (beginEvents[eventType]) return beginEvents[eventType];
  if (endEvents[eventType]) return endEvents[eventType];
  if (specialEvents[eventType]) return specialEvents[eventType];

  // Prefix-based fallbacks
  if (eventType.startsWith('VF_') || eventType.startsWith('VISUALFORCE'))
    return { icon: '📱', color: '#fb923c' };
  if (eventType.startsWith('FLOW_'))
    return { icon: '⬡', color: '#c084fc' };
  if (eventType.startsWith('WF_'))
    return { icon: '📏', color: '#ffd93d' };

  return { icon: '•', color: '#8b90a0' };
}

/** Count total nodes in a tree */
export function countNodes(nodes: TreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    if (node.children.length > 0) {
      count += countNodes(node.children);
    }
  }
  return count;
}

/** Expand or collapse all nodes */
export function setAllExpanded(nodes: TreeNode[], expanded: boolean): TreeNode[] {
  return nodes.map((n) => ({
    ...n,
    expanded: n.children.length > 0 ? expanded : n.expanded,
    children: n.children.length > 0 ? setAllExpanded(n.children, expanded) : n.children,
  }));
}

/** Filter the tree based on event type search, keeping parent context */
export function filterTree(nodes: TreeNode[], predicate: (event: LogEvent) => boolean): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    const filteredChildren = filterTree(node.children, predicate);
    if (predicate(node.event) || filteredChildren.length > 0) {
      result.push({
        ...node,
        expanded: filteredChildren.length > 0 ? true : node.expanded,
        children: filteredChildren,
      });
    }
  }
  return result;
}
