import { AvatarImage } from "@/components/chat/AvatarImage";
import { Button } from "@/components/ui/button";
import { getDisplayName, getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { useChatStore } from "@/stores/chat-store";
import { useUser } from "@kova/react";
import { CheckCircle2, Shield, Sparkles } from "lucide-react";

function OverviewRow({
  label,
  value,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-rm-border/70 py-5 last:border-b-0 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="text-sm font-semibold text-rm-text">{label}</div>
        <div className="mt-1 text-sm text-rm-text-secondary">{value}</div>
      </div>
      {actionLabel && onAction && (
        <Button
          type="button"
          variant="outline"
          onClick={onAction}
          className="h-10 shrink-0 border-rm-border bg-rm-bg-elevated text-rm-text hover:bg-rm-bg-hover"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export default function SettingsAccountOverviewTab({
  onOpenProfileEditor,
}: {
  onOpenProfileEditor: () => void;
}) {
  const { user } = useUser();
  const chatUser = useChatStore((s) => s.user);

  if (!user) {
    return (
      <div className="animate-in fade-in slide-in-from-right-4 duration-300">
        <h1 className="mb-2 hidden text-2xl font-bold text-rm-text md:block">Account</h1>
        <p className="mb-8 text-sm text-rm-text-muted">We are still loading your account details.</p>
      </div>
    );
  }

  const displayName = getDisplayName({
    display_name: chatUser?.display_name ?? null,
    username: chatUser?.username ?? user.username ?? "",
  });
  const username = chatUser?.username || user.username || "Unknown";
  const email = user.primaryEmailAddress?.emailAddress || "No email on file";
  const avatarUrl = chatUser?.avatar_url ? getAuthAssetUrl(chatUser.avatar_url) : user.imageUrl;
  const avatarDisplay = chatUser?.avatar_display ?? null;

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <h1 className="mb-2 hidden text-2xl font-bold text-rm-text md:block">Account</h1>
      <p className="mb-8 max-w-2xl text-sm text-rm-text-muted">
        Manage your identity, security, and profile appearance from one place.
      </p>

      <section className="overflow-hidden rounded-[26px] border border-rm-border bg-rm-bg-surface shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
        <div className="flex flex-col gap-4 border-b border-rm-border/70 bg-[radial-gradient(circle_at_top,_rgba(92,112,255,0.16),_transparent_48%),linear-gradient(180deg,_rgba(255,255,255,0.02),_rgba(255,255,255,0))] px-5 py-5 md:flex-row md:items-center md:justify-between md:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-rm-bg-elevated">
              {avatarUrl ? (
                <AvatarImage src={avatarUrl} alt={displayName} display={avatarDisplay} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-bold text-rm-text">
                  {getDisplayInitial({ name: displayName })}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-bold text-rm-text">{displayName}</div>
              <div className="truncate text-sm text-rm-text-muted">@{username}</div>
            </div>
          </div>
          <Button
            type="button"
            onClick={onOpenProfileEditor}
            className="h-10 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Sparkles size={16} />
            Edit profile
          </Button>
        </div>

        <div className="px-5 py-5 md:px-8">
          <div className="border-b border-rm-border/70 pb-4">
            <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-rm-text">Account info</h2>
          </div>
          <OverviewRow label="Display name" value={displayName} actionLabel="Edit profile" onAction={onOpenProfileEditor} />
          <OverviewRow label="Username" value={`@${username}`} actionLabel="Edit profile" onAction={onOpenProfileEditor} />
          <OverviewRow label="Email" value={email} />
          <OverviewRow
            label="Profile appearance"
            value="Avatar, decoration, banner, nameplate, and profile effect"
            actionLabel="Customize"
            onAction={onOpenProfileEditor}
          />
        </div>

        <div className="grid gap-6 px-5 py-6 md:grid-cols-2 md:px-8">
          <section className="rounded-2xl border border-rm-border bg-rm-bg-primary/40 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-300">
                <CheckCircle2 size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-rm-text">Account standing</h3>
                <p className="text-sm text-rm-text-secondary">Your account is in good shape.</p>
              </div>
            </div>
            <p className="text-sm leading-6 text-rm-text-muted">
              We do not see any current restrictions on this account.
            </p>
          </section>

          <section className="rounded-2xl border border-rm-border bg-rm-bg-primary/40 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-300">
                <Shield size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-rm-text">Security</h3>
                <p className="text-sm text-rm-text-secondary">Signed in with Ralph Auth.</p>
              </div>
            </div>
            <p className="text-sm leading-6 text-rm-text-muted">
              Password, sessions, and additional security controls will appear here as we expand account management.
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
