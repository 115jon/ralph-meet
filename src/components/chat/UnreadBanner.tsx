/**
 * UnreadBanner
 *
 * Top banner showing unread message count and time.
 * Uses the app's primary color. Includes a "Mark As Read" button.
 */

interface UnreadBannerProps {
  count: number;
  since: string; // ISO timestamp of the first unread message
  onMarkAsRead: () => void;
}

export function UnreadBanner({ count, since, onMarkAsRead }: UnreadBannerProps) {
  const timeStr = new Date(since).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex items-center justify-between mx-2 mt-1 px-4 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg shrink-0 z-10">
      <span>
        {count} new message{count !== 1 ? "s" : ""} since {timeStr}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onMarkAsRead();
        }}
        className="flex items-center gap-1.5 text-sm font-semibold px-2 py-0.5 rounded hover:bg-white/15 transition-colors"
      >
        Mark As Read
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-4 h-4"
        >
          <path
            fillRule="evenodd"
            d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}
