const DEFAULT_CHANNEL_ID = "1518521479438794874";
const DEFAULT_SHARE_URL = "https://meet.115jon.site/share/9DgdJGfGYzSScaEdVQ8ZzRPp6h0uQH_D";
const DISCORD_API_BASE = "https://discord.com/api/v10";

function parseArgs(argv) {
  const options = {
    channelId: DEFAULT_CHANNEL_ID,
    shareUrl: DEFAULT_SHARE_URL,
    version: Date.now().toString(),
    waitMs: 30000,
    pollIntervalMs: 2000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--channel-id") options.channelId = argv[index + 1];
    if (arg === "--url") options.shareUrl = argv[index + 1];
    if (arg === "--version") options.version = argv[index + 1];
    if (arg === "--wait-ms") options.waitMs = Number(argv[index + 1]);
    if (arg === "--poll-interval-ms") options.pollIntervalMs = Number(argv[index + 1]);
  }

  return options;
}

function buildCacheBustedUrl(rawUrl, version) {
  const url = new URL(rawUrl);
  url.searchParams.set("v", version);
  return url.toString();
}

function summarizeEmbed(embed) {
  return {
    type: embed.type,
    url: embed.url,
    title: embed.title,
    description: embed.description,
    provider: embed.provider?.name,
    thumbnail: embed.thumbnail?.url ?? embed.image?.url,
    video: embed.video?.url ?? embed.video?.proxy_url ?? null,
  };
}

async function discordRequest(path, token, init = {}) {
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bot ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(`Discord API ${response.status}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }

  return payload;
}

async function waitForEmbed(channelId, messageId, token, waitMs, pollIntervalMs) {
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    const message = await discordRequest(`/channels/${channelId}/messages/${messageId}`, token, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (Array.isArray(message.embeds) && message.embeds.length > 0) {
      return message;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out waiting for Discord to resolve embeds for message ${messageId}`);
}

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error("Missing DISCORD_BOT_TOKEN");
  }

  const options = parseArgs(process.argv.slice(2));
  const content = buildCacheBustedUrl(options.shareUrl, options.version);

  const message = await discordRequest(`/channels/${options.channelId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
    }),
  });

  console.log(JSON.stringify({
    action: "message_sent",
    channelId: options.channelId,
    messageId: message.id,
    content,
  }, null, 2));

  const resolved = await waitForEmbed(
    options.channelId,
    message.id,
    token,
    options.waitMs,
    options.pollIntervalMs,
  );

  console.log(JSON.stringify({
    action: "embed_resolved",
    channelId: options.channelId,
    messageId: resolved.id,
    embeds: resolved.embeds.map(summarizeEmbed),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
