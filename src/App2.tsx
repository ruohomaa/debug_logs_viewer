import { useState, useMemo, useCallback, useRef, type DragEvent } from 'react';
import type { SfConnection, ApexLogRecord, LoadedLog, LogEvent } from './types';
import { fetchApexLogs, fetchLogBody } from './api';
import { parseSalesforceLog, combineLogEvents, filterEvents } from './logParser';
import { LOG_COLORS } from './constants';
import ConnectPanel from './components/ConnectPanel';
import LogListPanel from './components/LogListPanel';
import Toolbar from './components/Toolbar';
import StatsBar from './components/StatsBar';
import TimelineBar from './components/TimelineBar';
import EventList from './components/EventList';
import SequenceDiagram from './components/SequenceDiagram';
import TreeView from './components/TreeView';
import CategoryFilter from './components/CategoryFilter';
import DetailPanel from './components/DetailPanel';
import { getCategoryId } from './eventCategories';

export default function App() {
  // ── Connection state ──
  const [connection, setConnection] = useState<SfConnection | null>(null);

  // ── Salesforce ApexLog records ──
  const [apexLogs, setApexLogs] = useState<ApexLogRecord[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // ── Selection ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Loaded (fetched + parsed) logs ──
  const [loadedLogs, setLoadedLogs] = useState<LoadedLog[]>([]);
  const [loadingBody, setLoadingBody] = useState<Set<string>>(new Set());

  // ── Combined events ──
  const [combinedEvents, setCombinedEvents] = useState<LogEvent[]>([]);
  const [showResults, setShowResults] = useState(false);

  // ── Filters ──
  const [search, setSearch] = useState('');
  const [density, setDensity] = useState<'default' | 'compact' | 'comfortable'>('default');
  const [showGaps, setShowGaps] = useState(false);
  const [groupByRequest, setGroupByRequest] = useState(false);

  // ── View mode ──
  const [viewMode, setViewMode] = useState<'list' | 'diagram' | 'tree'>('list');

  // ── Hidden event categories ──
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());

  // ── Detail panel ──
  const [selectedEvent, setSelectedEvent] = useState<LogEvent | null>(null);

  // ── Timeline scroll target ──
  const [scrollToEventIndex, setScrollToEventIndex] = useState<number | null>(null);

  // ── Color tracker ──
  const [colorIndex, setColorIndex] = useState(0);

  // ── Drag-and-drop state ──
  const [isDragOver, setIsDragOver] = useState(false);

  // ── Sidebar resize state ──
  const [sidebarWidth, setSidebarWidth] = useState(350);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isResizing = useRef(false);
  const sidebarWidthBeforeCollapse = useRef(350);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(200, Math.min(800, startWidth + (ev.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  const toggleSidebar = useCallback(() => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      setSidebarWidth(sidebarWidthBeforeCollapse.current);
    } else {
      sidebarWidthBeforeCollapse.current = sidebarWidth;
      setSidebarCollapsed(true);
    }
  }, [sidebarCollapsed, sidebarWidth]);

  // After connecting, load logs
  const handleConnected = useCallback(async (conn: SfConnection) => {
    setConnection(conn);
    setLoadingLogs(true);
    try {
      const logs = await fetchApexLogs(conn.connId);
      setApexLogs(logs);
    } catch (e) {
      console.error('Failed to fetch logs:', e);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  const handleRefreshLogs = useCallback(async () => {
    if (!connection) return;
    setLoadingLogs(true);
    try {
      const logs = await fetchApexLogs(connection.connId);
      setApexLogs(logs);
    } catch (e) {
      console.error('Failed to refresh logs:', e);
    } finally {
      setLoadingLogs(false);
    }
  }, [connection]);

  // Toggle log selection
  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Select a whole group
  const handleSelectGroup = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }, []);

  // Fetch bodies and combine
  const handleFetchAndCombine = useCallback(async () => {
    if (!connection || selectedIds.size === 0) return;

    const idsToFetch = [...selectedIds];
    const alreadyLoaded = new Map(loadedLogs.map((l) => [l.id, l]));
    let nextColorIdx = colorIndex;

    // Show loading state
    setLoadingBody(new Set(idsToFetch.filter((id) => !alreadyLoaded.has(id))));

    // Fetch bodies that haven't been loaded yet
    const newLogs: LoadedLog[] = [];
    const errors: string[] = [];

    await Promise.all(
      idsToFetch.map(async (id) => {
        if (alreadyLoaded.has(id)) {
          // Already loaded, just mark as selected
          const existing = alreadyLoaded.get(id)!;
          existing.selected = true;
          newLogs.push(existing);
          return;
        }

        try {
          const body = await fetchLogBody(connection.connId, id);
          const apexLog = apexLogs.find((l) => l.Id === id);
          const logDate = apexLog?.StartTime
            ? new Date(apexLog.StartTime).toISOString().slice(0, 10)
            : undefined;
          const { events, meta } = parseSalesforceLog(body, logDate);
          const color = LOG_COLORS[nextColorIdx % LOG_COLORS.length];
          nextColorIdx++;

          const loaded: LoadedLog = {
            id,
            name: apexLog?.Operation || `Log ${id.substring(0, 8)}`,
            color,
            apexLog,
            rawContent: body,
            events,
            meta,
            selected: true,
          };
          newLogs.push(loaded);
        } catch (e) {
          errors.push(id);
          console.error(`Failed to fetch log ${id}:`, e);
        }
      })
    );

    setColorIndex(nextColorIdx);
    setLoadingBody(new Set());

    // Merge with existing loaded logs (keeping unselected ones)
    const allLoaded = [...loadedLogs.filter((l) => !idsToFetch.includes(l.id)), ...newLogs];
    // Mark non-selected as unselected
    allLoaded.forEach((l) => {
      l.selected = selectedIds.has(l.id);
    });
    setLoadedLogs(allLoaded);

    // Combine selected
    const toMerge = allLoaded
      .filter((l) => l.selected)
      .map((l) => ({
        events: l.events,
        id: l.id,
        name: l.name,
        color: l.color,
      }));

    const merged = combineLogEvents(toMerge);
    setCombinedEvents(merged);
    setShowResults(true);

    if (errors.length > 0) {
      alert(`Failed to fetch ${errors.length} log(s). They were skipped.`);
    }
  }, [connection, selectedIds, loadedLogs, apexLogs, colorIndex]);

  // ── Handle dropping a log from the sidebar ──
  const handleDropLog = useCallback(async (logId: string) => {
    if (!connection) return;

    // Already loaded?
    const existing = loadedLogs.find((l) => l.id === logId);
    if (existing) {
      existing.selected = true;
      const allLoaded = loadedLogs.map((l) => ({ ...l, selected: true }));
      setLoadedLogs(allLoaded);
      const toMerge = allLoaded.map((l) => ({ events: l.events, id: l.id, name: l.name, color: l.color }));
      setCombinedEvents(combineLogEvents(toMerge));
      setShowResults(true);
      return;
    }

    // Fetch the log body
    setLoadingBody((prev) => new Set([...prev, logId]));
    try {
      const body = await fetchLogBody(connection.connId, logId);
      const apexLog = apexLogs.find((l) => l.Id === logId);
      const logDate = apexLog?.StartTime
        ? new Date(apexLog.StartTime).toISOString().slice(0, 10)
        : undefined;
      const { events, meta } = parseSalesforceLog(body, logDate);
      const color = LOG_COLORS[colorIndex % LOG_COLORS.length];

      const loaded: LoadedLog = {
        id: logId,
        name: apexLog?.Operation || `Log ${logId.substring(0, 8)}`,
        color,
        apexLog,
        rawContent: body,
        events,
        meta,
        selected: true,
      };

      setColorIndex((c) => c + 1);

      const allLoaded = [...loadedLogs, loaded].map((l) => ({ ...l, selected: true }));
      setLoadedLogs(allLoaded);
      const toMerge = allLoaded.map((l) => ({ events: l.events, id: l.id, name: l.name, color: l.color }));
      setCombinedEvents(combineLogEvents(toMerge));
      setShowResults(true);
    } catch (e) {
      console.error(`Failed to fetch log ${logId}:`, e);
    } finally {
      setLoadingBody((prev) => {
        const next = new Set(prev);
        next.delete(logId);
        return next;
      });
    }
  }, [connection, loadedLogs, apexLogs, colorIndex]);

  // ── Drag-over / drop handlers for the main content area ──
  const handleMainDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-log-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleMainDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleMainDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const logId = e.dataTransfer.getData('application/x-log-id');
    if (logId) {
      handleDropLog(logId);
    }
  }, [handleDropLog]);

  // ── Remove a single loaded log ──
  const handleRemoveLog = useCallback((logId: string) => {
    const remaining = loadedLogs.filter((l) => l.id !== logId);
    setLoadedLogs(remaining);
    if (remaining.length === 0) {
      setCombinedEvents([]);
      setShowResults(false);
    } else {
      const toMerge = remaining.map((l) => ({ events: l.events, id: l.id, name: l.name, color: l.color }));
      setCombinedEvents(combineLogEvents(toMerge));
    }
  }, [loadedLogs]);

  // ── Clear all loaded logs ──
  const handleClearAllLogs = useCallback(() => {
    setLoadedLogs([]);
    setCombinedEvents([]);
    setShowResults(false);
  }, []);

  // Filtered events
  const filteredEvents = useMemo(
    () => {
      let result = filterEvents(combinedEvents, search);
      if (hiddenCategories.size > 0) {
        result = result.filter((e) => !hiddenCategories.has(getCategoryId(e.eventType)));
      }
      return result;
    },
    [combinedEvents, search, hiddenCategories]
  );

  // ── Render ──

  // Not connected yet
  if (!connection) {
    return (
      <div className="h-screen flex flex-col">
        <Header />
        <div className="flex-1">
          <ConnectPanel onConnected={handleConnected} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <Header
        instanceUrl={connection.instanceUrl}
        username={connection.username}
        onRefresh={handleRefreshLogs}
        loading={loadingLogs}
        onDisconnect={() => {
          setConnection(null);
          setApexLogs([]);
          setSelectedIds(new Set());
          setLoadedLogs([]);
          setCombinedEvents([]);
          setShowResults(false);
        }}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside
          className="bg-[var(--surface)] border-r border-[var(--border)] overflow-hidden flex flex-col flex-shrink-0 transition-[width] duration-200"
          style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
        >
          {!sidebarCollapsed && (
            <LogListPanel
              logs={apexLogs}
              selectedIds={selectedIds}
              onToggle={handleToggle}
              onSelectGroup={handleSelectGroup}
              onFetchAndCombine={handleFetchAndCombine}
              loadingBody={loadingBody}
              groupByRequest={groupByRequest}
              onToggleGrouping={() => setGroupByRequest(!groupByRequest)}
              connId={connection?.connId}
            />
          )}
        </aside>

        {/* Resize handle + collapse toggle */}
        <div className="relative flex-shrink-0 group" style={{ width: sidebarCollapsed ? 0 : 4 }}>
          {!sidebarCollapsed && (
            <div
              className="absolute inset-y-0 -left-1 w-2 cursor-col-resize z-20 hover:bg-[var(--accent)] transition-colors"
              onMouseDown={handleResizeStart}
            />
          )}
          <button
            onClick={toggleSidebar}
            className="absolute top-1/2 -translate-y-1/2 z-30 w-5 h-10 flex items-center justify-center bg-[var(--surface2)] border border-[var(--border)] rounded-r-md hover:bg-[var(--border)] cursor-pointer transition-colors"
            style={{ left: sidebarCollapsed ? 0 : -1 }}
            title={sidebarCollapsed ? 'Expand log list' : 'Collapse log list'}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="text-[var(--text-dim)]"
              style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : undefined }}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        {/* Main */}
        <main
          className={`flex-1 min-w-0 flex flex-col overflow-hidden relative ${
            isDragOver ? 'ring-2 ring-inset ring-[var(--accent)] bg-[rgba(108,140,255,0.05)]' : ''
          }`}
          onDragOver={handleMainDragOver}
          onDragLeave={handleMainDragLeave}
          onDrop={handleMainDrop}
        >
          {/* Drop zone overlay */}
          {isDragOver && (
            <div
              className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none"
              style={{ background: 'rgba(15, 17, 23, 0.85)' }}
            >
              <div className="flex flex-col items-center gap-3 text-[var(--accent)]">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                <span className="text-lg font-semibold">Drop to add log</span>
              </div>
            </div>
          )}

          {!showResults ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-dim)] gap-4">
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                className="opacity-40"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <h3 className="text-lg font-medium text-[var(--text)]">
                {loadingLogs ? 'Loading debug logs...' : 'Drop Logs Here'}
              </h3>
              <p className="text-sm max-w-md text-center leading-relaxed">
                {loadingLogs
                  ? 'Fetching ApexLog records from your Salesforce org...'
                  : 'Drag debug logs from the sidebar and drop them here to view the raw log and sequence diagram.'}
              </p>
            </div>
          ) : (
            <>
              {/* View mode toggle */}
              <div className="flex items-center bg-[var(--surface)] border-b border-[var(--border)]">
                <Toolbar
                  search={search}
                  onSearchChange={setSearch}
                  density={density}
                  onDensityChange={setDensity}
                  showGaps={showGaps}
                  onShowGapsChange={setShowGaps}
                />
                <div className="flex items-center gap-1 px-3 border-l border-[var(--border)]">
                  <button
                    onClick={() => setViewMode('list')}
                    className={`px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
                      viewMode === 'list'
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--surface2)] text-[var(--text-dim)] hover:bg-[var(--border)]'
                    }`}
                    title="Event list view"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="8" y1="6" x2="21" y2="6" />
                      <line x1="8" y1="12" x2="21" y2="12" />
                      <line x1="8" y1="18" x2="21" y2="18" />
                      <line x1="3" y1="6" x2="3.01" y2="6" />
                      <line x1="3" y1="12" x2="3.01" y2="12" />
                      <line x1="3" y1="18" x2="3.01" y2="18" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setViewMode('diagram')}
                    className={`px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
                      viewMode === 'diagram'
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--surface2)] text-[var(--text-dim)] hover:bg-[var(--border)]'
                    }`}
                    title="Sequence diagram view"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="6" height="4" rx="1" />
                      <rect x="15" y="3" width="6" height="4" rx="1" />
                      <line x1="6" y1="7" x2="6" y2="20" strokeDasharray="3 2" />
                      <line x1="18" y1="7" x2="18" y2="20" strokeDasharray="3 2" />
                      <line x1="6" y1="11" x2="18" y2="11" />
                      <polygon points="16,9.5 18,11 16,12.5" fill="currentColor" />
                      <line x1="18" y1="16" x2="6" y2="16" />
                      <polygon points="8,14.5 6,16 8,17.5" fill="currentColor" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setViewMode('tree')}
                    className={`px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
                      viewMode === 'tree'
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--surface2)] text-[var(--text-dim)] hover:bg-[var(--border)]'
                    }`}
                    title="Tree structure view"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="4" r="2" />
                      <line x1="12" y1="6" x2="12" y2="10" />
                      <line x1="6" y1="10" x2="18" y2="10" />
                      <line x1="6" y1="10" x2="6" y2="14" />
                      <line x1="18" y1="10" x2="18" y2="14" />
                      <circle cx="6" cy="16" r="2" />
                      <circle cx="18" cy="16" r="2" />
                      <line x1="12" y1="10" x2="12" y2="14" />
                      <circle cx="12" cy="16" r="2" />
                    </svg>
                  </button>
                </div>
              </div>
              <StatsBar events={filteredEvents} logs={loadedLogs} />

              {/* Loaded logs chips */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface)] border-b border-[var(--border)] flex-wrap">
                {loadedLogs.map((log) => (
                  <span
                    key={log.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ background: `${log.color}22`, color: log.color, border: `1px solid ${log.color}44` }}
                  >
                    <span className="max-w-[140px] truncate">{log.name}</span>
                    <button
                      onClick={() => {
                        const blob = new Blob([log.rawContent], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${log.name}.log`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="hover:opacity-100 opacity-60 transition-opacity cursor-pointer"
                      title={`Download ${log.name}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleRemoveLog(log.id)}
                      className="hover:opacity-100 opacity-60 transition-opacity cursor-pointer"
                      title={`Remove ${log.name}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </span>
                ))}
                {loadedLogs.length > 1 && (
                  <button
                    onClick={handleClearAllLogs}
                    className="px-2 py-0.5 text-[11px] text-[var(--danger)] hover:bg-[rgba(255,107,107,0.1)] rounded-full transition-colors cursor-pointer"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <CategoryFilter
                hiddenCategories={hiddenCategories}
                onToggleCategory={(catId) => {
                  setHiddenCategories((prev) => {
                    const next = new Set(prev);
                    if (next.has(catId)) next.delete(catId);
                    else next.add(catId);
                    return next;
                  });
                }}
                onShowAll={() => setHiddenCategories(new Set())}
              />

              <TimelineBar
                events={filteredEvents}
                logs={loadedLogs}
                onClickTimestamp={(ts) => {
                  // Find the event closest to the clicked timestamp
                  let bestIdx = 0;
                  let bestDist = Infinity;
                  for (let i = 0; i < filteredEvents.length; i++) {
                    const dist = Math.abs(filteredEvents[i].absoluteTimestamp - ts);
                    if (dist < bestDist) {
                      bestDist = dist;
                      bestIdx = i;
                    }
                  }
                  // Toggle to force re-trigger even for the same index
                  setScrollToEventIndex(null);
                  requestAnimationFrame(() => setScrollToEventIndex(bestIdx));
                }}
              />
              {viewMode === 'list' && (
                <EventList
                  events={filteredEvents}
                  showGaps={showGaps}
                  density={density}
                  onSelectEvent={setSelectedEvent}
                  scrollToIndex={scrollToEventIndex}
                  connId={connection?.connId}
                />
              )}
              {viewMode === 'tree' && (
                <TreeView
                  events={filteredEvents}
                  density={density}
                  onSelectEvent={setSelectedEvent}
                  connId={connection?.connId}
                />
              )}
              {viewMode === 'diagram' && (
                <SequenceDiagram
                  events={filteredEvents}
                  logs={loadedLogs}
                  onSelectEvent={setSelectedEvent}
                />
              )}
            </>
          )}
        </main>
      </div>

      <DetailPanel
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        connId={connection?.connId}
      />
    </div>
  );
}

// ── Header ──
function Header({
  instanceUrl,
  username,
  onRefresh,
  loading,
  onDisconnect,
}: {
  instanceUrl?: string;
  username?: string;
  onRefresh?: () => void;
  loading?: boolean;
  onDisconnect?: () => void;
}) {
  return (
    <header className="bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3 flex items-center gap-4">
      <h1 className="text-lg font-semibold bg-gradient-to-r from-[var(--accent)] to-[var(--success)] bg-clip-text text-transparent">
        SF Debug Log Viewer
      </h1>
      {instanceUrl && (
        <>
          <span className="text-xs text-[var(--text-dim)]">
            Connected to{' '}
            <span className="text-[var(--success)] font-medium">{instanceUrl}</span>
            {username && (
              <span className="text-[var(--text-dim)]"> as <span className="text-[var(--text)] font-medium">{username}</span></span>
            )}
          </span>
          <span className="flex-1" />
          <button
            onClick={onRefresh}
            disabled={loading}
            className="px-3 py-1 text-xs bg-[var(--surface2)] text-[var(--text)] border border-[var(--border)] rounded-md hover:bg-[var(--border)] cursor-pointer transition-colors disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh Logs'}
          </button>
          <button
            onClick={onDisconnect}
            className="px-3 py-1 text-xs text-[var(--danger)] border border-[var(--border)] rounded-md hover:bg-[rgba(255,107,107,0.1)] cursor-pointer transition-colors bg-transparent"
          >
            Disconnect
          </button>
        </>
      )}
    </header>
  );
}
