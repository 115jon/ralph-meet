import splashLogo from "@/assets/splash-logo.svg";
import { useEffect, useState } from "react";

export function StandaloneUpdater() {
  const [status, setStatus] = useState<"checking" | "downloading" | "installing" | "error">("checking");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    console.info("[StandaloneUpdater] useEffect mounted");
    let mounted = true;

    async function runUpdateCheck() {
      console.info("[StandaloneUpdater] runUpdateCheck called");
      try {
        const { check } = await import("@tauri-apps/plugin-updater");

        const update = await check();
        if (update && mounted) {
          setStatus("downloading");
          let downloaded = 0;
          let contentLength = 0;

          await update.downloadAndInstall((event: any) => {
            switch (event.event) {
              case "Started":
                contentLength = event.data.contentLength ?? 0;
                break;
              case "Progress":
                downloaded += event.data.chunkLength;
                if (contentLength > 0 && mounted) {
                  setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
                }
                break;
              case "Finished":
                if (mounted) setStatus("installing");
                break;
            }
          });

          // Fallback auto-relaunch if the installer doesn't do it
          setTimeout(async () => {
            try {
              const { relaunch } = await import("@tauri-apps/plugin-process");
              await relaunch();
            } catch (e) {
              console.error("Relaunch failed", e);
            }
          }, 3000);

        } else {
          // No update, switch to main window
          if (mounted) switchToMain();
        }

      } catch (e: any) {
        console.error("Update check failed:", e);
        // On error, fallback to main window
        if (mounted) switchToMain();
      }
    }

    async function switchToMain() {
      const { Window, getCurrentWindow } = await import("@tauri-apps/api/window");
      
      try {
        const mainWindow = await Window.getByLabel("main");
        if (mainWindow) {
          await mainWindow.show();
          await mainWindow.setFocus();
        }
      } catch (e) {
        console.error("Failed to show main window:", e);
      } finally {
        try {
          await getCurrentWindow().close();
        } catch (closeErr) {
          console.error("Failed to close updater window:", closeErr);
        }
      }
    }

    // Delay so the window has time to paint and acts as a nice splash screen
    const timer = setTimeout(runUpdateCheck, 2500);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  const getStatusText = () => {
    switch (status) {
      case "checking": return "Checking for updates...";
      case "downloading": return `Downloading update... ${progress}%`;
      case "installing": return "Installing update...";
      case "error": return "Update check failed (Debug mode active)";
    }
  };

  return (
    <div 
      className="w-screen h-screen flex flex-col justify-center items-center bg-rm-bg-primary relative overflow-hidden"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* Radial glow */}
      <div
        className="absolute top-[45%] left-1/2 w-[320px] h-[320px] rounded-full pointer-events-none animate-[conn-glow_3s_ease-in-out_infinite]"
        style={{
          background: "radial-gradient(circle, var(--rm-glow, rgba(88, 101, 242, 0.4)) 0%, transparent 70%)",
          transform: "translate(-50%, -50%)",
        }}
      />

      {/* Logo with breathing animation */}
      <div className="w-24 h-24 z-10 flex items-center justify-center animate-[conn-breathe_2.8s_ease-in-out_infinite]">
        <div
          className="w-full h-full bg-rm-text"
          style={{
            WebkitMaskImage: `url(${splashLogo})`,
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskImage: `url(${splashLogo})`,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
          }}
        />
      </div>

      {/* Loading bar */}
      <div className="mt-9 w-[200px] h-1.5 rounded-full bg-rm-bg-active overflow-hidden relative z-10">
        {status === "checking" || status === "installing" ? (
          <div className="absolute top-0 h-full rounded-full bg-rm-accent animate-[conn-bar_1.8s_cubic-bezier(0.4,0,0.2,1)_infinite]" />
        ) : (
          <div 
            className="h-full rounded-full bg-rm-accent transition-all duration-200 ease-out" 
            style={{ width: `${progress}%` }} 
          />
        )}
      </div>

      {/* Status text */}
      <p className="mt-5 text-[13px] font-semibold tracking-[0.01em] z-10 text-rm-text-secondary">
        {getStatusText()}
      </p>

      {/* Keyframe definitions */}
      <style>{`
        @keyframes conn-breathe {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes conn-bar {
          0% { left: -40%; width: 40%; }
          50% { left: 30%; width: 50%; }
          100% { left: 110%; width: 30%; }
        }
        @keyframes conn-glow {
          0%, 100% { opacity: 0.25; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.45; transform: translate(-50%, -50%) scale(1.1); }
        }
      `}</style>
    </div>
  );
}
