import { useState, useEffect } from 'react';
import type { SfConnection, SfOrg } from '../types';
import { connectToSalesforce, listOrgs } from '../api';

interface Props {
  onConnected: (conn: SfConnection) => void;
}

export default function ConnectPanel({ onConnected }: Props) {
  const [orgs, setOrgs] = useState<SfOrg[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadOrgs();
  }, []);

  const loadOrgs = async () => {
    setLoadingOrgs(true);
    setError('');
    try {
      const result = await listOrgs();
      setOrgs(result);
      // Auto-select the default org
      const defaultOrg = result.find((o) => o.isDefaultUsername);
      if (defaultOrg) {
        setSelectedOrg(defaultOrg.alias || defaultOrg.username);
      } else if (result.length > 0) {
        setSelectedOrg(result[0].alias || result[0].username);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to list orgs');
    } finally {
      setLoadingOrgs(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedOrg) return;
    setError('');
    setConnecting(true);
    try {
      const conn = await connectToSalesforce(selectedOrg);
      onConnected(conn);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 space-y-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-[var(--text)]">
            Connect to Salesforce
          </h2>
          <p className="text-sm text-[var(--text-dim)] mt-2">
            Select an authenticated org from the Salesforce CLI.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-dim)] mb-1.5 uppercase tracking-wide">
              Salesforce Org
            </label>
            {loadingOrgs ? (
              <div className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text-dim)] text-sm">
                Loading orgs from sf CLI...
              </div>
            ) : orgs.length === 0 ? (
              <div className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text-dim)] text-sm">
                No orgs found. Run{' '}
                <code className="text-[var(--accent)]">sf org login web</code> to authenticate.
              </div>
            ) : (
              <select
                value={selectedOrg}
                onChange={(e) => setSelectedOrg(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] text-sm outline-none focus:border-[var(--accent)] transition-colors"
              >
                {orgs.map((org) => {
                  const label = org.alias || org.username;
                  const detail = org.alias ? ` (${org.username})` : '';
                  return (
                    <option key={org.username} value={org.alias || org.username}>
                      {label}{detail}{org.isDefaultUsername ? ' ★' : ''}
                    </option>
                  );
                })}
              </select>
            )}
          </div>
        </div>

        {error && (
          <div className="text-sm text-[var(--danger)] bg-[rgba(255,107,107,0.1)] px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={loadOrgs}
            disabled={loadingOrgs}
            className="px-4 py-2.5 bg-[var(--surface2)] text-[var(--text)] font-medium rounded-lg text-sm hover:bg-[var(--border)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer border border-[var(--border)]"
          >
            Refresh
          </button>
          <button
            onClick={handleConnect}
            disabled={connecting || !selectedOrg || loadingOrgs}
            className="flex-1 py-2.5 bg-[var(--accent)] text-white font-medium rounded-lg text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
