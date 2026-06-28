import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ImageViewerThumbnails } from "@/components/chat/ImageViewerThumbnails";

describe("ImageViewerThumbnails", () => {
  it("uses the poster image for non-animated video thumbnails", () => {
    const markup = renderToStaticMarkup(
      <ImageViewerThumbnails
        images={[
          {
            file_key: "attachments/dmca.mp4",
            filename: "dmca.mp4",
            content_type: "video/mp4",
            url: "https://media.example.com/dmca.mp4",
            thumbnailUrl: "https://media.example.com/dmca.jpg",
            sourceUrl: "https://x.com/example/status/1",
          },
        ]}
        currentIndex={0}
        contentFilter="high"
        thumbAspects={{ current: new Map() }}
        setLocalState={() => {}}
        getUrl={() => "https://media.example.com/dmca.mp4"}
        getPosterUrl={() => "https://media.example.com/dmca.jpg"}
      />
    );

    expect(markup).toContain('src="https://media.example.com/dmca.jpg"');
    expect(markup).not.toContain("<video");
  });

  it("keeps animated video thumbnails on the video element path", () => {
    const markup = renderToStaticMarkup(
      <ImageViewerThumbnails
        images={[
          {
            file_key: "attachments/gif.mp4",
            filename: "gif.mp4",
            content_type: "video/mp4",
            url: "https://video.twimg.com/tweet_video/example.mp4",
            isGif: true,
            thumbnailUrl: "https://pbs.twimg.com/tweet_video_thumb/example.jpg",
          },
        ]}
        currentIndex={0}
        contentFilter="high"
        thumbAspects={{ current: new Map() }}
        setLocalState={() => {}}
        getUrl={() => "https://media.example.com/gif.mp4"}
        getPosterUrl={() => "https://media.example.com/gif.jpg"}
      />
    );

    expect(markup).toContain("<video");
    expect(markup).not.toContain('src="https://media.example.com/gif.jpg"');
  });
});
