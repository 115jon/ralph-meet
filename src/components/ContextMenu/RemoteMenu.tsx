import { MonitorX } from "lucide-react";
import React from "react";
import { Divider, MenuItem, Slider, SubMenuItem } from "./ContextMenuItems";

interface RemoteMenuProps {
  userId: string;
  isStreaming?: boolean;
  watchedStreams: Record<string, boolean>;
  stopWatching: () => void;
  clearSubmenu: () => void;
  peerSetting: {
    volume: number;
    muted: boolean;
    alwaysHear: boolean;
    attenuationEnabled: boolean;
    attenuationStrength: number;
  };
  toggleMutePeer: () => void;
  setPeerVolume: (userId: string, val: number) => void;
  toggleAlwaysHear: () => void;
  toggleAttenuation: () => void;
  setPeerAttenuationStrength: (userId: string, val: number) => void;
  activeSubmenu: string | null;
  handleMouseEnterRoot: (label: string | null) => void;
  handleProfile: () => void;
  handleMessage: () => void;
  isModerator: boolean;
  handleServerMute: () => void;
  handleServerDeafen: () => void;
  onClose: () => void;
  voiceChannels: any[];
  handleMove: (channelId: string) => void;
  handleCopyId: () => void;
}

export const RemoteMenu: React.FC<RemoteMenuProps> = ({
  userId,
  isStreaming,
  watchedStreams,
  stopWatching,
  clearSubmenu,
  peerSetting,
  toggleMutePeer,
  setPeerVolume,
  toggleAlwaysHear,
  toggleAttenuation,
  setPeerAttenuationStrength,
  activeSubmenu,
  handleMouseEnterRoot,
  handleProfile,
  handleMessage,
  isModerator,
  handleServerMute,
  handleServerDeafen,
  onClose,
  voiceChannels,
  handleMove,
  handleCopyId,
}) => {
  if (isStreaming && !watchedStreams[userId]) {
    return (
      <>
        <MenuItem
          label="Watch Stream"
          boldLabel
          onMouseEnter={clearSubmenu}
          onClick={stopWatching}
          rightElement={<MonitorX size={18} className="text-[#dbdee1]/40" />}
        />
        <Divider />
        <MenuItem
          label="Always Hear Stream Audio"
          checked={peerSetting.alwaysHear}
          onMouseEnter={clearSubmenu}
          onClick={toggleAlwaysHear}
        />
      </>
    );
  }

  if (isStreaming) {
    return (
      <>
        <MenuItem
          label="Stop Watching"
          boldLabel
          onMouseEnter={clearSubmenu}
          onClick={stopWatching}
          rightElement={<MonitorX size={18} className="text-[#dbdee1]/40" />}
        />

        <Divider />

        <MenuItem
          label="Mute"
          checked={peerSetting.muted}
          onMouseEnter={clearSubmenu}
          onClick={toggleMutePeer}
        />

        <Slider
          label="Stream Volume"
          value={peerSetting.volume}
          onMouseEnter={clearSubmenu}
          onChange={(val) => setPeerVolume(userId, val)}
        />

        <MenuItem
          label="Always Hear Stream Audio"
          checked={peerSetting.alwaysHear}
          onMouseEnter={clearSubmenu}
          onClick={toggleAlwaysHear}
        />

        <Divider />

        <MenuItem
          label="Stream Attenuation"
          description="Automatically reduce stream volume when people are talking."
          checked={peerSetting.attenuationEnabled}
          onMouseEnter={clearSubmenu}
          onClick={toggleAttenuation}
        />

        {peerSetting.attenuationEnabled && (
          <Slider
            label="Stream Attenuation Strength"
            value={peerSetting.attenuationStrength}
            max={100}
            onMouseEnter={clearSubmenu}
            onChange={(val) => setPeerAttenuationStrength(userId, val)}
          />
        )}

        <Divider />

        <SubMenuItem
          label="More Options"
          active={activeSubmenu === "More Options" || activeSubmenu === "StreamingApps"}
          onMouseEnter={() => handleMouseEnterRoot("More Options")}
          submenu={
            <>
              <MenuItem label="Profile" onClick={handleProfile} />
              <MenuItem label="Message" onClick={handleMessage} />
              <Divider />
              <SubMenuItem
                label="Apps"
                active={activeSubmenu === "StreamingApps"}
                onMouseEnter={() => handleMouseEnterRoot("StreamingApps")}
                submenu={<MenuItem label="No Apps" disabled />}
              />
              <Divider />
              {isModerator && (
                <>
                  <MenuItem label="Server Mute" danger onClick={handleServerMute} />
                  <MenuItem label="Server Deafen" danger onClick={handleServerDeafen} />
                </>
              )}
              <MenuItem label="Disconnect" danger onClick={onClose} />
            </>
          }
        />
      </>
    );
  }

  return (
    <>
      <MenuItem label="Profile" onMouseEnter={clearSubmenu} onClick={handleProfile} />
      <MenuItem label="Message" onMouseEnter={clearSubmenu} onClick={handleMessage} />

      <Divider />

      <Slider
        label="User Volume"
        value={peerSetting.volume}
        onMouseEnter={clearSubmenu}
        onChange={(val) => setPeerVolume(userId, val)}
      />

      <Divider />

      <MenuItem
        label="Mute"
        checked={peerSetting.muted}
        onMouseEnter={clearSubmenu}
        onClick={toggleMutePeer}
      />

      <Divider />

      <SubMenuItem
        label="Apps"
        active={activeSubmenu === "Apps"}
        onMouseEnter={() => handleMouseEnterRoot("Apps")}
        submenu={<MenuItem label="No Apps" disabled />}
      />

      {isModerator && (
        <SubMenuItem
          label="Move to"
          active={activeSubmenu === "Move to"}
          onMouseEnter={() => handleMouseEnterRoot("Move to")}
          submenu={voiceChannels.map((ch) => (
            <MenuItem
              key={ch.id}
              label={ch.name}
              onClick={() => handleMove(ch.id)}
            />
          ))}
        />
      )}

      <Divider />

      {isModerator && (
        <>
          <MenuItem label="Server Mute" danger onMouseEnter={clearSubmenu} onClick={handleServerMute} />
          <MenuItem label="Server Deafen" danger onMouseEnter={clearSubmenu} onClick={handleServerDeafen} />
          <Divider />
        </>
      )}

      <MenuItem label="Disconnect" danger onMouseEnter={clearSubmenu} onClick={onClose} />

      <Divider />

      <MenuItem
        label="Copy User ID"
        onMouseEnter={clearSubmenu}
        onClick={handleCopyId}
        rightElement={<span className="text-[10px] bg-rm-bg-active px-1 rounded text-rm-text-muted/40 font-bold shadow-sm">ID</span>}
      />
    </>
  );
};
