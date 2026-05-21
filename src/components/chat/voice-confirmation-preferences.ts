export const START_CALL_CONFIRM_KEY = "rm-start-call-skip-confirm";
export const VOICE_SWITCH_CONFIRM_KEY = "rm-voice-switch-skip-confirm";

function shouldShowConfirmation(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "true";
  } catch {
    return true;
  }
}

function resetConfirmationPreference(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore unavailable localStorage, such as private browsing quota errors.
  }
}

export function shouldShowStartCallModal(): boolean {
  return shouldShowConfirmation(START_CALL_CONFIRM_KEY);
}

export function resetStartCallPreference(): void {
  resetConfirmationPreference(START_CALL_CONFIRM_KEY);
}

export function shouldShowVoiceSwitchModal(): boolean {
  return shouldShowConfirmation(VOICE_SWITCH_CONFIRM_KEY);
}

export function resetVoiceSwitchPreference(): void {
  resetConfirmationPreference(VOICE_SWITCH_CONFIRM_KEY);
}
