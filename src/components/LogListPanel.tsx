import { useState, useMemo } from 'react';
import type { ApexLogRecord, LogGroup } from '../types';

interface Props {
  logs: ApexLogRecord[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectGroup: (ids: string[]) => void;
  onFetchAndCombine: () => void;
  loadingBody: Set<string>;
  groupByRequest: boolean;
  onToggleGrouping: () => void;
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'a day ago' : `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? 'a month ago' : `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'a year ago' : `${years} years ago`;
}

export default function LogListPanel({
  logs,
  // selectedIds,
  // onToggle,
  onSelectGroup,
  // onFetchAndCombine,
  loadingBody,
  groupByRequest,
  onToggleGrouping,
}: Props) {
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [showUserFilter, setShowUserFilter] = useState(false);
  const [timeFilter, setTimeFilter] = useState('all');

  const TIME_FILTER_OPTIONS = [
    { value: 'all', label: 'All time' },
    { value: '1', label: 'Last 1 min' },
    { value: '5', label: 'Last 5 min' },
    { value: '15', label: 'Last 15 min' },
    { value: '30', label: 'Last 30 min' },
    { value: '60', label: 'Last 1 hour' },
    { value: '360', label: 'Last 6 hours' },
    { value: '1440', label: 'Last 24 hours' },
  ];

  // Unique users from all logs
  const allUsers = useMemo(() => {
    const users = new Set<string>();
    for (const log of logs) {
      const name = log.LogUser?.Name;
      if (name) users.add(name);
    }
    return [...users].sort();
  }, [logs]);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleUserFilter = (user: string) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(user)) next.delete(user);
      else next.add(user);
      return next;
    });
  };

  const filteredLogs = useMemo(() => {
    let result = logs;

    // Filter by time
    if (timeFilter !== 'all') {
      const cutoff = Date.now() - Number.parseInt(timeFilter) * 60 * 1000;
      result = result.filter((l) => new Date(l.StartTime).getTime() >= cutoff);
    }

    // Filter by selected users
    if (selectedUsers.size > 0) {
      result = result.filter((l) => {
        const name = l.LogUser?.Name;
        return name && selectedUsers.has(name);
      });
    }

    // Filter by search text
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.Operation?.toLowerCase().includes(s) ||
          l.LogUser?.Name?.toLowerCase().includes(s) ||
          l.RequestIdentifier?.toLowerCase().includes(s) ||
          l.Status?.toLowerCase().includes(s)
      );
    }

    return result;
  }, [logs, search, selectedUsers, timeFilter]);

  const groups: LogGroup[] = useMemo(() => {
    if (!groupByRequest) return [];
    const map = new Map<string, ApexLogRecord[]>();
    for (const log of filteredLogs) {
      const key = log.RequestIdentifier || log.Id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    return [...map.entries()]
      .map(([requestIdentifier, groupLogs]) => ({
        requestIdentifier,
        logs: groupLogs.sort(
          (a, b) => new Date(a.StartTime).getTime() - new Date(b.StartTime).getTime()
        ),
        totalDuration: groupLogs.reduce((sum, l) => sum + (l.DurationMilliseconds || 0), 0),
        startTime: groupLogs.reduce(
          (earliest, l) =>
            !earliest || new Date(l.StartTime) < new Date(earliest) ? l.StartTime : earliest,
          ''
        ),
      }))
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }, [filteredLogs, groupByRequest]);



  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatTimestamp = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const renderLogRow = (log: ApexLogRecord) => {
    const isLoading = loadingBody.has(log.Id);
    const isExpanded = expandedIds.has(log.Id);

    return (
      <div key={log.Id} className="group">
        <div
          className="flex items-start gap-2.5 px-3 py-2.5 rounded-md cursor-grab transition-colors hover:bg-[var(--surface2)] active:cursor-grabbing"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-log-id', log.Id);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={(e) => toggleExpand(log.Id, e)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <div className="text-sm font-medium truncate text-[var(--text)] flex-1">
                {log.Operation || 'Unknown Operation'}
              </div>
              <button
                onClick={(e) => toggleExpand(log.Id, e)}
                className="text-[var(--text-dim)] hover:text-[var(--text)] transition-colors p-0.5 flex-shrink-0"
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
            <div className="text-[11px] text-[var(--text-dim)] mt-0.5 space-x-2">
              <span title={formatTimestamp(log.StartTime)}>{relativeTime(log.StartTime)}</span>
              <span>·</span>
              <span>{(log.DurationMilliseconds || 0).toLocaleString()}ms</span>
              <span>·</span>
              <span>{formatSize(log.LogLength)}</span>
            </div>
            <div className="text-[10px] text-[var(--text-dim)] mt-0.5 truncate">
              {log.LogUser?.Name || 'Unknown User'} · {log.Status}
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="mt-2 pt-2 border-t border-[var(--border)] text-[11px] text-[var(--text-dim)] space-y-1" onClick={(e) => e.stopPropagation()}>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <span className="text-[var(--text-dim)]">ID</span>
                  <span className="font-mono text-[var(--text)] select-all truncate">{log.Id}</span>
                  <span className="text-[var(--text-dim)]">User</span>
                  <span className="text-[var(--text)]">{log.LogUser?.Name || 'Unknown'}</span>
                  <span className="text-[var(--text-dim)]">Operation</span>
                  <span className="text-[var(--text)]">{log.Operation || '—'}</span>
                  <span className="text-[var(--text-dim)]">Application</span>
                  <span className="text-[var(--text)]">{log.Application || '—'}</span>
                  <span className="text-[var(--text-dim)]">Status</span>
                  <span className="text-[var(--text)]">{log.Status || '—'}</span>
                  <span className="text-[var(--text-dim)]">Location</span>
                  <span className="text-[var(--text)]">{log.Location || '—'}</span>
                  <span className="text-[var(--text-dim)]">Duration</span>
                  <span className="text-[var(--text)]">{(log.DurationMilliseconds || 0).toLocaleString()} ms</span>
                  <span className="text-[var(--text-dim)]">Size</span>
                  <span className="text-[var(--text)]">{formatSize(log.LogLength)}</span>
                  <span className="text-[var(--text-dim)]">Started</span>
                  <span className="text-[var(--text)]">{formatTimestamp(log.StartTime)}</span>
                  <span className="text-[var(--text-dim)]">Request ID</span>
                  <span className="font-mono text-[var(--text)] truncate select-all">{log.RequestIdentifier || '—'}</span>
                </div>
              </div>
            )}
          </div>
          {isLoading && (
            <div className="text-xs text-[var(--accent)] animate-pulse mt-1">Loading...</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search + controls */}
      <div className="p-3 border-b border-[var(--border)] space-y-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter logs..."
          className="w-full px-2.5 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-md text-[var(--text)] text-xs outline-none focus:border-[var(--accent)] transition-colors"
        />

        {/* Time filter */}
        <select
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value)}
          className={`w-full px-2.5 py-1.5 bg-[var(--bg)] border rounded-md text-xs outline-none cursor-pointer transition-colors ${
            timeFilter === 'all'
              ? 'border-[var(--border)] text-[var(--text-dim)]'
              : 'border-[var(--accent)] text-[var(--accent)]'
          }`}
        >
          {TIME_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* User filter */}
        {allUsers.length > 1 && (
          <div className="relative">
            <button
              onClick={() => setShowUserFilter(!showUserFilter)}
              className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--bg)] border rounded-md text-xs cursor-pointer transition-colors ${
                selectedUsers.size > 0
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-dim)]'
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span className="flex-1 text-left truncate">
                {selectedUsers.size === 0
                  ? 'All users'
                  : selectedUsers.size === 1
                    ? [...selectedUsers][0]
                    : `${selectedUsers.size} users selected`}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`transition-transform ${showUserFilter ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showUserFilter && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-lg max-h-48 overflow-y-auto">
                <div
                  className="px-2.5 py-1.5 text-[11px] text-[var(--accent)] cursor-pointer hover:bg-[var(--surface2)] border-b border-[var(--border)]"
                  onClick={() => setSelectedUsers(new Set())}
                >
                  Clear all
                </div>
                {allUsers.map((user) => (
                  <label
                    key={user}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text)] cursor-pointer hover:bg-[var(--surface2)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUsers.has(user)}
                      onChange={() => toggleUserFilter(user)}
                      className="accent-[var(--accent)] cursor-pointer"
                    />
                    {user}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-dim)] cursor-pointer">
            <input
              type="checkbox"
              checked={groupByRequest}
              onChange={onToggleGrouping}
              className="accent-[var(--accent)] cursor-pointer"
            />
            Group by Request
          </label>
          <span className="flex-1" />
          <span className="text-[11px] text-[var(--text-dim)]">
            {filteredLogs.length} logs
          </span>
        </div>
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {logs.length === 0 ? (
          <p className="text-center text-[var(--text-dim)] text-sm py-8">
            No debug logs found
          </p>
        ) : filteredLogs.length === 0 ? (
          <p className="text-center text-[var(--text-dim)] text-sm py-8">
            No logs match the current filters
          </p>
        ) : groupByRequest ? (
          /* Grouped view */
          groups.map((group) => (
            <div key={group.requestIdentifier} className="mb-2">
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface2)] rounded-t-md cursor-pointer hover:bg-[var(--border)] transition-colors"
                onClick={() => onSelectGroup(group.logs.map((l) => l.Id))}
              >
                <span className="text-[10px] font-mono text-[var(--accent)] truncate flex-1">
                  {group.requestIdentifier}
                </span>
                <span className="text-[10px] text-[var(--text-dim)] whitespace-nowrap">
                  {group.logs.length} logs · {formatTime(group.startTime)} · {group.totalDuration.toLocaleString()}ms
                </span>
              </div>
              <div className="border-l border-r border-b border-[var(--border)] rounded-b-md">
                {group.logs.map(renderLogRow)}
              </div>
            </div>
          ))
        ) : (
          /* Flat view */
          filteredLogs.map(renderLogRow)
        )}
      </div>


    </div>
  );
}
