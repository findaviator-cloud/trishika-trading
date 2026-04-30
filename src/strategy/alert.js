/**
 * alert.js
 * Non-blocking webhook alert helper for Trishika Trading.
 *
 * Supports Slack, Discord, and generic JSON webhooks.
 * Never throws — failures are logged to console only, never crash a cycle.
 *
 * Usage:
 *   import { sendAlert } from './alert.js';
 *   await sendAlert({ level: 'WARN', type: 'PORTFOLIO_LIMIT_BREACH', message: '...', payload: {} });
 *
 * Levels: INFO | WARN | ERROR
 * Set ALERT_WEBHOOK_URL in .env. Leave blank to disable (log-only mode).
 */

import https   from 'https';
import http    from 'http';
import { URL } from 'url';

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';

// Emoji prefix per level — works in Slack and Discord
const LEVEL_PREFIX = { INFO: 'ℹ️', WARN: '⚠️', ERROR: '🚨' };

/**
 * sendAlert({ level, type, message, payload })
 * level   — 'INFO' | 'WARN' | 'ERROR'
 * type    — log code string e.g. 'PORTFOLIO_LIMIT_BREACH'
 * message — human-readable summary
 * payload — arbitrary object, serialised into alert body
 *
 * Returns true if delivered, false if skipped or failed.
 * Never rejects — safe to fire-and-forget with .catch(() => {}).
 */
export async function sendAlert({ level = 'INFO', type, message, payload = {} }) {
  const prefix = LEVEL_PREFIX[level] ?? '🔔';
  const ts     = new Date().toISOString();

  // Always log locally regardless of webhook config
  console.log(`${prefix} [ALERT/${type}] ${message}`);

  if (!WEBHOOK_URL) return false;   // webhook not configured — log-only mode

  // Build body — detect Slack vs Discord vs generic by URL shape
  let body;
  if (WEBHOOK_URL.includes('discord.com')) {
    // Discord expects { content: string }
    body = JSON.stringify({
      content: `${prefix} **[${type}]** ${message}\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
    });
  } else if (WEBHOOK_URL.includes('hooks.slack.com') || WEBHOOK_URL.includes('slack.com')) {
    // Slack incoming webhook expects { text: string }
    body = JSON.stringify({
      text: `${prefix} *[${type}]* ${message}`,
      attachments: [{
        color: level === 'ERROR' ? 'danger' : level === 'WARN' ? 'warning' : 'good',
        text:  `\`\`\`${JSON.stringify(payload, null, 2)}\`\`\``,
        footer: `trishika-trading • ${ts}`,
      }],
    });
  } else {
    // Generic JSON webhook
    body = JSON.stringify({ level, type, message, payload, ts });
  }

  try {
    const u    = new URL(WEBHOOK_URL);
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const lib = u.protocol === 'https:' ? https : http;
    await new Promise((resolve, reject) => {
      const req = lib.request(opts, res => {
        res.resume();
        res.on('end', resolve);
      });
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    return true;
  } catch (err) {
    // Non-blocking — log failure, never propagate
    console.error(`[ALERT] Webhook delivery failed (${type}): ${err.message}`);
    return false;
  }
}
