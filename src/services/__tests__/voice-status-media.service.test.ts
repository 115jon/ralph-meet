import { beforeEach, describe, expect, it } from "vitest";

import { createMockD1 } from "../../lib/__tests__/mock-d1";
import {
  createOrReuseExternalVoiceStatusMediaAsset,
  createVoiceStatusMediaAsset,
  getVoiceStatusMediaAssetById,
  listRecentVoiceStatusMediaAssets,
} from "../voice-status-media.service";

const SERVER_ID = "server-1";
const CHANNEL_ID = "channel-1";
const USER_ID = "user-1";
const ASSET_ID = "asset-1";
const NOW = "2026-06-20T12:00:00.000Z";

describe("voice-status-media.service", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("stores a new voice status media asset and maps it for the UI", async () => {
    const asset = await createVoiceStatusMediaAsset(db as any, {
      serverId: SERVER_ID,
      channelId: CHANNEL_ID,
      userId: USER_ID,
      filename: "party.png",
      contentType: "image/png",
      previewWidth: 1920,
      previewHeight: 1080,
      sizeBytes: 42_000,
      createdAt: NOW,
    });

    db.assertCalled(/INSERT INTO voice_status_media_assets/);
    expect(asset.server_id).toBe(SERVER_ID);
    expect(asset.channel_id).toBe(CHANNEL_ID);
    expect(asset.media.preview_url).toContain("/api/voice-status-media/");
    expect(asset.media.preview_content_type).toBe("image/png");
  });

  it("lists recent assets for a server", async () => {
    db.mockQuery("FROM voice_status_media_assets", {
      results: [{
        id: ASSET_ID,
        server_id: SERVER_ID,
        channel_id: CHANNEL_ID,
        user_id: USER_ID,
        filename: "vibe.webm",
        file_key: "voice-status-media/server-1/asset-1/vibe.webm",
        content_type: "video/webm",
        preview_width: 640,
        preview_height: 360,
        size_bytes: 1234,
        created_at: NOW,
      }],
    });

    const assets = await listRecentVoiceStatusMediaAssets(db as any, SERVER_ID, 12);

    expect(assets).toHaveLength(1);
    expect(assets[0].media.preview_content_type).toBe("video/webm");
    expect(assets[0].media.title).toBeNull();
  });

  it("loads a specific asset by id with its file key", async () => {
    db.mockQuery("WHERE id = ?", {
      id: ASSET_ID,
      server_id: SERVER_ID,
      channel_id: CHANNEL_ID,
      user_id: USER_ID,
      filename: "party.gif",
      file_key: "voice-status-media/server-1/asset-1/party.gif",
      content_type: "image/gif",
      preview_width: 480,
      preview_height: 320,
      size_bytes: 5678,
      created_at: NOW,
    });

    const asset = await getVoiceStatusMediaAssetById(db as any, ASSET_ID);

    expect(asset).not.toBeNull();
    expect(asset?.fileKey).toBe("voice-status-media/server-1/asset-1/party.gif");
    expect(asset?.media.preview_url).toContain(ASSET_ID);
  });

  it("maps external recent assets back to their original preview url", async () => {
    db.mockQuery("FROM voice_status_media_assets", {
      results: [{
        id: ASSET_ID,
        server_id: SERVER_ID,
        channel_id: CHANNEL_ID,
        user_id: USER_ID,
        filename: "tenor-asset.gif",
        file_key: "external-url:https://media.tenor.com/example.gif",
        content_type: "image/gif",
        preview_width: 320,
        preview_height: 180,
        size_bytes: 0,
        created_at: NOW,
      }],
    });

    const assets = await listRecentVoiceStatusMediaAssets(db as any, SERVER_ID, 12);

    expect(assets).toHaveLength(1);
    expect(assets[0].media.provider).toBe("external");
    expect(assets[0].media.preview_url).toBe("https://media.tenor.com/example.gif");
  });

  it("reuses an existing external asset when the same preview URL is chosen again", async () => {
    db.mockQuery("WHERE file_key = ?", {
      id: ASSET_ID,
      server_id: SERVER_ID,
      channel_id: CHANNEL_ID,
      user_id: USER_ID,
      filename: "tenor-asset.gif",
      file_key: "external-url:https://media.tenor.com/example.gif",
      content_type: "image/gif",
      preview_width: 320,
      preview_height: 180,
      size_bytes: 0,
      created_at: NOW,
    });

    const asset = await createOrReuseExternalVoiceStatusMediaAsset(db as any, {
      assetId: "asset-2",
      fileKey: "external-url:https://media.tenor.com/example.gif",
      serverId: SERVER_ID,
      channelId: "channel-2",
      userId: "user-2",
      filename: "duplicate.gif",
      contentType: "image/gif",
      previewWidth: 400,
      previewHeight: 225,
      sizeBytes: 0,
      createdAt: NOW,
    });

    expect(asset.id).toBe(ASSET_ID);
    expect(asset.fileKey).toBe("external-url:https://media.tenor.com/example.gif");
    db.assertNotCalled(/INSERT INTO voice_status_media_assets/);
  });

  it("creates a new external asset when the preview URL has not been seen before", async () => {
    const asset = await createOrReuseExternalVoiceStatusMediaAsset(db as any, {
      assetId: "asset-2",
      fileKey: "external-url:https://media.tenor.com/new.gif",
      serverId: SERVER_ID,
      channelId: CHANNEL_ID,
      userId: USER_ID,
      filename: "new.gif",
      contentType: "image/gif",
      previewWidth: 320,
      previewHeight: 180,
      sizeBytes: 0,
      createdAt: NOW,
    });

    expect(asset.id).toBe("asset-2");
    expect(asset.fileKey).toBe("external-url:https://media.tenor.com/new.gif");
    db.assertCalled(/INSERT INTO voice_status_media_assets/);
  });
});
