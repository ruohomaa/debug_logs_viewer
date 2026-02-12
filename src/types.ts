// ── Salesforce ApexLog record ──
export interface ApexLogRecord {
  Id: string;
  LogUser?: { Name: string };
  LogLength: number;
  Operation: string;
  Application: string;
  Status: string;
  DurationMilliseconds: number;
  StartTime: string;
  RequestIdentifier: string;
  Location: string;
  SystemModstamp: string;
}

// ── Parsed event from a raw debug log ──
export interface LogEvent {
  lineNum: number;
  timeStr: string;
  nanos: number;
  eventType: string;
  detail: string;
  level: LogLevel;
  category: string;
  raw: string;
  absoluteTimestamp: number;
  sortKey: number;
  // Source tracking (after combining)
  sourceLogId?: string;
  sourceLogName?: string;
  sourceColor?: string;
}

export type LogLevel = 'FATAL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'FINE' | 'FINER' | 'FINEST';

// ── A loaded/parsed log ──
export interface LoadedLog {
  id: string;
  name: string;
  color: string;
  apexLog?: ApexLogRecord;
  rawContent: string;
  events: LogEvent[];
  meta: LogMeta;
  selected: boolean;
}

export interface LogMeta {
  apiVersion?: string;
  eventCount: number;
  startTime: number;
  endTime: number;
  duration: number;
}

// ── Grouped logs by RequestIdentifier ──
export interface LogGroup {
  requestIdentifier: string;
  logs: ApexLogRecord[];
  totalDuration: number;
  startTime: string;
}

// ── Available org from sf CLI ──
export interface SfOrg {
  alias: string;
  username: string;
  instanceUrl: string;
  isDefaultUsername: boolean;
  connectedStatus: string;
}

// ── Connection state ──
export interface SfConnection {
  connId: string;
  instanceUrl: string;
  username: string;
}
