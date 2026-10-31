import { EmptyState, Header, Screen } from "@/ui";

export default function ActivityScreen() {
  return (
    <Screen>
      <Header title="Activity" />
      <EmptyState
        title="Nothing new"
        description="Mentions and replies show up here."
      />
    </Screen>
  );
}
