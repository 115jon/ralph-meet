import { getOSName } from "@/stores/useDesktopSettingsStore";
import { Fragment } from "react";
import { ComingLater, Kbd, SettingsCard, SettingsRow } from "./primitives";

/**
 * Call keys (push to talk, mute, deafen) have no binding support in the app
 * yet, so they show as "Coming later". The built-in shortcuts are the ones
 * the app handles today: CommandMenu (Mod+K) and the message composer.
 */
function Keys({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1" aria-label={label} role="img">
      {keys.map((key, index) => (
        <Fragment key={key}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-ui-xs text-ink-2">
              +
            </span>
          ) : null}
          <Kbd>{key}</Kbd>
        </Fragment>
      ))}
    </span>
  );
}

export default function KeybindsPanel() {
  const mac = getOSName() === "macOS";
  const mod = mac ? "⌘" : "Ctrl";
  const modName = mac ? "Command" : "Control";

  return (
    <>
      <SettingsCard id="call-keys">
        <SettingsRow id="push-to-talk" layout="inline">
          {() => <ComingLater />}
        </SettingsRow>
        <SettingsRow id="toggle-mute" layout="inline">
          {() => <ComingLater />}
        </SettingsRow>
        <SettingsRow id="toggle-deafen" layout="inline">
          {() => <ComingLater />}
        </SettingsRow>
      </SettingsCard>

      <SettingsCard id="built-in-shortcuts">
        <SettingsRow id="kb-command-menu" layout="inline">
          {() => <Keys keys={[mod, "K"]} label={`${modName} K`} />}
        </SettingsRow>
        <SettingsRow id="kb-send" layout="inline">
          {() => <Keys keys={["Enter"]} label="Enter" />}
        </SettingsRow>
        <SettingsRow id="kb-new-line" layout="inline">
          {() => <Keys keys={["Shift", "Enter"]} label="Shift Enter" />}
        </SettingsRow>
        <SettingsRow id="kb-edit-last" layout="inline">
          {() => <Keys keys={["↑"]} label="Up arrow" />}
        </SettingsRow>
        <SettingsRow id="kb-cancel-reply" layout="inline">
          {() => <Keys keys={["Esc"]} label="Escape" />}
        </SettingsRow>
      </SettingsCard>
    </>
  );
}
