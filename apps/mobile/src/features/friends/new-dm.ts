import { personName } from "./filters";
import { RELATIONSHIP, type Relationship } from "./schema";

// The new-DM picker's lists (mockup 04): friends first, then people from
// your servers' member lists, then the people you already message. Each
// person shows once: a friend under Friends, someone you already message
// under Recent, anyone else under From your servers. A search on name or
// username filters all three. There is no user search endpoint, so nobody
// outside these lists can be found here (Add friend takes an exact
// username instead).

export interface PickPerson {
  readonly id: string;
  readonly username: string;
  readonly display_name?: string | null;
  readonly avatar_url?: string | null;
  readonly status?: string | null;
}

export interface PickSection {
  readonly key: "friends" | "servers" | "recent";
  readonly label: string;
  readonly people: readonly PickPerson[];
}

function matches(person: PickPerson, query: string): boolean {
  return (
    !query ||
    person.username.toLowerCase().includes(query) ||
    personName(person).toLowerCase().includes(query)
  );
}

const byName = (a: PickPerson, b: PickPerson) =>
  personName(a).localeCompare(personName(b));

export function newDmSections({
  relationships,
  serverPeople,
  recent,
  myId,
  query: rawQuery,
}: {
  relationships: readonly Relationship[];
  serverPeople: readonly PickPerson[];
  /** DM partners, most recent first. */
  recent: readonly PickPerson[];
  myId: string | undefined;
  query: string;
}): PickSection[] {
  const query = rawQuery.trim().toLowerCase();
  const seen = new Set<string>(myId ? [myId] : []);
  // Blocked people never appear, whichever list carries them.
  for (const r of relationships) {
    if (r.type === RELATIONSHIP.blocked) seen.add(r.user.id);
  }
  const take = (people: readonly PickPerson[]) => {
    const out: PickPerson[] = [];
    for (const person of people) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      if (matches(person, query)) out.push(person);
    }
    return out;
  };
  const friends = take(
    relationships
      .filter((r) => r.type === RELATIONSHIP.friend)
      .map((r) => r.user)
      .sort(byName),
  );
  // Recent claims its people before the server lists do.
  const recents = take(recent);
  const servers = take([...serverPeople].sort(byName));
  return [
    { key: "friends" as const, label: "Friends", people: friends },
    { key: "servers" as const, label: "From your servers", people: servers },
    { key: "recent" as const, label: "Recent", people: recents },
  ].filter((section) => section.people.length > 0);
}
