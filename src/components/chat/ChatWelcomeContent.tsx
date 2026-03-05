import { Hash } from "./Icons";

export function ChatWelcomeContent({ isDM, channelName, channelId, state }: { isDM: boolean; channelName: string; channelId: string | null; state: any }) {
  if (!channelId) return null;

  return (
    <div className="flex flex-col items-start px-4 text-left">
      {isDM ? (
        <>
          <div className="mb-6 flex overflow-hidden rounded-full ring-2 ring-rm-border shadow-2xl transition-transform duration-500 hover:scale-105">
            {state.dmChannels.find((c: any) => c.id === channelId)?.recipient?.avatar_url ? (
              <img
                src={state.dmChannels.find((c: any) => c.id === channelId)!.recipient.avatar_url!}
                alt=""
                className="h-24 w-24 object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-3xl font-bold text-primary-foreground">
                {channelName?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>
          <h1 className="mb-0 text-3xl font-black tracking-tight text-rm-text-primary">
            {state.dmChannels.find((c: any) => c.id === channelId)?.recipient?.username ?? channelName}
          </h1>
          <h2 className="mb-4 text-xl font-bold text-rm-text-muted tracking-tight">
            @{state.dmChannels.find((c: any) => c.id === channelId)?.recipient?.username ?? channelName.toLowerCase()}
          </h2>
          <p className="max-w-md text-[14px] font-medium leading-relaxed text-rm-text-muted">
            This is the absolute beginning of your direct message history with{" "}
            <span className="text-rm-text-secondary font-semibold">{channelName}</span>. Be kind, be bold, and let the conversation flow.
          </p>
          <div className="flex gap-3 mt-6">
            <button className="rounded-lg bg-rm-bg-hover border border-rm-border px-4 py-2 text-[12px] font-bold text-rm-text transition-all hover:bg-rm-bg-active active:scale-95">
              View Profile
            </button>
            <button className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-2 text-[12px] font-bold text-rose-400 transition-all hover:bg-rose-500/20 active:scale-95">
              Block User
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-6 flex h-20 w-20 rotate-6 items-center justify-center rounded-3xl border border-indigo-500/20 bg-indigo-500/10 shadow-2xl transition-transform duration-500 hover:rotate-0">
            <Hash className="h-10 w-10 text-indigo-400 opacity-80" />
          </div>
          <h3 className="mb-2 text-3xl font-semibold tracking-tight text-rm-text-primary">
            Welcome to #{channelName}
          </h3>
          <p className="max-w-lg text-sm font-medium leading-relaxed text-rm-text-muted">
            This is the absolute beginning of the #{channelName} channel. Start a conversation, forge new paths, and let your frequencies align.
          </p>
        </>
      )}
      <div className="mt-8 h-px w-full bg-gradient-to-r from-rm-border to-transparent" />
    </div>
  );
}
