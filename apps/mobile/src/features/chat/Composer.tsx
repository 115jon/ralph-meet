import {
  ArrowBendUpLeft,
  PaperPlaneRight,
  PencilSimple,
  PlusCircle,
  X,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  Pressable,
  TextInput,
  View,
  type TextInputInstance,
} from "react-native";

import { useSession } from "@/features/auth/session";
import { mediaUrl } from "@/lib/api";
import { FONT, RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, IconButton, Led, RemoteImage, Text } from "@/ui";

import type { UploadFile } from "./api";
import { authorName } from "./authors";
import type { ComposerIntent } from "./MessageActionsSheet";
import { insertMention, mentionQueryAt, suggestPeople } from "./mentions";
import {
  editMessage,
  notifyTyping,
  sendMessage,
  uploadFile,
} from "./mutations";
import { canPickImages, pickImages } from "./pick-images";
import type { Attachment, Author } from "./schema";

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
}

interface PendingUpload {
  readonly key: string;
  readonly file: UploadFile;
  /** Null while it uploads. */
  readonly attachment: Attachment | null;
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
        height: 40,
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
      <Text variant="silk" tone="ink3">
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
            height: 44,
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

function UploadTile({
  upload,
  onRemove,
}: {
  upload: PendingUpload;
  onRemove: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 64,
        height: 64,
        borderRadius: RADIUS,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: theme.tint1,
      }}
    >
      <RemoteImage
        url={upload.file.uri}
        style={{ width: "100%", height: "100%" }}
      />
      {upload.attachment ? null : (
        <View
          accessibilityLabel="Uploading"
          style={{
            position: "absolute",
            left: 4,
            bottom: 4,
            padding: 3,
            borderRadius: RADIUS,
            backgroundColor: theme.ply3,
          }}
        >
          <Led state="idle" size={6} />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${upload.file.name}`}
        onPress={onRemove}
        hitSlop={6}
        style={{
          position: "absolute",
          top: 2,
          right: 2,
          width: 22,
          height: 22,
          borderRadius: RADIUS,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.ply3,
        }}
      >
        <Icon icon={X} size={12} />
      </Pressable>
    </View>
  );
}

/**
 * The floating composer: attach key, a Geist field that grows to five
 * lines, and the notched send key. It owns its draft; the message sheet
 * steers it into reply or edit through the handle.
 */
export function Composer({
  ref,
  channelId,
  placeholder,
  people,
}: ComposerProps) {
  const theme = useTheme();
  const myId = useSession((s) => s.user?.id);
  const input = useRef<TextInputInstance>(null);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [intent, setIntent] = useState<ComposerIntent | null>(null);
  const [uploads, setUploads] = useState<readonly PendingUpload[]>([]);

  useImperativeHandle(ref, () => ({
    compose: (next) => {
      setIntent(next);
      if (next.kind === "edit") {
        const content = next.message.content ?? "";
        setText(content);
        setCursor(content.length);
      }
      input.current?.focus();
    },
  }));

  const editing = intent?.kind === "edit" ? intent.message : null;
  const replyTo = intent?.kind === "reply" ? intent.message : undefined;
  const query = mentionQueryAt(text, cursor);
  const suggestions = query ? suggestPeople(people, query.text, myId) : [];
  const uploading = uploads.some((upload) => !upload.attachment);
  const ready = uploads.flatMap((upload) =>
    upload.attachment ? [upload.attachment] : [],
  );
  const canSend =
    !uploading && (text.trim().length > 0 || (!editing && ready.length > 0));

  const cancelIntent = () => {
    if (editing) setText("");
    setIntent(null);
  };

  const submit = () => {
    if (!canSend) return;
    const content = text.trim();
    if (editing) {
      if (content !== editing.content?.trim())
        void editMessage(editing, content);
    } else {
      sendMessage(channelId, { content, replyTo, attachments: ready });
      setUploads([]);
    }
    setText("");
    setIntent(null);
  };

  const attach = async () => {
    const files = await pickImages();
    for (const file of files) {
      const key = `${file.uri}-${Date.now()}`;
      setUploads((list) => [...list, { key, file, attachment: null }]);
      void uploadFile(channelId, file).then((attachment) =>
        setUploads((list) =>
          attachment
            ? list.map((u) => (u.key === key ? { ...u, attachment } : u))
            : list.filter((u) => u.key !== key),
        ),
      );
    }
  };

  return (
    <View style={{ paddingHorizontal: 10, paddingTop: 4, gap: 6 }}>
      {suggestions.length > 0 && query ? (
        <Suggestions
          people={suggestions}
          onPick={(person) => {
            const next = insertMention(text, query, person);
            setText(next.text);
            setCursor(next.cursor);
          }}
        />
      ) : null}
      {editing ? (
        <IntentBar
          icon={PencilSimple}
          label="Editing"
          detail={editing.content ?? ""}
          onCancel={cancelIntent}
        />
      ) : replyTo ? (
        <IntentBar
          icon={ArrowBendUpLeft}
          label="Replying to"
          detail={authorName(replyTo.author)}
          onCancel={cancelIntent}
        />
      ) : null}
      {uploads.length > 0 && !editing ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {uploads.map((upload) => (
            <UploadTile
              key={upload.key}
              upload={upload}
              onRemove={() =>
                setUploads((list) => list.filter((u) => u.key !== upload.key))
              }
            />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <View
          style={{
            flex: 1,
            minHeight: KEY,
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 2,
            paddingLeft: canPickImages && !editing ? 6 : 12,
            paddingRight: 8,
            borderRadius: RADIUS,
            borderWidth: 1,
            borderColor: theme.lineField,
            backgroundColor: theme.ply2,
          }}
        >
          {canPickImages && !editing ? (
            <View style={{ paddingVertical: 5 }}>
              <IconButton
                icon={PlusCircle}
                label="Attach images"
                onPress={() => void attach()}
              />
            </View>
          ) : null}
          <TextInput
            ref={input}
            value={text}
            onChangeText={(next) => {
              setText(next);
              if (next.trim() && !editing) notifyTyping(channelId);
            }}
            onSelectionChange={(event) =>
              setCursor(event.nativeEvent.selection.end)
            }
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
        <SendKey enabled={canSend} onPress={submit} />
      </View>
    </View>
  );
}
