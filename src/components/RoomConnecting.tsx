import { EmptyState } from "@/components/ui/empty-state";

/** The wait between submitting a name and joining (exported for fixtures). */
export function RoomConnecting({ slug }: { slug: string }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-ply-0">
      <EmptyState loading title={`Connecting to ${slug}…`} />
    </div>
  );
}
