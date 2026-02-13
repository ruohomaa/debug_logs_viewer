import type { LogEvent } from './types';

/**
 * A node in the debug log tree.
 * BEGIN/STARTED events become parent nodes whose children are everything
 * until the matching END/FINISHED event.
 */
export interface TreeNode {
  event: LogEvent;
  children: TreeNode[];
  expanded: boolean;
  /** Duration in ms between BEGIN→END (only set on BEGIN nodes) */
  durationMs?: number;
}

// ── Mapping from BEGIN → END event types ──
const BEGIN_END_PAIRS: Record<string, string> = {
  EXECUTION_STARTED: 'EXECUTION_FINISHED',
  CODE_UNIT_STARTED: 'CODE_UNIT_FINISHED',
  SOQL_EXECUTE_BEGIN: 'SOQL_EXECUTE_END',
  DML_BEGIN: 'DML_END',
  METHOD_ENTRY: 'METHOD_EXIT',
  CONSTRUCTOR_ENTRY: 'CONSTRUCTOR_EXIT',
  SYSTEM_METHOD_ENTRY: 'SYSTEM_METHOD_EXIT',
  SYSTEM_CONSTRUCTOR_ENTRY: 'SYSTEM_CONSTRUCTOR_EXIT',
  WF_RULE_EVAL_BEGIN: 'WF_RULE_EVAL_END',
  WF_CRITERIA_BEGIN: 'WF_CRITERIA_END',
  WF_SPOOL_ACTION_BEGIN: 'WF_SPOOL_ACTION_END',
  WF_ACTIONS_BEGIN: 'WF_ACTIONS_END',
  FLOW_CREATE_INTERVIEW_BEGIN: 'FLOW_CREATE_INTERVIEW_END',
  FLOW_START_INTERVIEWS_BEGIN: 'FLOW_START_INTERVIEWS_END',
  FLOW_START_INTERVIEW_BEGIN: 'FLOW_START_INTERVIEW_END',
  FLOW_BULK_ELEMENT_BEGIN: 'FLOW_BULK_ELEMENT_END',
  FLOW_ELEMENT_BEGIN: 'FLOW_ELEMENT_END',
  VALIDATION_RULE: 'VALIDATION_PASS',
  VF_SERIALIZE_VIEWSTATE_BEGIN: 'VF_SERIALIZE_VIEWSTATE_END',
  VF_EVALUATE_FORMULA_BEGIN: 'VF_EVALUATE_FORMULA_END',
  ENTERING_MANAGED_PKG: 'CUMULATIVE_LIMIT_USAGE',
  HEAP_ALLOCATE: '',
  CALLOUT_REQUEST: 'CALLOUT_RESPONSE',
  PUSH_TRACE_FLAGS: 'POP_TRACE_FLAGS',
};

// Build the reverse map: END → BEGIN
const END_EVENTS = new Set<string>();
for (const end of Object.values(BEGIN_END_PAIRS)) {
  if (end) END_EVENTS.add(end);
}

// Events that open a scope
const BEGIN_EVENTS = new Set<string>(Object.keys(BEGIN_END_PAIRS));
// Remove ones with empty END — they don't open a scope
BEGIN_EVENTS.delete('HEAP_ALLOCATE');

/**
 * Build a tree from a flat list of log events.
 *
 * Uses a stack: when a BEGIN event is encountered, push onto the stack;
 * subsequent events become children. When a matching END event appears,
 * pop the stack.
 */
export function buildLogTree(events: LogEvent[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];

  const currentChildren = () =>
    stack.length > 0 ? stack.at(-1)!.children : roots;

  for (const event of events) {
    const { eventType } = event;

    // Is this an END event?  Pop the stack up to its matching BEGIN.
    if (END_EVENTS.has(eventType)) {
      // Find matching BEGIN on the stack
      let found = false;
      for (let i = stack.length - 1; i >= 0; i--) {
        const beginType = stack[i].event.eventType;
        if (BEGIN_END_PAIRS[beginType] === eventType) {
          // Compute duration
          const durationMs = event.absoluteTimestamp - stack[i].event.absoluteTimestamp;
          stack[i].durationMs = durationMs >= 0 ? durationMs : undefined;

          // Add the END event as the last child so it's visible in the tree
          stack[i].children.push({
            event,
            children: [],
            expanded: false,
          });

          // Pop back to that level
          stack.splice(i);
          found = true;
          break;
        }
      }
      if (!found) {
        // Orphan END event — just add as-is
        currentChildren().push({
          event,
          children: [],
          expanded: false,
        });
      }
      continue;
    }

    // Is this a BEGIN event? Create a node and push onto the stack.
    if (BEGIN_EVENTS.has(eventType) && BEGIN_END_PAIRS[eventType]) {
      const node: TreeNode = {
        event,
        children: [],
        expanded: isImportantEvent(eventType), // auto-expand important events
      };
      currentChildren().push(node);
      stack.push(node);
      continue;
    }

    // Regular event — add as a leaf child
    currentChildren().push({
      event,
      children: [],
      expanded: false,
    });
  }

  return roots;
}

/** Determine if a node should be auto-expanded */
function isImportantEvent(eventType: string): boolean {
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
