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
    const orgs = [
      ...(data.nonScratchOrgs || []),
      ...(data.scratchOrgs || []),
      ...(data.sandboxes || []),
      ...(data.other || []),
    ].map((o) => ({
      alias: o.alias || '',
      username: o.username || '',
      instanceUrl: o.instanceUrl || '',
      isDefaultUsername: o.isDefaultUsername || false,
      connectedStatus: o.connectedStatus || '',
    }));
    res.json({ orgs });
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

// ── Query ApexLog records ──
app.get('/api/logs', async (req, res) => {
  const { connId, limit = '100' } = req.query;
  const session = sessions.get(connId);
  if (!session) return res.status(401).json({ error: 'Not connected' });

  const query = `SELECT Id, LogUser.Name, LogLength, Operation, Application, Status, DurationMilliseconds, StartTime, RequestIdentifier, Location, SystemModstamp FROM ApexLog ORDER BY StartTime DESC LIMIT ${parseInt(limit, 10)}`;

  try {
    const response = await fetch(
      `${session.instanceUrl}/services/data/v62.0/query?q=${encodeURIComponent(query)}`,
      { headers: { 'Authorization': `Bearer ${session.sessionId}` } }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: 'Query failed', detail: errText });
    }

    const data = await response.json();
    res.json(data);
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
