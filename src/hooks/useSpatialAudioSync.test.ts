// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { useCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSpatialAudioSync } from "@/hooks/useSpatialAudioSync";
import { DEFAULT_SHARED_SPATIAL_STATE } from "@/lib/voice/spatial-audio";

describe("useSpatialAudioSync", () => {
  it("does not loop when its state dispatch causes a rerender", () => {
    const sendVoiceStateUpdate = vi.fn();
    const initialState = {
      ...DEFAULT_SHARED_SPATIAL_STATE,
      enabled: true,
      updatedAt: 1,
    };

    const { result } = renderHook(() => {
      const [spatialAudioState, setSpatialAudioState] = useState(initialState);
      const dispatch = useCallback(
        (action: {
          type: "SET_SPATIAL_AUDIO_STATE";
          payload: typeof initialState;
        }) => setSpatialAudioState(action.payload),
        [],
      );

      useSpatialAudioSync({
        joined: true,
        spatialAudioEnabled: true,
        streamHighFidelity: false,
        spatialAudioState,
        dispatch,
        sendVoiceStateUpdate,
      });

      return spatialAudioState;
    });

    expect(result.current.enabled).toBe(true);
    expect(sendVoiceStateUpdate).toHaveBeenCalledTimes(1);
  });
});
