import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplyPreviewContent, getReplyPreviewText } from "../ReplyPreviewContent";

describe("ReplyPreviewContent", () => {
  it("renders attachment-only fallback", () => {
    const markup = renderToStaticMarkup(
      <ReplyPreviewContent content="" attachmentsCount={1} />
    );

    expect(markup).toContain("Click to see attachment");
    expect(markup).toContain("svg");
  });

  it("computes plain text for accessibility", () => {
    expect(getReplyPreviewText("", 1)).toBe("Click to see attachment");
  });
});
