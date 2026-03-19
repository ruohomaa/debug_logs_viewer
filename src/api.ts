import type { ApexLogRecord, SfConnection, SfOrg, SfOrgGroup } from './types';

const BASE = '/api';

export async function listOrgs(): Promise<SfOrgGroup[]> {
  const res = await fetch(`${BASE}/orgs`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to list orgs' }));
    throw new Error(err.error || 'Failed to list orgs');
  }
  const data = await res.json();
  // Support both grouped (new) and flat (old) response formats
  if (data.groups) {
    return data.groups;
  }
  if (data.orgs && data.orgs.length > 0) {
    return groupAndDeduplicateOrgs(data.orgs as SfOrg[]);
  }
  return [];
}

/** Client-side grouping by instanceUrl pattern + deduplication by username */
function groupAndDeduplicateOrgs(orgs: SfOrg[]): SfOrgGroup[] {
  const seen = new Set<string>();
  const sandboxes: SfOrg[] = [];
  const production: SfOrg[] = [];
  const other: SfOrg[] = [];

  for (const org of orgs) {
    if (seen.has(org.username)) continue;
    seen.add(org.username);

    if (org.instanceUrl.includes('.sandbox.')) {
      sandboxes.push(org);
    } else if (org.instanceUrl.includes('.my.salesforce.com') || org.instanceUrl.includes('.lightning.force.com')) {
      production.push(org);
    } else {
      other.push(org);
    }
  }

  const groups: SfOrgGroup[] = [];
  if (sandboxes.length > 0) groups.push({ label: 'Sandboxes', orgs: sandboxes });
  if (production.length > 0) groups.push({ label: 'Production / Developer', orgs: production });
  if (other.length > 0) groups.push({ label: 'Other', orgs: other });
  return groups;
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
  connId: string
): Promise<ApexLogRecord[]> {
  const res = await fetch(`${BASE}/logs?connId=${connId}`);
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
