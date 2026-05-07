import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Note: Requires Node 18+ for native fetch.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');

// Simple .env.local parser to grab credentials if they are not exported
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      // Remove basic quoting if present
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

const ACCOUNT_ID = process.env.CLOUDFLARE_LOGS_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_LOGS_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("❌ Missing CLOUDFLARE_LOGS_ACCOUNT_ID or CLOUDFLARE_LOGS_API_TOKEN.");
  console.error("");
  console.error("Please add them to your .env.local file:");
  console.error("CLOUDFLARE_LOGS_ACCOUNT_ID=...");
  console.error("CLOUDFLARE_LOGS_API_TOKEN=...");
  console.error("");
  console.error("You can generate an API Token at https://dash.cloudflare.com/profile/api-tokens");
  console.error("Make sure it has the 'Workers Observability' permissions.");
  process.exit(1);
}

const args = process.argv.slice(2);
const limitArgIndex = args.indexOf('--limit');
const limit = limitArgIndex !== -1 ? parseInt(args[limitArgIndex + 1], 10) : 50;

const searchArgIndex = args.indexOf('--search');
const search = searchArgIndex !== -1 ? args[searchArgIndex + 1] : undefined;

const hoursArgIndex = args.indexOf('--hours');
const hoursStr = hoursArgIndex !== -1 ? args[hoursArgIndex + 1] : '1';
const hours = parseFloat(hoursStr);

const isJson = args.includes('--json');

console.log(`🔍 Querying Cloudflare Workers Observability API...`);
console.log(`Config: limit=${limit}, search=${search || '<none>'}, timeframe=past ${hours} hour(s), json=${isJson}`);

const now = Date.now();
const timeFrom = now - hours * 60 * 60 * 1000;

// The Query endpoint payload structure based on CF API schemas
const payload = {
  queryId: "cli-query-" + Date.now(),
  timeframe: {
    from: timeFrom,
    to: now,
  },
  limit,
  // "events" lists the latest logs (similar to the dashboard log view)
  view: "events",
  parameters: {
    ...(search ? {
      needle: {
        value: search,
        isRegex: false,
        matchCase: false
      }
    } : {})
  }
};

const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/observability/telemetry/query`;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    console.error("❌ API Request failed!");
    console.error(JSON.stringify(data.errors || data, null, 2));
    process.exit(1);
  }

  const results = data.result?.events?.events || data.result?.data;

  if (Array.isArray(results) && results.length > 0) {
    console.log(`\n✅ Found ${results.length} events:\n`);

    for (const event of results) {
      if (isJson) {
        const cleanEvent = {
          message: event.source?.message || event.Message || '',
          $workers: event.$workers,
          $metadata: event.$metadata
        };
        console.log(JSON.stringify(cleanEvent, null, 2));
        console.log('------------------------');
        continue;
      }

      const timestamp = new Date(event.timestamp || event.Timestamp).toISOString();
      const scriptName = event.$workers?.scriptName || event.ScriptName || 'unknown';
      const entrypoint = event.$workers?.entrypoint ? ` [${event.$workers.entrypoint}]` : '';
      const level = event.source?.level ? `[${event.source.level.toUpperCase()}] ` : '';

      console.log(`[${timestamp}] ${level}Script: ${scriptName}${entrypoint}`);

      if (event.source?.message) {
        console.log(event.source.message);
      } else if (event.Message || event.Exceptions) {
        if (event.Message) console.log(event.Message);
        if (event.Exceptions) console.log(event.Exceptions);
      } else {
        // No top-level message, might just be a request log
      }

      // Extract internal console logs from DO / Worker
      if (Array.isArray(event.logs) && event.logs.length > 0) {
        for (const l of event.logs) {
          console.log(`   [Worker Log ${l.level || 'INFO'}]: ${l.message?.join(' ') || l.message || JSON.stringify(l)}`);
        }
      }
      if (Array.isArray(event.Exceptions) && event.Exceptions.length > 0) {
        for (const e of event.Exceptions) {
          console.log(`   [Worker EXCEPTION]: ${e.message || JSON.stringify(e)}`);
        }
      }
      if (Array.isArray(event.exceptions) && event.exceptions.length > 0) {
        for (const e of event.exceptions) {
          console.log(`   [Worker EXCEPTION]: ${e.message || JSON.stringify(e)}`);
        }
      }

      console.log('------------------------');
    }
  } else {
    console.log("\n⚠️ No events found in the specified timeframe.");
  }
} catch (e) {
  console.error("❌ Error making request:", e);
  process.exit(1);
}
