import type { ApexLogRecord, SfConnection, SfOrg } from './types';

const BASE = '/api';

export async function listOrgs(): Promise<SfOrg[]> {
  const res = await fetch(`${BASE}/orgs`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to list orgs' }));
    throw new Error(err.error || 'Failed to list orgs');
  }
  const data = await res.json();
  return data.orgs || [];
}

export async function connectToSalesforce(
  targetOrg: string
): Promise<SfConnection> {
  const res = await fetch(`${BASE}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetOrg }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Connection failed' }));
    throw new Error(err.error || 'Connection failed');
  }
  return res.json();
}

export async function fetchApexLogs(
  connId: string,
  limit = 200
): Promise<ApexLogRecord[]> {
  const res = await fetch(`${BASE}/logs?connId=${connId}&limit=${limit}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Query failed' }));
    throw new Error(err.error || 'Failed to fetch logs');
  }
  const data = await res.json();
  return data.records || [];
}

export async function fetchLogBody(
  connId: string,
  logId: string
): Promise<string> {
  const res = await fetch(`${BASE}/logs/${logId}/body?connId=${connId}`);
  if (!res.ok) {
    throw new Error('Failed to fetch log body');
  }
  return res.text();
}

export async function deleteLog(
  connId: string,
  logId: string
): Promise<void> {
  const res = await fetch(`${BASE}/logs/${logId}?connId=${connId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('Failed to delete log');
  }
}
