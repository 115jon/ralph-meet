/**
 * `/ui-fixtures?surface=foundation&theme=<id>`: the Talk Tree components
 * page. Every token and primitive from the foundation on one scrollable
 * page, rendered live in the selected theme (dark, light, miku-dark,
 * miku-light, spiderman-dark, spiderman-light).
 */
import * as React from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge, CountBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Led } from "@/components/ui/led";
import { Num, NumClock } from "@/components/ui/num";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { OCCUPANT_ROW, TREE_ROW } from "@/components/ui/sidebar-row";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ThemeBanner } from "@/components/ui/theme-slots";
import { ToastCard } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DitherGlyph, type GlyphMotif } from "@/components/ui/dither-glyph";
import { TreeBranch, TreeLeaf } from "@/components/ui/tree";
import { cn } from "@/lib/utils";

const NOW = Date.UTC(2026, 9, 27, 21, 47, 12);
const CALL_START = NOW - (2 * 3600 + 14 * 60 + 9) * 1000;

function Section({
  title,
  note,
  children,
  className,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-6">
      <div className="flex items-baseline gap-3">
        <h2 className="text-ui-md font-semibold text-ink-1">{title}</h2>
        {note ? <p className="text-ui-xs text-ink-3">{note}</p> : null}
      </div>
      <div className={cn("flex flex-wrap items-start gap-4", className)}>
        {children}
      </div>
    </section>
  );
}

function Swatch({
  name,
  className,
  ink = "text-ink-1",
  ring = false,
}: {
  name: string;
  className: string;
  ink?: string;
  ring?: boolean;
}) {
  return (
    <div className="flex w-28 flex-col gap-1.5">
      <div
        className={cn(
          "h-12 rounded-md",
          ring && "border border-line",
          className,
        )}
      />
      <span
        className={cn("text-num-xs", ink === "text-ink-1" ? "text-ink-2" : ink)}
      >
        {name}
      </span>
    </div>
  );
}

const PLIES = [
  ["ply-0", "bg-ply-0", "canvas: chat, rail, stage"],
  ["ply-1", "bg-ply-1", "panel: tree, settings nav"],
  ["ply-2", "bg-ply-2", "card, input, composer"],
  ["ply-3", "bg-ply-3 shadow-float", "float: menu, dialog"],
  ["ply-4", "bg-ply-4", "hover inside a float"],
] as const;

const TYPE_RAMP = [
  ["silkscreen / text-ui-2xs", "silkscreen text-ink-3", "Voice channels"],
  ["text-ui-xs", "text-ui-xs text-ink-3", "Ada joined the call 4 minutes ago"],
  ["text-ui-sm", "text-ui-sm font-medium text-ink-1", "Noise suppression"],
  ["text-ui-row", "text-ui-row font-medium text-ink-1", "Lounge"],
  [
    "text-ui-base",
    "text-ui-base text-ink-1",
    "anyone up for another round after this one? I'll start the lobby",
  ],
  [
    "text-ui-md",
    "text-ui-md font-semibold text-ink-1",
    "Invite people to Ralph HQ",
  ],
  ["text-ui-lg", "text-ui-lg font-semibold text-ink-1", "Voice & video"],
  ["text-ui-xl", "text-ui-xl font-semibold text-ink-1", "Friends"],
  [
    "text-ui-2xl (mono)",
    "text-ui-2xl font-mono font-semibold text-ink-1",
    "QJ4K-7MPX",
  ],
  ["text-display", "text-display text-ink-1", "Your own place to hang out"],
] as const;

export function FoundationFixture() {
  const [tab, setTab] = React.useState<"online" | "all" | "pending">("online");
  const [on, setOn] = React.useState(true);

  return (
    <div
      data-testid="foundation"
      className="h-full overflow-y-auto bg-ply-0 text-ink-1"
    >
      <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-8 py-8">
        <header className="relative flex h-12 items-center gap-3 rounded-lg border border-line bg-ply-1 px-4">
          <Led state="talk" />
          <h1 className="text-ui-lg font-semibold text-balance">
            Talk Tree foundation
          </h1>
          <span className="text-ui-xs text-ink-3">
            tokens, type, motion and primitives in the active theme
          </span>
          <ThemeBanner />
        </header>

        <Section
          title="Plies"
          note="strict order; hover is an ink tint, never a hue"
        >
          {PLIES.map(([name, cls, use]) => (
            <div key={name} className="flex w-[200px] flex-col gap-2">
              <div
                className={cn(
                  "flex h-24 flex-col justify-end rounded-lg border border-line p-3",
                  cls,
                )}
              >
                <span className="text-ui-sm font-medium">{name}</span>
                <span className="text-ui-xs text-ink-3">{use}</span>
              </div>
            </div>
          ))}
          <div className="flex w-[200px] flex-col gap-1 rounded-lg border border-line bg-ply-2 p-2">
            <div className="rounded-sm bg-tint-1 px-2 py-1 text-ui-xs">
              tint-1 hover
            </div>
            <div className="rounded-sm bg-tint-2 px-2 py-1 text-ui-xs">
              tint-2 selected
            </div>
            <div className="rounded-sm bg-tint-3 px-2 py-1 text-ui-xs">
              tint-3 pressed
            </div>
          </div>
        </Section>

        <Section
          title="Ink and lines"
          note="ink-3 holds 4.5:1 on ply-3; ink-off is decoration only"
        >
          <div className="flex flex-col gap-1 rounded-lg border border-line bg-ply-3 p-4">
            <span className="text-ui-row text-ink-1">ink-1 · Ada Lovelace</span>
            <span className="text-ui-row text-ink-2">
              ink-2 · Streaming Hades II
            </span>
            <span className="text-ui-row text-ink-3">
              ink-3 · Yesterday at 21:47
            </span>
            <span className="text-ui-row text-ink-off">
              ink-off · decoration only
            </span>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-ply-2 p-4">
            <div className="h-px w-48 bg-line" />
            <span className="text-num-xs text-ink-3">line 8%</span>
            <div className="h-px w-48 bg-line-strong" />
            <span className="text-num-xs text-ink-3">line-strong 14%</span>
            <div className="h-px w-48 bg-line-field" />
            <span className="text-num-xs text-ink-3">line-field 3:1</span>
            <div className="h-px w-48 bg-guide" />
            <span className="text-num-xs text-ink-3">guide 12%</span>
            <div className="h-px w-48 bg-path" />
            <span className="text-num-xs text-ink-3">path = accent ink</span>
          </div>
        </Section>

        <Section
          title="Primary, accent, brand and LEDs"
          note="LED hues are fixed across themes"
        >
          <Swatch name="primary-fill" className="bg-primary-fill" ring />
          <Swatch name="accent-ink" className="bg-accent-ink" />
          <Swatch name="accent-tint" className="bg-accent-tint" ring />
          <Swatch name="brand" className="bg-brand" ring />
          <Swatch name="brand-2" className="bg-brand-2" />
          <Swatch name="talk" className="bg-talk" />
          <Swatch name="live" className="bg-live" />
          <Swatch name="danger-fill" className="bg-danger-fill" />
          <Swatch name="danger-ink" className="bg-danger-ink" />
          <Swatch name="muted-state" className="bg-muted-state" />
          <Swatch name="idle" className="bg-idle" />
          <Swatch name="badge" className="bg-badge" />
          <div className="flex flex-col gap-1.5">
            <span className="rounded-sm bg-accent-tint px-2 py-1 text-ui-sm text-accent-ink">
              @you mention
            </span>
            <span className="rounded-sm bg-live-tint px-2 py-1 text-ui-sm text-live-ink">
              Live · sharing screen
            </span>
            <span className="rounded-sm bg-danger-tint px-2 py-1 text-ui-sm text-danger-ink">
              Couldn't send. Retry
            </span>
            <span className="rounded-sm bg-warning-tint px-2 py-1 text-ui-sm text-warning-ink">
              Reconnecting…
            </span>
          </div>
        </Section>

        <Section
          title="Type"
          note="Geist for UI, Geist Mono for every number"
          className="flex-col gap-2"
        >
          {TYPE_RAMP.map(([name, cls, sample]) => (
            <div
              key={name}
              className="grid grid-cols-[180px_1fr] items-baseline gap-4"
            >
              <span className="text-num-xs text-ink-3">{name}</span>
              <span className={cn("text-balance", cls)}>{sample}</span>
            </div>
          ))}
        </Section>

        <Section
          title="Numbers"
          note="Num: mono, tabular; clocks tick in their own leaf"
        >
          <div className="flex items-center gap-6 rounded-lg border border-line bg-ply-1 px-4 py-3">
            <span className="flex items-center gap-2 text-ui-sm text-ink-2">
              <Led state="talk" /> Lounge · Ralph HQ
            </span>
            <Num size="sm" className="text-ink-3">
              28 ms
            </Num>
            <NumClock since={CALL_START} now={NOW} className="text-ink-2" />
          </div>
          <div className="flex items-center gap-6 rounded-lg border border-line bg-ply-2 px-4 py-3">
            <Num className="text-ink-3">21:47</Num>
            <Num className="text-ink-3">3</Num>
            <Num size="sm" className="text-ink-2">
              96 kbps
            </Num>
            <Num size="sm" className="text-ink-2">
              4.2 MB
            </Num>
            <NumClock
              since={NOW - 247_000}
              now={NOW}
              size="xs"
              className="text-ink-3"
            />
          </div>
        </Section>

        <Section title="Buttons" note="one primary per view; press scale .97">
          <div className="flex flex-col gap-3">
            {(["sm", "md", "lg"] as const).map((size) => (
              <div key={size} className="flex flex-wrap items-center gap-2">
                <span className="w-8 text-num-xs text-ink-3">{size}</span>
                <Button size={size} variant="primary">
                  Join voice
                </Button>
                <Button size={size} variant="secondary">
                  Invite
                </Button>
                <Button size={size} variant="outline">
                  Edit profile
                </Button>
                <Button size={size} variant="ghost">
                  Cancel
                </Button>
                <Button size={size} variant="destructive">
                  Remove
                </Button>
                <Button size={size} variant="danger">
                  <Icon name="disconnect" size="sm" /> Leave
                </Button>
                <Button size={size} variant="link">
                  Open settings
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-8 text-num-xs text-ink-3">state</span>
              <Button disabled>Save changes</Button>
              <Button variant="danger" disabled>
                Leave
              </Button>
              <Button variant="secondary" disabled>
                Invite
              </Button>
              <Button variant="outline" disabled>
                Edit
              </Button>
              <Button loading>Saving</Button>
              <Button variant="secondary" loading>
                Uploading
              </Button>
            </div>
          </div>
        </Section>

        <Section
          title="Icon buttons"
          note="24 / 28 / 32 / 40; toggled, off, live"
        >
          <div className="flex items-center gap-2 rounded-lg border border-line bg-ply-1 p-2">
            <IconButton size={24} icon="settings" aria-label="Settings" />
            <IconButton size={28} icon="mic" aria-label="Mute" />
            <IconButton size={32} icon="deafen" aria-label="Deafen" />
            <IconButton
              size={40}
              icon="screenShare"
              aria-label="Share screen"
            />
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-ply-1 p-2">
            <div className="flex flex-col items-center gap-1">
              <IconButton size={32} icon="members" aria-label="Members" />
              <span className="text-num-xs text-ink-3">idle</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <IconButton
                size={32}
                tone="toggled"
                aria-pressed
                icon="members"
                aria-label="Members"
              />
              <span className="text-num-xs text-ink-3">toggled</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <IconButton
                size={32}
                tone="off"
                aria-pressed
                icon="mic"
                aria-label="Unmute"
              />
              <span className="text-num-xs text-ink-3">muted</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <IconButton
                size={32}
                tone="live"
                aria-pressed
                icon="camera"
                aria-label="Turn off camera"
              />
              <span className="text-num-xs text-ink-3">live</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <IconButton
                size={32}
                icon="settings"
                aria-label="Settings"
                disabled
              />
              <span className="text-num-xs text-ink-3">disabled</span>
            </div>
          </div>
        </Section>

        <Section title="Fields and controls">
          <div className="flex w-72 flex-col gap-2">
            <Input placeholder="Search Ralph HQ" />
            <Input defaultValue="ada@ralph.gg" inputSize="lg" />
            <Input defaultValue="not a code" aria-invalid />
            <Input placeholder="Disabled" disabled />
          </div>
          <div className="flex w-72 flex-col gap-2">
            <Textarea placeholder="Message #general" />
          </div>
          <div className="flex w-64 flex-col gap-4 rounded-lg border border-line bg-ply-2 p-4">
            <label className="flex items-center justify-between gap-3 text-ui-row">
              Noise suppression
              <Switch
                checked={on}
                onCheckedChange={setOn}
                aria-label="Noise suppression"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-ui-row">
              Echo cancellation
              <Switch checked={false} aria-label="Echo cancellation" />
            </label>
            <label className="flex items-center justify-between gap-3 text-ui-row text-ink-3">
              Game capture
              <Switch disabled aria-label="Game capture" />
            </label>
            <div className="flex flex-col gap-2 pt-4">
              <span className="text-ui-sm text-ink-2">Input volume</span>
              <Slider
                defaultValue={[72]}
                max={100}
                showValue="always"
                formatValue={(v) => `${v}%`}
                aria-label="Input volume"
              />
            </div>
          </div>
          <div className="flex w-80 flex-col gap-4">
            <Tabs
              label="Friends"
              items={[
                {
                  value: "online",
                  label: "Online",
                  adornment: <Num className="text-ink-3">4</Num>,
                },
                { value: "all", label: "All" },
                {
                  value: "pending",
                  label: "Pending",
                  adornment: <CountBadge count={2} />,
                },
              ]}
              value={tab}
              onValueChange={setTab}
              className="h-9 border-b border-line"
            />
            <div className="flex items-center gap-2 text-ui-sm text-ink-2">
              Quick switcher
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
              </KbdGroup>
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Separator />
          </div>
        </Section>

        <Section
          title="Overlays"
          note="radius 10 floats on ply-3 + shadow-2; dialogs radius 12 + shadow-3"
        >
          <div className="relative h-[230px] w-[260px]">
            <Tooltip open>
              <TooltipTrigger asChild>
                <IconButton
                  size={32}
                  icon="mic"
                  aria-label="Mute"
                  className="mt-10"
                />
              </TooltipTrigger>
              <TooltipContent side="top">Mute</TooltipContent>
            </Tooltip>
          </div>
          {/* Open on load, so neither panel may take focus: it would scroll
              the page to the portalled popup, far below this inner scroller. */}
          <div className="relative h-[230px] w-[280px]">
            <DropdownMenu open modal={false}>
              <DropdownMenuTrigger
                render={
                  <Button variant="secondary" size="sm">
                    Channel menu
                  </Button>
                }
              />
              <DropdownMenuContent align="start" initialFocus={false}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Lounge</DropdownMenuLabel>
                  <DropdownMenuItem icon={<Icon name="markRead" size="sm" />}>
                    Mark as read
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<Icon name="link" size="sm" />}
                    hint="Ctrl L"
                  >
                    Copy link
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<Icon name="bellOff" size="sm" />}
                    disabled
                  >
                    Mute channel
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="danger"
                  icon={<Icon name="trash" size="sm" />}
                >
                  Delete channel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="relative h-[230px] w-[360px]">
            <Popover open>
              <PopoverTrigger
                render={
                  <Button variant="outline" size="sm">
                    Audio device
                  </Button>
                }
              />
              <PopoverContent
                variant="panel"
                align="start"
                aria-label="Audio device"
                initialFocus={false}
              >
                <div className="flex flex-col gap-3">
                  <p className="text-ui-row font-semibold">Input device</p>
                  <p className="text-ui-sm text-ink-2">Shure MV7 (USB Audio)</p>
                  <Slider defaultValue={[60]} aria-label="Input sensitivity" />
                  <div className="flex justify-end gap-2">
                    <Button size="md" variant="ghost">
                      Cancel
                    </Button>
                    <Button size="md">Apply</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div
            role="dialog"
            aria-label="Leave voice? (frame)"
            className="relative grid w-[400px] gap-4 rounded-xl border border-line bg-ply-3 p-5 shadow-modal"
          >
            <div className="flex flex-col gap-1 pr-8">
              <p className="text-ui-md font-semibold text-balance">
                Leave Lounge?
              </p>
              <p className="text-ui-sm text-pretty text-ink-2">
                You're sharing your screen. Leaving stops the stream for 3
                people.
              </p>
            </div>
            <span className="absolute top-4 right-4 inline-flex size-7 items-center justify-center rounded-sm text-ink-3">
              <Icon name="close" size="sm" />
            </span>
            <div className="flex justify-end gap-2">
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Leave</Button>
            </div>
          </div>
          <div className="w-[360px]">
            <ToastCard
              id="fx"
              kind="success"
              message="Invite link copied"
              description="Anyone with the link can join Ralph HQ for 7 days."
            />
            <div className="mt-2">
              <ToastCard
                id="fx2"
                kind="error"
                message="Couldn't upload clip.mp4"
              />
            </div>
          </div>
        </Section>

        <Section title="Badges, avatars and the speaking ring">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>New</Badge>
            <Badge variant="secondary">Bot</Badge>
            <Badge variant="live">Live</Badge>
            <Badge variant="talk">Connected</Badge>
            <Badge variant="warning">Reconnecting</Badge>
            <Badge variant="destructive">Banned</Badge>
            <Badge variant="outline">Admin</Badge>
            <CountBadge count={3} />
            <CountBadge count={12} />
            <CountBadge count={120} />
          </div>
          <div className="flex items-end gap-4 rounded-lg border border-line bg-ply-1 p-4">
            {([18, 20, 24, 32, 40, 80] as const).map((size, i) => (
              <div key={size} className="flex flex-col items-center gap-2">
                <Avatar
                  name={
                    ["Ada", "Grace", "Linus", "Margaret", "Alan", "Ralph"][i]!
                  }
                  size={size}
                  presence={
                    (
                      [
                        "online",
                        "idle",
                        "dnd",
                        "offline",
                        "online",
                        "online",
                      ] as const
                    )[i]
                  }
                  ring="ply-1"
                />
                <Num className="text-ink-3">{size}</Num>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-6 rounded-lg border border-line bg-ply-2 p-4">
            <div className="flex flex-col items-center gap-2">
              <Avatar
                name="Ada Lovelace"
                size={40}
                speaking
                presence="online"
                ring="ply-2"
              />
              <span className="text-ui-xs text-ink-2">speaking</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Avatar
                name="Grace Hopper"
                size={40}
                speaking={false}
                presence="online"
                ring="ply-2"
              />
              <span className="text-ui-xs text-ink-2">silent</span>
            </div>
          </div>
        </Section>

        <Section title="LED" note="on 60ms, off 220ms; no pulse">
          <div className="flex items-center gap-6 rounded-lg border border-line bg-ply-1 px-4 py-3">
            {(["talk", "live", "muted", "idle", "off"] as const).map(
              (state) => (
                <span
                  key={state}
                  className="flex items-center gap-2 text-ui-sm text-ink-2"
                >
                  <Led state={state} /> <Led state={state} size={8} /> {state}
                </span>
              ),
            )}
            <span
              data-speaking=""
              className="flex items-center gap-2 text-ui-sm text-ink-2"
            >
              <Led state="talk" follow="speaking" /> follows: speaking
            </span>
            <span className="flex items-center gap-2 text-ui-sm text-ink-2">
              <Led state="talk" follow="speaking" /> follows: silent
            </span>
          </div>
        </Section>

        <Section
          title="Talk Tree"
          note="each row draws its own guide; your path is lit"
        >
          <div className="w-[264px] rounded-lg border border-line bg-ply-1 py-2">
            <p className="silkscreen px-4 pt-2 pb-1 text-ink-3">
              Voice channels
            </p>
            <div className="px-2">
              <TreeBranch
                header={
                  <div className={cn(TREE_ROW, "bg-tint-2 text-ink-1")}>
                    <Icon
                      name="voiceChannel"
                      size="sm"
                      className="text-ink-3"
                    />
                    <span className="min-w-0 flex-1 truncate">Lounge</span>
                    <Num className="text-ink-3">3</Num>
                    <NumClock
                      since={CALL_START}
                      now={NOW}
                      size="xs"
                      className="text-ink-3"
                    />
                  </div>
                }
              >
                <TreeLeaf
                  data-speaking=""
                  node={<Led state="talk" follow="speaking" />}
                  rowClassName={OCCUPANT_ROW}
                >
                  <Avatar name="Ada Lovelace" size={18} speaking />
                  <span className="min-w-0 flex-1 truncate text-ink-1">
                    Ada Lovelace
                  </span>
                </TreeLeaf>
                <TreeLeaf
                  self
                  node={<Led state="talk" follow="speaking" />}
                  rowClassName={OCCUPANT_ROW}
                >
                  <Avatar name="You" size={18} speaking={false} />
                  <span className="min-w-0 flex-1 truncate">You</span>
                  <Icon
                    name="screenShare"
                    size="xs"
                    className="text-live-ink"
                  />
                </TreeLeaf>
                <TreeLeaf
                  node={<Led state="muted" />}
                  rowClassName={OCCUPANT_ROW}
                >
                  <Avatar name="Grace Hopper" size={18} speaking={false} />
                  <span className="min-w-0 flex-1 truncate">Grace Hopper</span>
                  <Icon
                    name="mic"
                    state="off"
                    size="xs"
                    className="text-muted-state"
                  />
                </TreeLeaf>
              </TreeBranch>
              <div className={cn(TREE_ROW, "text-ink-2")}>
                <Icon name="voiceChannel" size="sm" className="text-ink-3" />
                <span className="min-w-0 flex-1 truncate">Ranked queue</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-8 rounded-lg border border-line bg-ply-0 p-6">
            {(["mark", "empty", "screen", "voice"] as GlyphMotif[]).map(
              (motif) => (
                <div key={motif} className="flex flex-col items-center gap-2">
                  <DitherGlyph motif={motif} size="md" />
                  <span className="text-num-xs text-ink-3">{motif}</span>
                </div>
              ),
            )}
            <div className="flex flex-col items-center gap-2">
              <DitherGlyph motif="empty" size="md" pending />
              <span className="text-num-xs text-ink-3">pending</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <DitherGlyph motif="empty" size="sm" />
              <span className="text-num-xs text-ink-3">sm</span>
            </div>
          </div>
          <div className="w-[360px] rounded-lg border border-line bg-ply-0">
            <EmptyState
              title="No one's here yet"
              description="Voice channels light up when someone joins. Start one and your friends will see you in the tree."
              action={<Button variant="secondary">Join Lounge</Button>}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}
