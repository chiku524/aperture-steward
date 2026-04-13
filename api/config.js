/**
 * Public config for the Vercel landing page (no secrets).
 */

export default function handler(req, res) {
  const base = process.env.AGENT_BASE_URL || '';
  let host = '';
  try {
    host = base ? new URL(base).host : '';
  } catch {
    host = '';
  }
  res.status(200).json({
    configured: Boolean(base),
    agentHost: host,
    repoUrl: process.env.REPO_URL || 'https://github.com/chiku524/aperture-steward',
  });
}
