import type { ApexLog } from '@apexdevtools/apex-log-parser';
import type { LogEvent } from './types';
import { groupFlowInterviewLimits, isImportantEvent, type TreeNode } from './logTree';

interface FrameInfo {
  depth: Int32Array;
  isFrame: Uint8Array;
  endNs: Float64Array;
  durationNs: Float64Array;
  idsByLine: Map<string, number[]>;
}

function indexLog(log: ApexLog): FrameInfo {
  const size = log.eventCount + 1;
  const info: FrameInfo = {
    depth: new Int32Array(size),
    isFrame: new Uint8Array(size),
    endNs: new Float64Array(size),
    durationNs: new Float64Array(size),
    idsByLine: new Map(),
  };
  for (const e of log.events) {
    info.depth[e.id] = e.depth;
    info.isFrame[e.id] = e.isFrame ? 1 : 0;
    info.endNs[e.id] = e.endTimestamp;
    info.durationNs[e.id] = e.duration.total;
    const line = e.logLine.replace(/\r$/, '');
    const ids = info.idsByLine.get(line);
    if (ids) ids.push(e.id);
    else info.idsByLine.set(line, [e.id]);
  }
  return info;
}

function firstLine(raw: string): string {
  const i = raw.indexOf('\n');
  return (i === -1 ? raw : raw.slice(0, i)).replace(/\r$/, '');
}

/**
 * Nest one log's events using the apex-log-parser tree. Events are matched to parser events by
 * their first log line; unmatched lines (exit lines, etc.) become leaves of the open frame.
 */
function buildOne(events: LogEvent[], log: ApexLog): TreeNode[] {
  const info = indexLog(log);
  const roots: TreeNode[] = [];
  const stack: { node: TreeNode; depth: number; endNs: number }[] = [];
  const cursor = new Map<string, number>();
  let lastId = 0;

  const currentChildren = () => (stack.length > 0 ? stack.at(-1)!.node.children : roots);

  for (const event of groupFlowInterviewLimits(events)) {
    const line = firstLine(event.raw);
    const ids = info.idsByLine.get(line);
    let id = -1;
    if (ids) {
      let i = cursor.get(line) ?? 0;
      while (i < ids.length && ids[i] <= lastId) i++;
      if (i < ids.length) {
        id = ids[i];
        cursor.set(line, i + 1);
        lastId = id;
      }
    }

    const node: TreeNode = { event, children: [], expanded: false };

    if (id === -1) {
      while (stack.length > 0 && stack.at(-1)!.endNs < event.nanos) stack.pop();
      currentChildren().push(node);
      continue;
    }

    const depth = info.depth[id];
    while (stack.length > 0 && stack.at(-1)!.depth >= depth) stack.pop();
    currentChildren().push(node);

    if (info.isFrame[id]) {
      node.durationMs = info.durationNs[id] / 1e6;
      node.expanded = isImportantEvent(event.eventType);
      stack.push({ node, depth, endNs: info.endNs[id] });
    }
  }

  return roots;
}

/** Build the tree per source log from apex-log-parser results, ordering roots by time. */
export function buildApexLogTree(events: LogEvent[], parsed: Map<string, ApexLog>): TreeNode[] {
  const bySource = new Map<string, LogEvent[]>();
  for (const e of events) {
    const key = e.sourceLogId ?? '';
    const list = bySource.get(key);
    if (list) list.push(e);
    else bySource.set(key, [e]);
  }

  const roots: TreeNode[] = [];
  for (const [id, logEvents] of bySource) {
    const log = parsed.get(id);
    if (!log) continue;
    logEvents.sort((a, b) => a.lineNum - b.lineNum);
    roots.push(...buildOne(logEvents, log));
  }
  roots.sort((a, b) => a.event.sortKey - b.event.sortKey);
  return roots;
}
