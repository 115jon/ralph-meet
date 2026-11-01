import {
  ArrowBendUpLeft,
  PaperPlaneRight,
  PencilSimple,
  PlusCircle,
  X,
  XCircle,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  BackHandler,
  Pressable,
  TextInput,
  View,
  type TextInputInstance,
} from "react-native";

import { useSession } from "@/features/auth/session";
import { mediaUrl } from "@/lib/api";
import { tapHaptic } from "@/lib/haptics";
import { FONT, RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, IconButton, Text } from "@/ui";

import { AttachmentChips, NoticeLine } from "./attach/AttachmentChips";
import { canAttach } from "./attach/sources";
import type { AttachController } from "./attach/useAttach";
import { authorName } from "./authors";
import { clearDraft, readDraft, saveDraft } from "./drafts";
import type { ComposerIntent } from "./MessageActionsSheet";
import { insertMention, mentionQueryAt, suggestPeople } from "./mentions";
import { editMessage, notifyTyping, sendMessage } from "./mutations";
import type { Author } from "./schema";

const MAX_INPUT_HEIGHT = 128;
const KEY = 52;

/** What the message sheet asks of the composer. */
export interface ComposerHandle {
  compose: (intent: ComposerIntent) => void;
}

interface ComposerProps {
  ref?: Ref<ComposerHandle>;
  channelId: string;
  /** "Message #general" or "Message kai". */
  placeholder: string;
  /** Who can be @mentioned here. */
  people: readonly Author[];
  /** The files on the next message and the tray that picks them. */
  attach: AttachController;
  /** The chat is in front, so back cancels a reply or an edit here first. */
  attended: boolean;
}

/** The send key: the one primary, notched at its top-right corner. */
function SendKey({
  enabled,
  onPress,
}: {
  enabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: KEY,
        height: KEY,
        borderRadius: RADIUS,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: enabled ? theme.primaryFill : theme.tint2,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      <Icon
        icon={PaperPlaneRight}
        active
        size={22}
        color={enabled ? theme.onPrimary : theme.inkOff}
      />
      <View
        style={{
          position: "absolute",
          top: -7,
          right: -7,
          width: 14,
          height: 14,
          backgroundColor: theme.ply0,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </Pressable>
  );
}

/** "Replying to kai" or "Editing message" over the box, with a close key. */
function IntentBar({
  icon,
  label,
  detail,
  onCancel,
}: {
  icon: PhosphorIcon;
  label: string;
  detail: string;
  onCancel: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 40,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 12,
        borderTopWidth: 2,
        borderTopColor: theme.ink1,
        backgroundColor: theme.ply2,
        borderRadius: RADIUS,
      }}
    >
      <Icon icon={icon} size={14} color={theme.ink3} />
      <Text variant="silk" tone="ink3" numberOfLines={1}>
        {label}
      </Text>
      <Text
        variant="row"
        tone="ink2"
        numberOfLines={1}
        style={{ flex: 1, fontSize: 13 }}
      >
        {detail}
      </Text>
      <IconButton
        icon={X}
        label={`Cancel ${label.toLowerCase()}`}
        onPress={onCancel}
      />
    </View>
  );
}

function Suggestions({
  people,
  onPick,
}: {
  people: readonly Author[];
  onPick: (person: Author) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel="Mention suggestions"
      style={{
        paddingVertical: 4,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: theme.lineStrong,
        borderTopWidth: 2,
        borderTopColor: theme.ink1,
        backgroundColor: theme.ply3,
      }}
    >
      {people.map((person) => (
        <Pressable
          key={person.id}
          accessibilityRole="button"
          accessibilityLabel={`Mention ${authorName(person)}`}
          onPress={() => onPick(person)}
          style={({ pressed }) => ({
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
            backgroundColor: pressed ? theme.tint2 : "transparent",
          })}
        >
          <Avatar
            name={authorName(person)}
            size={24}
            uri={mediaUrl(person.avatar_url)}
          />
          <Text variant="row" numberOfLines={1} style={{ flexShrink: 1 }}>
            {authorName(person)}
          </Text>
          <Text
            variant="row"
            tone="ink3"
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            @{person.username}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The floating composer: attach key, a Geist field that grows to five
 * lines, and the notched send key. Its text is the conversation's draft,
 * kept across visits and launches; the files come from the attach tray, and
 * the message sheet (or a swipe) steers it into reply or edit through the
 * handle. Back cancels a reply or an edit before it leaves the chat. Sending with files uploads them first (each chip
 * shows its progress), then posts through the optimistic send.
 */
export function Composer({
  ref,
  channelId,
  placeholder,
  people,
  attach,
  attended,
}: ComposerProps) {
  const theme = useTheme();
  const myId = useSession((s) => s.user?.id);
  const input = useRef<TextInputInstance>(null);
  const [text, setText] = useState(() => readDraft(channelId));
  const [cursor, setCursor] = useState(0);
  const [intent, setIntent] = useState<ComposerIntent | null>(null);
  const editingNow = intent?.kind === "edit";

  /** Typing into the draft; an edit's text is the message's, never the draft. */
  const changeText = (next: string) => {
    setText(next);
    if (!editingNow) saveDraft(channelId, next);
  };

  /** Leaves reply or edit; an edit gives the field back its draft. */
  const endIntent = () => {
    if (editingNow) setText(readDraft(channelId));
    setIntent(null);
  };
  const onBack = useEffectEvent(endIntent);

  useEffect(() => {
    if (!intent || !attended) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [intent, attended]);

  useImperativeHandle(ref, () => ({
    compose: (next) => {
      setIntent(next);
      if (next.kind === "edit") {
        const content = next.message.content ?? "";
        setText(content);
        setCursor(content.length);
      } else if (editingNow) {
        setText(readDraft(channelId));
      }
      attach.closeTray();
      input.current?.focus();
    },
  }));

  const editing = intent?.kind === "edit" ? intent.message : null;
  const replyTo = intent?.kind === "reply" ? intent.message : undefined;
  const query = mentionQueryAt(text, cursor);
  const suggestions = query ? suggestPeople(people, query.text, myId) : [];
  const files = editing ? [] : attach.items;
  const canSend =
    !attach.sending &&
    (text.trim().length > 0 || (!editing && files.length > 0));
  const showAttach = canAttach && !editing;

  const submit = async () => {
    if (!canSend) return;
    const content = text.trim();
    if (editing) {
      if (content !== editing.content?.trim())
        void editMessage(editing, content);
      endIntent();
      return;
    }
    const sent = files.length > 0 ? await attach.upload() : [];
    // A failed upload keeps the draft (text, chips and reply) for a retry.
    if (!sent) return;
    if (!content && sent.length === 0) return;
    // The server serves an attachment only once a message links it, so the
    // optimistic row draws the local files; the stored copy brings the real
    // URLs when it replaces the row.
    const attachments = sent.map(({ attachment, localUri }) => ({
      ...attachment,
      url: localUri,
    }));
    sendMessage(channelId, { content, replyTo, attachments });
    tapHaptic();
    attach.clear();
    attach.closeTray();
    clearDraft(channelId);
    setText("");
    setIntent(null);
  };

  return (
    <View style={{ paddingHorizontal: 10, paddingTop: 4, gap: 6 }}>
      {suggestions.length > 0 && query ? (
        <Suggestions
          people={suggestions}
          onPick={(person) => {
            const next = insertMention(text, query, person);
            changeText(next.text);
            setCursor(next.cursor);
          }}
        />
      ) : null}
      {editing ? (
        <IntentBar
          icon={PencilSimple}
          label="Editing"
          detail={editing.content ?? ""}
          onCancel={endIntent}
        />
      ) : replyTo ? (
        <IntentBar
          icon={ArrowBendUpLeft}
          label="Replying to"
          detail={authorName(replyTo.author)}
          onCancel={endIntent}
        />
      ) : null}
      {attach.notice && !editing ? <NoticeLine notice={attach.notice} /> : null}
      {files.length > 0 ? (
        <AttachmentChips
          items={files}
          sending={attach.sending}
          onRemove={attach.remove}
          onRetry={attach.retry}
        />
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <View
          style={{
            flex: 1,
            minHeight: KEY,
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 2,
            paddingLeft: showAttach ? 6 : 12,
            paddingRight: 8,
            borderRadius: RADIUS,
            borderWidth: 1,
            borderColor: theme.lineField,
            backgroundColor: theme.ply2,
          }}
        >
          {showAttach ? (
            <View style={{ paddingVertical: 5 }}>
              <IconButton
                icon={attach.trayOpen ? XCircle : PlusCircle}
                active={attach.trayOpen}
                label={attach.trayOpen ? "Close attachments" : "Attach files"}
                disabled={attach.sending}
                onPress={attach.trayOpen ? attach.closeTray : attach.openTray}
              />
            </View>
          ) : null}
          <TextInput
            ref={input}
            value={text}
            editable={!attach.sending}
            onChangeText={(next) => {
              changeText(next);
              if (next.trim() && !editing) notifyTyping(channelId);
            }}
            onSelectionChange={(event) =>
              setCursor(event.nativeEvent.selection.end)
            }
            // The keyboard and the tray share the space under the composer.
            onFocus={attach.closeTray}
            placeholder={placeholder}
            placeholderTextColor={theme.ink3}
            multiline
            accessibilityLabel={placeholder}
            cursorColor={theme.accentInk}
            selectionColor={theme.accentTint}
            style={{
              flex: 1,
              minHeight: KEY - 2,
              maxHeight: MAX_INPUT_HEIGHT,
              paddingTop: 14,
              paddingBottom: 14,
              fontFamily: FONT.body,
              fontSize: 15,
              lineHeight: 22,
              color: theme.ink1,
              textAlignVertical: "center",
            }}
          />
        </View>
        <SendKey enabled={canSend} onPress={() => void submit()} />
      </View>
    </View>
  );
}
