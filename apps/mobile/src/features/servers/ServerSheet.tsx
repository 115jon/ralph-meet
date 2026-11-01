import Constants from "expo-constants";
import { BellSimple, Checks, UserPlus } from "phosphor-react-native";
import { useState } from "react";
import { Linking, Platform, Share, View } from "react-native";

import { createInvite } from "@/features/invites/api";
import { inviteLink } from "@/features/links/links";
import { ApiError } from "@/lib/api";
import { Sheet, SheetRow, showToast, Text } from "@/ui";

import { markServerRead } from "./actions";
import type { Server } from "./schema";

/** Android's per-app notification settings: the channels users tune. */
function openNotificationSettings(): void {
  const pkg = Constants.expoConfig?.android?.package;
  if (Platform.OS !== "android" || !pkg) {
    void Linking.openSettings();
    return;
  }
  Linking.sendIntent("android.settings.APP_NOTIFICATION_SETTINGS", [
    { key: "android.provider.extra.APP_PACKAGE", value: pkg },
  ]).catch(() => Linking.openSettings());
}

/** Makes a week-long invite and hands it to the system share sheet. */
async function shareInvite(server: Server): Promise<void> {
  try {
    const { code } = await createInvite(server.id);
    const link = inviteLink(code);
    await Share.share(
      { message: link, title: `Join ${server.name} on Ralph Meet` },
      { dialogTitle: `Invite people to ${server.name}` },
    );
  } catch (error) {
    const text =
      error instanceof ApiError && error.status === 403
        ? "You can't invite people to this server"
        : error instanceof ApiError && error.status === 429
          ? "Too many invites. Wait a minute."
          : "Could not make an invite. Try again.";
    showToast({ label: "Invite", text, led: "danger" });
  }
}

interface ServerSheetProps {
  server: Server | null;
  onClose: () => void;
}

/**
 * The server's menu, from its name over the tree: invite people (a link
 * through the share sheet), mark every channel read, and the system's
 * notification settings for the app.
 */
export function ServerSheet({ server, onClose }: ServerSheetProps) {
  const [inviting, setInviting] = useState(false);
  return (
    <Sheet
      visible={server !== null}
      onClose={onClose}
      label="Server menu"
      expandable
    >
      {server ? (
        <>
          <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            <Text variant="title" numberOfLines={1}>
              {server.name}
            </Text>
          </View>
          <SheetRow
            icon={UserPlus}
            label={inviting ? "Making a link…" : "Invite people"}
            onPress={() => {
              if (inviting) return;
              setInviting(true);
              void shareInvite(server).finally(() => {
                setInviting(false);
                onClose();
              });
            }}
          />
          <SheetRow
            icon={Checks}
            label="Mark as read"
            onPress={() => {
              onClose();
              markServerRead(server.id);
            }}
          />
          <SheetRow
            icon={BellSimple}
            label="Notification settings"
            onPress={() => {
              onClose();
              openNotificationSettings();
            }}
          />
        </>
      ) : null}
    </Sheet>
  );
}
