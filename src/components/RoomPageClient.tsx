"use client";

import JoinForm from "@/components/JoinForm";
import MediaControls from "@/components/MediaControls";
import VideoGrid from "@/components/VideoGrid";
import SettingsModal from "@/components/chat/SettingsModal";
import { Badge } from "@/components/ui/badge";
import { SFUClient } from "@/lib/sfu-client";
import type { VoiceState } from "@/lib/types";
import { useAudioConstraintSync, useMediaDevices } from "@/lib/useMediaDevices";
import { cn } from "@/lib/utils";
import { UserButton, useUser } from "@clerk/nextjs";
import { Pencil, Radio } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface StreamEntry {
  id: string;
  name: string;
  avatarUrl?: string | null;
  stream: MediaStream | null;
  isLocal: boolean;
  isScreenShare: boolean;
  isMuted: boolean;
  isCameraOff?: boolean;
  isSpeaking?: boolean;
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const slug = params.slug as string;

  const [joined, setJoined] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [streams, setStreams] = useState<StreamEntry[]>([]);
  const [connectionState, setConnectionState] = useState("new");
  const [participantCount, setParticipantCount] = useState(0);
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  const sfuRef = useRef<SFUClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const participantsRef = useRef<Map<string, VoiceState>>(new Map());
  const myIdRef = useRef<string>("");
  const myNameRef = useRef<string>("");
  const myAvatarRef = useRef<string | null>(null);

  // Device detection — live updates on plug/unplug
  const { hasMicrophone, hasCamera, audioInputs, videoInputs } = useMediaDevices();

  // Keep audio processing disabled on the live local stream
  useAudioConstraintSync(localStreamRef.current, {
    noiseSuppression: false,
    echoCancellation: false,
    autoGainControl: false,
  });


  // ── Auto-join on reload if name is stored ──────────────────────────────

  useEffect(() => {
    if (!isLoaded) return; // Wait for Clerk to load user data (imageUrl, id)
    const storedName = sessionStorage.getItem("meet-display-name");
    const autoJoin = sessionStorage.getItem(`meet-autojoin-${slug}`);
    if (storedName && autoJoin) {
      handleJoin(storedName, slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isLoaded]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      sfuRef.current?.disconnect();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Rebuild streams array from current state ───────────────────────────

  const rebuildStreams = useCallback(() => {
    setStreams((prev) => {
      const entries: StreamEntry[] = [];

      // Local camera tile — always present once joined
      if (joined) {
        const stream = localStreamRef.current;
        const videoTracks = stream?.getVideoTracks() ?? [];
        const audioTracks = stream?.getAudioTracks() ?? [];
        const hasVideo = videoTracks.some((t) => t.enabled && t.readyState === "live");
        const hasAudio = audioTracks.length > 0;

        const localId = `local-camera-${myIdRef.current}`;
        const prevLocal = prev.find((s) => s.id === localId);

        entries.push({
          id: localId,
          name: myNameRef.current,
          avatarUrl: myAvatarRef.current,
          stream: (hasVideo || hasAudio) ? stream : null,
          isLocal: true,
          isScreenShare: false,
          isMuted: !isMicOn,
          isCameraOff: !isCameraOn,
          isSpeaking: prevLocal?.isSpeaking,
        });
      }

      // Local screen share
      if (screenStreamRef.current) {
        entries.push({
          id: `local-screen-${myIdRef.current}`,
          name: myNameRef.current,
          avatarUrl: myAvatarRef.current,
          stream: screenStreamRef.current,
          isLocal: true,
          isScreenShare: true,
          isMuted: false,
          setIsDeafened: false,
        } as any);
      }

      // Keep remote streams from previous state
      const remotes = prev.filter(
        (s) => !s.isLocal
      );
      return [...entries, ...remotes];
    });
  }, [joined, isMicOn, isCameraOn]);

  // ── Auto-rebuild streams when state changes ─────────────────────────────
  // rebuildStreams depends on [joined, isMicOn, isCameraOn], so its reference
  // changes whenever any of those change, triggering this effect.

  useEffect(() => {
    rebuildStreams();
  }, [rebuildStreams]);

  // ── Sync Clerk user data → refs (reactive to profile edits) ────────────
  useEffect(() => {
    if (!user || !joined) return;
    const newName = (user.unsafeMetadata?.displayName as string) || user.fullName || user.firstName || user.username || "Guest";
    const newAvatar = user.imageUrl || null;
    const nameChanged = myNameRef.current !== newName;
    const avatarChanged = myAvatarRef.current !== newAvatar;
    if (nameChanged || avatarChanged) {
      myNameRef.current = newName;
      myAvatarRef.current = newAvatar;
      rebuildStreams();
      // Ping the DO to fetch verified profile from Clerk and broadcast to others
      sfuRef.current?.sendProfileRefresh();
    }
  }, [user?.username, user?.imageUrl, user?.unsafeMetadata, user?.fullName, user?.firstName, joined, rebuildStreams]);

  // ── Join handler ───────────────────────────────────────────────────────

  const handleJoin = useCallback(
    async (name: string, _room: string) => {
      myNameRef.current = name;
      myAvatarRef.current = user?.imageUrl || null;

      // Mark for auto-rejoin on reload
      sessionStorage.setItem("meet-display-name", name);
      sessionStorage.setItem(`meet-autojoin-${slug}`, "true");

      const sfu = new SFUClient(slug);
      sfuRef.current = sfu;

      // ── SFU event handlers ───────────────────────────────────────────

      sfu.on("joined", ({ participantId, participants }) => {
        myIdRef.current = participantId;
        setJoined(true);

        // Store existing participants (now VoiceState objects)
        for (const p of participants) {
          console.log(`[Room] Existing participant: id=${p.id}, name=${p.name}, avatar_url=${p.avatar_url}, self_video=${p.self_video}`);
          participantsRef.current.set(p.id, p);
        }
        setParticipantCount(participants.length + 1);

        // Create avatar tiles for all existing participants immediately
        setStreams((prev) => {
          const newEntries: StreamEntry[] = participants.map((p) => ({
            id: `remote-camera-${p.id}`,
            name: p.name,
            avatarUrl: p.avatar_url,
            stream: null,
            isLocal: false,
            isScreenShare: false,
            isMuted: p.self_mute,
            isCameraOff: !p.self_video,
          }));
          return [...prev, ...newEntries];
        });

        // Publish local tracks if media is already available
        if (localStreamRef.current) {
          sfu.publishTracks(localStreamRef.current, "cam");
        }

        // Always send initial mute state so other participants know our
        // mic/camera status — even if we have no media at all.
        const curStream = localStreamRef.current;
        const micOn = curStream
          ? curStream.getAudioTracks().some((t) => t.enabled && t.readyState === "live")
          : false;
        const camOn = curStream
          ? curStream.getVideoTracks().some((t) => t.enabled && t.readyState === "live")
          : false;
        sfu.sendMuteUpdate(micOn, camOn);

        // Start VAD if mic is active on join
        if (micOn && curStream) {
          sfu.startVAD(curStream);
        }

        rebuildStreams();
      });

      sfu.on("participant-joined", ({ participant }) => {
        console.log(`[Room] participant-joined: id=${participant.id}, name=${participant.name}, avatar_url=${participant.avatar_url}`);
        participantsRef.current.set(participant.id, participant);
        setParticipantCount((prev) => prev + 1);

        // Create an avatar tile immediately for the new participant
        setStreams((prev) => [
          ...prev,
          {
            id: `remote-camera-${participant.id}`,
            name: participant.name,
            avatarUrl: participant.avatar_url,
            stream: null,
            isLocal: false,
            isScreenShare: false,
            isMuted: participant.self_mute,
            isCameraOff: !participant.self_video,
          },
        ]);
      });

      sfu.on("profile-update", ({ participantId, name: newName, avatarUrl }) => {
        // Update stored participant info
        const p = participantsRef.current.get(participantId);
        if (p) {
          p.name = newName;
          p.avatar_url = avatarUrl;
        }
        // Update the stream entries for this participant
        setStreams((prev) =>
          prev.map((s) =>
            s.id.endsWith(participantId) && !s.isLocal
              ? { ...s, name: newName, avatarUrl }
              : s
          )
        );
      });

      sfu.on("participant-left", ({ participantId }) => {
        participantsRef.current.delete(participantId);
        setParticipantCount((prev) => Math.max(1, prev - 1));
        // Remove their streams
        setStreams((prev) =>
          prev.filter((s) => !s.id.includes(participantId))
        );
      });

      sfu.on("tracks-published", ({ participantId, tracks }) => {
        const p = participantsRef.current.get(participantId);
        if (p) {
          p.tracks = [...p.tracks, ...tracks];
        }
      });

      sfu.on("tracks-stopped", ({ participantId, trackNames }) => {
        console.log(`[Room] Tracks stopped by ${participantId}:`, trackNames);
        // Remove stopped tracks from participant info
        const p = participantsRef.current.get(participantId);
        if (p) {
          p.tracks = p.tracks.filter(
            (t) => !trackNames.includes(t.track_name)
          );
        }
        // Determine if screen tracks were stopped
        const isScreenStop = trackNames.some((n) => n.includes("screen"));
        if (isScreenStop) {
          setStreams((prev) =>
            prev.filter(
              (s) => !(s.id === `remote-screen-${participantId}`)
            )
          );
        }
      });

      // Speaking event — now purely VAD voice activity (from Voice GW)
      // Sets isSpeaking ring for remote participants
      sfu.on("speaking", ({ participantId, speaking }) => {
        const isSpeaking = speaking > 0;
        setStreams((prev) =>
          prev.map((s) => {
            if (s.id === `remote-camera-${participantId}`) {
              return { ...s, isSpeaking };
            }
            return s;
          })
        );
      });

      // Voice state update — mute/camera state changes from remote participants
      sfu.on("voice-state-update", ({ participant, action }) => {
        if (action === "update") {
          // Update stored participant info
          const p = participantsRef.current.get(participant.id);
          if (p) {
            p.self_mute = participant.self_mute;
            p.self_video = participant.self_video;
          }
          setStreams((prev) =>
            prev.map((s) => {
              if (s.id === `remote-camera-${participant.id}`) {
                return { ...s, isMuted: participant.self_mute, isCameraOff: !participant.self_video };
              }
              return s;
            })
          );
        }
      });

      // VAD (voice activity detection) — speaking ring indicator for LOCAL user
      sfu.on("vad-speaking", ({ participantId, isSpeaking }) => {
        setStreams((prev) =>
          prev.map((s) => {
            // Match local camera tile: local-camera-{participantId}
            if (s.id === `local-camera-${participantId}`) {
              return { ...s, isSpeaking };
            }
            return s;
          })
        );
      });

      sfu.on("remote-track", ({ participantId, track, trackInfo }) => {
        const participant = participantsRef.current.get(participantId);
        const pName = participant?.name ?? "Unknown";
        const isScreen = trackInfo.track_name.includes("screen");

        console.log(
          `[Room] remote-track: participant=${participantId}, name=${pName}, ` +
          `track=${track.kind}, muted=${track.muted}, readyState=${track.readyState}, isScreen=${isScreen}`
        );

        setStreams((prev) => {
          const streamId = isScreen
            ? `remote-screen-${participantId}`
            : `remote-camera-${participantId}`;

          const existing = prev.find((s) => s.id === streamId);

          if (existing) {
            if (existing.stream) {
              // For video tracks: remove any stale/dead video tracks first.
              if (track.kind === "video") {
                for (const oldTrack of existing.stream.getVideoTracks()) {
                  existing.stream.removeTrack(oldTrack);
                }
              }
              existing.stream.addTrack(track);
              console.log(`[Room] Added ${track.kind} track to existing stream ${streamId}`);
            } else {
              // Replace the null placeholder with a real stream
              existing.stream = new MediaStream([track]);
              console.log(`[Room] Attached first track to placeholder ${streamId}`);
            }
            // If a video track arrived, camera is genuinely on (we're receiving real data)
            if (track.kind === "video") {
              const pInfo = participantsRef.current.get(participantId);
              if (pInfo) pInfo.self_video = true;
              const updatedStream = new MediaStream(existing.stream.getTracks());
              return prev.map((s) =>
                s.id === streamId ? { ...s, stream: updatedStream, isCameraOff: false } : s
              );
            }
            return [...prev];
          }

          // New stream entry (e.g. screen share, or participant we didn't see join)
          const newStream = new MediaStream([track]);
          const newEntry: StreamEntry = {
            id: streamId,
            name: pName,
            avatarUrl: participant?.avatar_url,
            stream: newStream,
            isLocal: false,
            isScreenShare: isScreen,
            isMuted: false,
            isCameraOff: track.kind !== "video",
          };

          console.log(`[Room] Created new stream ${streamId}`);
          return [...prev, newEntry];
        });
      });

      sfu.on("connection-state", ({ state }) => {
        setConnectionState(state);
      });

      sfu.on("error", ({ message }) => {
        console.error("[Room] SFU error:", message);
      });

      sfu.on("push-pc-reset", () => {
        // pushPC was recreated (e.g. after screen share stop) — re-publish camera
        if (localStreamRef.current && myIdRef.current) {
          sfu.publishTracks(localStreamRef.current, "cam");
        }
      });

      // Connect first — media is acquired in parallel, never blocking join
      console.log(`[Room] Connecting with avatarUrl=${user?.imageUrl}, clerkUserId=${user?.id}`);
      sfu.connect(name, user?.imageUrl || undefined, user?.id);

      // Acquire media in the background (non-blocking)
      setIsCameraOn(false);
      setIsMicOn(false);

      // Audio constraints: disable processing for clean audio
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      // Acquire media with fallback chain, guided by device detection
      const acquireMedia = async (): Promise<MediaStream | null> => {
        const wantVideo = hasCamera;
        const wantAudio = hasMicrophone;

        // Try with detected devices + constraints
        if (wantAudio || wantVideo) {
          try {
            return await navigator.mediaDevices.getUserMedia({
              audio: wantAudio ? audioConstraints : false,
              video: wantVideo ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, max: 30 },
              } : false,
            });
          } catch { /* fall through */ }
        }

        // If camera failed but mic is available, try audio-only
        if (wantAudio && wantVideo) {
          try {
            return await navigator.mediaDevices.getUserMedia({
              audio: audioConstraints,
              video: false,
            });
          } catch { /* fall through */ }
        }

        // Fallback: try basic audio: true as default device
        try {
          return await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
        } catch { /* fall through */ }

        return null;
      };

      acquireMedia().then((stream) => {
        if (stream) {
          localStreamRef.current = stream;
          const hasVideo = stream.getVideoTracks().length > 0;
          const hasAudio = stream.getAudioTracks().length > 0;
          setIsCameraOn(hasVideo);
          setIsMicOn(hasAudio);

          // If already joined, publish tracks now
          if (sfuRef.current && myIdRef.current) {
            sfuRef.current.publishTracks(stream, "cam");
            sfuRef.current.sendMuteUpdate(hasAudio, hasVideo);
          }
        } else {
          // No media — user joins as a listener.
          if (sfuRef.current && myIdRef.current) {
            sfuRef.current.sendMuteUpdate(false, false);
          }
        }
      });
    },
    [slug, rebuildStreams, hasMicrophone, hasCamera, user?.imageUrl, user?.id]
  );

  // ── Media controls ─────────────────────────────────────────────────────

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const newState = !isMicOn;
    for (const track of stream.getAudioTracks()) {
      track.enabled = newState;
    }
    setIsMicOn(newState);
    // Signal mute state to other participants
    sfuRef.current?.sendMuteUpdate(newState, isCameraOn);
    // Start/stop VAD for speaking ring indicator
    if (newState) {
      sfuRef.current?.startVAD(stream);
    } else {
      sfuRef.current?.stopVAD();
    }
  }, [isMicOn, isCameraOn]);

  const toggleDeafen = useCallback(() => {
    const newState = !isDeafened;
    setIsDeafened(newState);
    if (newState) {
      // Mute local mic when deafened
      const stream = localStreamRef.current;
      if (stream) {
        stream.getAudioTracks().forEach(t => t.enabled = false);
      }
      setIsMicOn(false);
      sfuRef.current?.sendMuteUpdate(false, isCameraOn);
      sfuRef.current?.stopVAD();
    }
  }, [isDeafened, isCameraOn]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) {
      const newState = !isCameraOn;
      if (newState) {
        // Camera ON: re-publish video track to SFU
        for (const track of videoTracks) {
          track.enabled = true;
        }
        sfuRef.current?.publishTracks(
          new MediaStream(videoTracks),
          "cam"
        );
      } else {
        // Camera OFF: close the video track on the SFU entirely
        const videoTrackName = `cam-video-${myIdRef.current}`;
        for (const track of videoTracks) {
          track.enabled = false;
        }
        sfuRef.current?.unpublishTrack(videoTrackName);
      }
      setIsCameraOn(newState);
      // Signal mute state to other participants
      sfuRef.current?.sendMuteUpdate(isMicOn, newState);
    } else {
      // No video track — try to add one
      navigator.mediaDevices
        .getUserMedia({ video: true })
        .then((newStream) => {
          const newVideoTrack = newStream.getVideoTracks()[0];
          if (newVideoTrack) {
            stream.addTrack(newVideoTrack);
            setIsCameraOn(true);
            rebuildStreams();
            // Publish the new track
            sfuRef.current?.publishTracks(
              new MediaStream([newVideoTrack]),
              "cam"
            );
          }
        })
        .catch(() => {
          // Camera not available
        });
    }
  }, [isMicOn, isCameraOn, rebuildStreams]);

  const toggleScreen = useCallback(async () => {
    console.log(`[Room] toggleScreen called, isScreenSharing=${isScreenSharing}`);
    const sfu = sfuRef.current;
    if (!sfu) {
      console.warn("[Room] toggleScreen: no SFU ref");
      return;
    }

    if (isScreenSharing) {
      console.log("[Room] Stopping screen share");
      // Build track names to notify server before stopping
      const trackNames = (screenStreamRef.current?.getTracks() ?? []).map(
        (t) => `screen-${t.kind}-${myIdRef.current}`
      );
      // Stop sharing
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      // Notify server so other participants remove the frozen stream
      if (trackNames.length > 0) sfu.stopTracks(trackNames);
      rebuildStreams();
    } else {
      try {
        console.log("[Room] Requesting display media...");
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        console.log(`[Room] Got display media: tracks=${stream.getTracks().length}, kinds=${stream.getTracks().map(t => t.kind).join(",")}`);
        screenStreamRef.current = stream;
        setIsScreenSharing(true);

        // Publish screen tracks
        console.log("[Room] Publishing screen tracks...");
        sfu.publishTracks(stream, "screen");

        // Handle user stopping via browser UI
        stream.getVideoTracks()[0].onended = () => {
          const trackNames = stream.getTracks().map(
            (t) => `screen-${t.kind}-${myIdRef.current}`
          );
          screenStreamRef.current = null;
          setIsScreenSharing(false);
          if (trackNames.length > 0) sfu.stopTracks(trackNames);
          rebuildStreams();
        };

        rebuildStreams();
      } catch (err) {
        console.error("[Room] Screen share error:", err);
      }
    }
  }, [isScreenSharing, rebuildStreams]);

  const handleSelectAudio = useCallback(async (deviceId: string) => {
    setSelectedAudioId(deviceId);
    const stream = localStreamRef.current;
    if (!stream) return;

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      // Replace old audio track
      const oldTrack = stream.getAudioTracks()[0];
      if (oldTrack) {
        stream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      stream.addTrack(newTrack);
      setIsMicOn(true);

      // Re-publish to SFU
      if (sfuRef.current && myIdRef.current) {
        sfuRef.current.publishTracks(stream, "cam");
      }
      rebuildStreams();
    } catch (err) {
      console.warn("[Room] Failed to switch audio device:", err);
    }
  }, [rebuildStreams]);

  const handleSelectVideo = useCallback(async (deviceId: string) => {
    setSelectedVideoId(deviceId);
    const stream = localStreamRef.current;
    if (!stream) return;

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      // Replace old video track
      const oldTrack = stream.getVideoTracks()[0];
      if (oldTrack) {
        stream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      stream.addTrack(newTrack);
      setIsCameraOn(true);

      // Re-publish to SFU
      if (sfuRef.current && myIdRef.current) {
        sfuRef.current.publishTracks(stream, "cam");
      }
      rebuildStreams();
    } catch (err) {
      console.warn("[Room] Failed to switch video device:", err);
    }
  }, [rebuildStreams]);

  const handleLeave = useCallback(() => {
    sfuRef.current?.stopVAD();
    sfuRef.current?.disconnect();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    sessionStorage.removeItem(`meet-autojoin-${slug}`);
    setJoined(false);
    setStreams([]);
    router.push("/");
  }, [slug, router]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (!joined) {
    return <JoinForm initialRoom={slug} onJoin={handleJoin} />;
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--rm-bg-primary)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[var(--rm-bg-surface)] px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Radio className="h-4 w-4 shrink-0 text-blue-400" />
          <span className="truncate text-[15px] font-semibold text-white">{slug}</span>
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] font-semibold",
              connectionState === "connected"
                ? "bg-green-500/15 text-green-400"
                : "bg-white/[0.06] text-white/40"
            )}
          >
            {connectionState}
          </Badge>
        </div>
        <span className="text-xs text-white/30">
          {participantCount} in room
        </span>
        <UserButton
          appearance={{
            elements: { avatarBox: { width: 32, height: 32 } },
          }}
        >
          <UserButton.MenuItems>
            <UserButton.Action
              label="Edit Profile"
              labelIcon={<Pencil className="h-4 w-4" />}
              onClick={() => setProfileOpen(true)}
            />
          </UserButton.MenuItems>
        </UserButton>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <VideoGrid streams={streams} />
      </div>

      <div className="flex shrink-0 items-center justify-center border-t border-white/[0.06] bg-[var(--rm-bg-surface)] py-3">
        <MediaControls
          isMicOn={isMicOn}
          isCameraOn={isCameraOn}
          isScreenSharing={isScreenSharing}
          isDeafened={isDeafened}
          onToggleMic={toggleMic}
          onToggleCamera={toggleCamera}
          onToggleScreen={toggleScreen}
          onToggleDeafen={toggleDeafen}
          onLeave={handleLeave}
          audioInputs={audioInputs}
          videoInputs={videoInputs}
          selectedAudioId={selectedAudioId}
          selectedVideoId={selectedVideoId}
          onSelectAudio={handleSelectAudio}
          onSelectVideo={handleSelectVideo}
        />
      </div>
      {profileOpen && (
        <SettingsModal onClose={() => setProfileOpen(false)} />
      )}
    </div>
  );
}
