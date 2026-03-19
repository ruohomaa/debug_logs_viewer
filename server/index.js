import express from 'express';
import cors from 'cors';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// In-memory store for active Salesforce sessions
const sessions = new Map();

// Helper: run sf cli command and parse JSON output
async function sfCommand(args) {
  try {
    const { stdout } = await execFileAsync('sf', [...args, '--json'], {
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0', SF_NO_COLOR: '1', NO_COLOR: '1' },
    });
    return JSON.parse(stdout);
  } catch (err) {
    // sf cli writes JSON to stdout even on failure
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch {}
    }
    throw err;
  }
}

// ── List available SF orgs ──
app.get('/api/orgs', async (_req, res) => {
  try {
    const result = await sfCommand(['org', 'list']);
    // result.result has { nonScratchOrgs, scratchOrgs, sandboxes, other }
    const data = result.result || {};
    const categories = [
      { key: 'sandboxes', label: 'Sandboxes' },
      { key: 'scratchOrgs', label: 'Scratch Orgs' },
      { key: 'devHubs', label: 'Dev Hubs' },
      { key: 'nonScratchOrgs', label: 'Production / Developer' },
      { key: 'other', label: 'Other' },
    ];
    // Assign each org to its first matching category and deduplicate
    const seen = new Set();
    const groups = [];
    for (const { key, label } of categories) {
      const catOrgs = [];
      for (const o of (data[key] || [])) {
        const username = o.username || '';
        if (!username || seen.has(username)) continue;
        seen.add(username);
        catOrgs.push({
          alias: o.alias || '',
          username,
          instanceUrl: o.instanceUrl || '',
          isDefaultUsername: o.isDefaultUsername || false,
          connectedStatus: o.connectedStatus || '',
        });
      }
      if (catOrgs.length > 0) {
        groups.push({ label, orgs: catOrgs });
      }
    }
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list orgs. Is the sf CLI installed?', detail: err.message });
  }
});

// ── Connect to Salesforce using sf CLI org alias/username ──
app.post('/api/connect', async (req, res) => {
  const { targetOrg } = req.body;

  if (!targetOrg) {
    return res.status(400).json({ error: 'targetOrg (alias or username) is required' });
  }

  try {
    const result = await sfCommand(['org', 'display', '--target-org', targetOrg]);

    if (result.status !== 0) {
      return res.status(401).json({
        error: 'Failed to authenticate with Salesforce',
        detail: result.message || JSON.stringify(result),
      });
    }

    const orgInfo = result.result || {};
    const instanceUrl = orgInfo.instanceUrl;
    const accessToken = orgInfo.accessToken;

    if (!instanceUrl || !accessToken) {
      return res.status(401).json({ error: 'Could not retrieve access token. Try running: sf org login web --alias ' + targetOrg });
    }

    // Verify the token works
    const identityResp = await fetch(`${instanceUrl}/services/data/v62.0/limits`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!identityResp.ok) {
      const errText = await identityResp.text();
      return res.status(401).json({ error: 'Access token is invalid or expired. Try re-authenticating.', detail: errText });
    }

    const connId = crypto.randomUUID();
    sessions.set(connId, { instanceUrl, sessionId: accessToken, targetOrg });

    res.json({ connId, instanceUrl, username: orgInfo.username || targetOrg });
  } catch (err) {
    res.status(500).json({ error: 'Connection failed', detail: err.message });
  }
});

// ── Query ApexLog records (fetches ALL via pagination) ──
app.get('/api/logs', async (req, res) => {
  const { connId } = req.query;
  const session = sessions.get(connId);
  if (!session) return res.status(401).json({ error: 'Not connected' });

  const query = `SELECT Id, LogUser.Name, LogLength, Operation, Application, Status, DurationMilliseconds, StartTime, RequestIdentifier, Location, SystemModstamp FROM ApexLog ORDER BY StartTime DESC`;

  try {
    let allRecords = [];
    let url = `${session.instanceUrl}/services/data/v62.0/query?q=${encodeURIComponent(query)}`;

    while (url) {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${session.sessionId}` },
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: 'Query failed', detail: errText });
      }

      const data = await response.json();
      allRecords = allRecords.concat(data.records || []);

      // Follow nextRecordsUrl for pagination
      url = data.nextRecordsUrl
        ? `${session.instanceUrl}${data.nextRecordsUrl}`
        : null;
    }

    res.json({ totalSize: allRecords.length, done: true, records: allRecords });
  } catch (err) {
    res.status(500).json({ error: 'Failed to query logs', detail: err.message });
  }
});

// ── Fetch raw debug log body ──
app.get('/api/logs/:logId/body', async (req, res) => {
  const { connId } = req.query;
  const session = sessions.get(connId);
  if (!session) return res.status(401).json({ error: 'Not connected' });

  try {
    const response = await fetch(
      `${session.instanceUrl}/services/data/v62.0/sobjects/ApexLog/${req.params.logId}/Body/`,
      { headers: { 'Authorization': `Bearer ${session.sessionId}` } }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Failed to fetch log body', detail: errText });
    }

    const body = await response.text();
    res.type('text/plain').send(body);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch log body', detail: err.message });
  }
});

// ── Delete log ──
app.delete('/api/logs/:logId', async (req, res) => {
  const { connId } = req.query;
  const session = sessions.get(connId);
  if (!session) return res.status(401).json({ error: 'Not connected' });

  try {
    const response = await fetch(
      `${session.instanceUrl}/services/data/v62.0/sobjects/ApexLog/${req.params.logId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.sessionId}` },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Failed to delete log', detail: errText });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete log', detail: err.message });
  }
});

// ── Open record in Salesforce ──
app.get('/api/open/:connId/:recordId', (req, res) => {
  const session = sessions.get(req.params.connId);
  if (!session) {
    return res.status(401).send('Session expired or invalid');
  }
  const { instanceUrl, sessionId } = session;
  const retUrl = encodeURIComponent(`/${req.params.recordId}`);
  const url = `${instanceUrl}/secur/frontdoor.jsp?sid=${sessionId}&retURL=${retUrl}`;
  res.redirect(url);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
