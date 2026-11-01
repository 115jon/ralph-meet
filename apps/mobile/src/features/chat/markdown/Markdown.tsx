import { memo, type ReactNode, useState } from "react";
import { Linking, Text as RNText, type TextStyle, View } from "react-native";

import { FONT, type Theme, useTheme } from "@/theme";
import { Text } from "@/ui";

import { useMessageLongPress } from "../long-press";
import type { Block, Inline } from "./ast";
import { CodeBlock } from "./CodeBlock";
import { useMemberNames } from "./context";
import { CustomEmoji } from "./CustomEmoji";

/** The web's `1.35em` emoji on 15px prose. */
const EMOJI_SIZE = 20;

/** What the enclosing spans set; nested RN Text inherits all but the face. */
interface Marks {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  /**
   * Inside an unrevealed spoiler: every span draws in the block's ink-3, so
   * nothing shows through. (Android drops a `transparent` span colour.)
   */
  readonly hidden: boolean;
}

interface Env {
  readonly theme: Theme;
  readonly members: ReadonlySet<string>;
  /** A link or spoiler takes the touch; its long-press opens the message's actions. */
  readonly onLongPress: (() => void) | undefined;
}

const PLAIN: Marks = {
  bold: false,
  italic: false,
  underline: false,
  hidden: false,
};

function face({ bold, italic }: Marks): string {
  if (bold) return italic ? FONT.rowStrongItalic : FONT.rowStrong;
  return italic ? FONT.bodyItalic : FONT.body;
}

// Masked links can carry any scheme; only web and mail open.
const OPENABLE = /^(https?:|mailto:)/i;

function openLink(url: string): void {
  Linking.openURL(url).catch(() => undefined);
}

/** Accent ink, no underline at rest: the web's link. */
function linkStyle(marks: Marks, theme: Theme): TextStyle {
  return { color: marks.hidden ? theme.ink3 : theme.accentInk };
}

/** `||spoiler||`: a solid ink-3 block until tapped, then a quiet tint. */
function Spoiler({
  nodes,
  marks,
  env,
}: {
  nodes: readonly Inline[];
  marks: Marks;
  env: Env;
}) {
  const [revealed, setRevealed] = useState(false);
  if (revealed || marks.hidden) {
    return (
      <RNText
        style={revealed ? { backgroundColor: env.theme.tint1 } : undefined}
      >
        {renderInlines(nodes, marks, env)}
      </RNText>
    );
  }
  return (
    <RNText
      accessibilityRole="button"
      accessibilityLabel="Spoiler, tap to reveal"
      onPress={() => setRevealed(true)}
      onLongPress={env.onLongPress}
      suppressHighlighting
      style={{ backgroundColor: env.theme.ink3, color: env.theme.ink3 }}
    >
      {renderInlines(nodes, { ...marks, hidden: true }, env)}
    </RNText>
  );
}

function renderInline(
  node: Inline,
  key: number,
  marks: Marks,
  env: Env,
): ReactNode {
  const { theme } = env;
  const hidden = marks.hidden;
  switch (node.kind) {
    case "text":
      return node.text;
    case "bold":
    case "italic": {
      const next = { ...marks, [node.kind]: true };
      return (
        <RNText key={key} style={{ fontFamily: face(next) }}>
          {renderInlines(node.children, next, env)}
        </RNText>
      );
    }
    case "underline":
      return (
        <RNText key={key} style={{ textDecorationLine: "underline" }}>
          {renderInlines(node.children, { ...marks, underline: true }, env)}
        </RNText>
      );
    case "strike":
      return (
        <RNText
          key={key}
          style={{
            textDecorationLine: marks.underline
              ? "underline line-through"
              : "line-through",
          }}
        >
          {node.text}
        </RNText>
      );
    case "code":
      return (
        <RNText
          key={key}
          style={{
            fontFamily: FONT.code,
            fontSize: 13,
            color: hidden ? theme.ink3 : theme.ink1,
            backgroundColor: hidden ? theme.ink3 : theme.tint2,
          }}
        >
          {/* Hair spaces stand in for the web's px-1 inside the tint. */}
          {` ${node.text} `}
        </RNText>
      );
    case "spoiler":
      return (
        <Spoiler key={key} nodes={node.children} marks={marks} env={env} />
      );
    case "link":
      return OPENABLE.test(node.url) ? (
        <RNText
          key={key}
          accessibilityRole="link"
          accessibilityHint={node.url}
          onPress={hidden ? undefined : () => openLink(node.url)}
          onLongPress={hidden ? undefined : env.onLongPress}
          style={linkStyle(marks, theme)}
        >
          {node.text}
        </RNText>
      ) : (
        node.text
      );
    case "url":
      return (
        <RNText
          key={key}
          accessibilityRole="link"
          onPress={hidden ? undefined : () => openLink(node.url)}
          onLongPress={hidden ? undefined : env.onLongPress}
          style={linkStyle(marks, theme)}
        >
          {node.url}
        </RNText>
      );
    case "mention": {
      const member = env.members.has(node.username.toLowerCase());
      return (
        <RNText
          key={key}
          style={{
            fontFamily: FONT.row,
            color: hidden ? theme.ink3 : member ? theme.accentInk : theme.ink2,
            backgroundColor: hidden
              ? theme.ink3
              : member
                ? theme.accentTint
                : theme.tint1,
          }}
        >
          {`@${node.username}`}
        </RNText>
      );
    }
    case "emoji":
      return node.native;
    case "customEmoji":
      return (
        <CustomEmoji
          key={key}
          name={node.name}
          id={node.id}
          size={EMOJI_SIZE}
          hidden={hidden}
        />
      );
  }
}

function renderInlines(
  nodes: readonly Inline[],
  marks: Marks,
  env: Env,
): ReactNode[] {
  return nodes.map((node, index) => renderInline(node, index, marks, env));
}

/** A quiet "(edited)" after the last line of text. */
function Edited() {
  return (
    <Text tone="ink3" style={{ fontSize: 11 }}>
      {" (edited)"}
    </Text>
  );
}

function TextBlock({
  block,
  env,
  edited,
}: {
  block: Extract<Block, { kind: "paragraph" | "quote" }>;
  env: Env;
  edited: boolean;
}) {
  const body = (
    <Text
      variant="body"
      tone={block.kind === "quote" ? "ink2" : "ink1"}
      style={block.kind === "quote" ? { flex: 1, paddingLeft: 10 } : null}
    >
      {renderInlines(block.children, PLAIN, env)}
      {edited ? <Edited /> : null}
    </Text>
  );
  if (block.kind === "paragraph") return body;
  // A quote: a 2px rule down the left, never a hue.
  return (
    <View style={{ flexDirection: "row", marginVertical: 2 }}>
      <View
        style={{
          width: 2,
          marginVertical: 2,
          backgroundColor: env.theme.lineStrong,
        }}
      />
      {body}
    </View>
  );
}

/**
 * Parsed message content, drawn the way the web draws it: each paragraph
 * and quote is one Text of nested spans, fences are code blocks. Nothing is
 * selectable; copying lives in the message's action sheet.
 */
export const Markdown = memo(function Markdown({
  blocks,
  edited = false,
}: {
  blocks: readonly Block[];
  /** Appends "(edited)" after the last text. */
  edited?: boolean;
}) {
  const theme = useTheme();
  const members = useMemberNames();
  const onLongPress = useMessageLongPress();
  const env: Env = { theme, members, onLongPress };
  const last = blocks.at(-1);
  const editedInline = edited && last !== undefined && last.kind !== "code";
  const nodes = blocks.map((block, index) =>
    block.kind === "code" ? (
      <CodeBlock key={index} language={block.language} code={block.code} />
    ) : (
      <TextBlock
        key={index}
        block={block}
        env={env}
        edited={editedInline && index === blocks.length - 1}
      />
    ),
  );
  if (nodes.length === 1 && last?.kind === "paragraph") return nodes[0];
  return (
    <View>
      {nodes}
      {edited && !editedInline ? <Edited /> : null}
    </View>
  );
});
