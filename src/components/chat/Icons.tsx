import {
  AlertTriangle as AlertTriangleIcon,
  AtSign as AtSignIcon,
  Ban as BanIcon,
  Bell as BellIcon,
  Camera as CameraIcon,
  Camera as CameraOffIcon,
  Check as CheckIcon,
  ChevronDown as ChevronDownIcon,
  ChevronUp as ChevronUpIcon,
  Copy as CopyIcon,
  Crown as CrownIcon,
  Download as DownloadIcon,
  Pencil as Edit2Icon,
  FileIcon as FileIconIcon,
  Gamepad2 as Gamepad2Icon,
  Gift as GiftIcon,
  Hash as HashIcon,
  Headphones as HeadphonesIcon,
  Home as HomeIcon,
  Info as InfoIcon,
  Link as LinkIcon,
  Loader2 as Loader2Icon,
  Maximize2 as Maximize2Icon,
  Menu as MenuIcon,
  MessageSquare as MessageSquareIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  Minimize as MinimizeIcon,
  Monitor as MonitorIcon,
  MonitorX as MonitorXIcon,
  MoreHorizontal as MoreHorizontalIcon,
  MoreVertical as MoreVerticalIcon,
  Music as MusicIcon,
  Phone as PhoneIcon,
  Pin as PinIcon,
  Plus as PlusIcon,
  Radio as RadioIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Share2 as Share2Icon,
  ShieldCheck as ShieldCheckIcon,
  Shield as ShieldIcon,
  SignalHigh as SignalHighIcon,
  Smile as SmileIcon,
  Sparkles as SparklesIcon,
  Speaker as SpeakerIcon,
  Sticker as StickerIcon,
  Tag as TagIcon,
  Trash2 as Trash2Icon,
  User as UserIcon,
  UserMinus as UserMinusIcon,
  UserPlus as UserPlusIcon,
  Users as UsersIcon,
  Video as VideoIcon,
  VideoOff as VideoOffIcon,
  Volume2 as Volume2Icon,
  XCircle as XCircleIcon,
  X as XIcon,
  Zap as ZapIcon,
  type LucideProps
} from "lucide-react";
import { memo } from "react";

/**
 * Performance-optimized (memoized) Lucide icons.
 * Re-rendering raw Lucide icons in large lists (history, sidebars)
 * can be surprisingly expensive. These memoized versions avoid
 * re-execution unless props change.
 */

export const AlertTriangle = memo((props: LucideProps) => <AlertTriangleIcon {...props} />);
export const AtSign = memo((props: LucideProps) => <AtSignIcon {...props} />);
export const Ban = memo((props: LucideProps) => <BanIcon {...props} />);
export const Bell = memo((props: LucideProps) => <BellIcon {...props} />);
export const CameraOff = memo((props: LucideProps) => <CameraOffIcon {...props} />);
export const Camera = memo((props: LucideProps) => <CameraIcon {...props} />);
export const Check = memo((props: LucideProps) => <CheckIcon {...props} />);
export const ChevronDown = memo((props: LucideProps) => <ChevronDownIcon {...props} />);
export const ChevronUp = memo((props: LucideProps) => <ChevronUpIcon {...props} />);
export const Copy = memo((props: LucideProps) => <CopyIcon {...props} />);
export const Download = memo((props: LucideProps) => <DownloadIcon {...props} />);
export const FileIcon = memo((props: LucideProps) => <FileIconIcon {...props} />);
export const Gamepad2 = memo((props: LucideProps) => <Gamepad2Icon {...props} />);
export const Gift = memo((props: LucideProps) => <GiftIcon {...props} />);
export const Hash = memo((props: LucideProps) => <HashIcon {...props} />);
export const Headphones = memo((props: LucideProps) => <HeadphonesIcon {...props} />);
export const Home = memo((props: LucideProps) => <HomeIcon {...props} />);
export const Info = memo((props: LucideProps) => <InfoIcon {...props} />);
export const Link = memo((props: LucideProps) => <LinkIcon {...props} />);
export const Loader2 = memo((props: LucideProps) => <Loader2Icon {...props} />);
export const Maximize2 = memo((props: LucideProps) => <Maximize2Icon {...props} />);
export const Menu = memo((props: LucideProps) => <MenuIcon {...props} />);
export const MessageSquare = memo((props: LucideProps) => <MessageSquareIcon {...props} />);
export const Mic = memo((props: LucideProps) => <MicIcon {...props} />);
export const MicOff = memo((props: LucideProps) => <MicOffIcon {...props} />);
export const Minimize = memo((props: LucideProps) => <MinimizeIcon {...props} />);
export const Monitor = memo((props: LucideProps) => <MonitorIcon {...props} />);
export const MonitorX = memo((props: LucideProps) => <MonitorXIcon {...props} />);
export const MoreHorizontal = memo((props: LucideProps) => <MoreHorizontalIcon {...props} />);
export const Music = memo((props: LucideProps) => <MusicIcon {...props} />);
export const Phone = memo((props: LucideProps) => <PhoneIcon {...props} />);
export const Pin = memo((props: LucideProps) => <PinIcon {...props} />);
export const Plus = memo((props: LucideProps) => <PlusIcon {...props} />);
export const Radio = memo((props: LucideProps) => <RadioIcon {...props} />);
export const Search = memo((props: LucideProps) => <SearchIcon {...props} />);
export const Settings = memo((props: LucideProps) => <SettingsIcon {...props} />);
export const Share2 = memo((props: LucideProps) => <Share2Icon {...props} />);
export const Shield = memo((props: LucideProps) => <ShieldIcon {...props} />);
export const ShieldCheck = memo((props: LucideProps) => <ShieldCheckIcon {...props} />);
export const Smile = memo((props: LucideProps) => <SmileIcon {...props} />);
export const SignalHigh = memo((props: LucideProps) => <SignalHighIcon {...props} />);
export const Sparkles = memo((props: LucideProps) => <SparklesIcon {...props} />);
export const Speaker = memo((props: LucideProps) => <SpeakerIcon {...props} />);
export const Sticker = memo((props: LucideProps) => <StickerIcon {...props} />);
export const Tag = memo((props: LucideProps) => <TagIcon {...props} />);
export const Trash2 = memo((props: LucideProps) => <Trash2Icon {...props} />);
export const UserPlus = memo((props: LucideProps) => <UserPlusIcon {...props} />);
export const Users = memo((props: LucideProps) => <UsersIcon {...props} />);
export const Video = memo((props: LucideProps) => <VideoIcon {...props} />);
export const VideoOff = memo((props: LucideProps) => <VideoOffIcon {...props} />);
export const Volume2 = memo((props: LucideProps) => <Volume2Icon {...props} />);
export const X = memo((props: LucideProps) => <XIcon {...props} />);
export const XCircle = memo((props: LucideProps) => <XCircleIcon {...props} />);
export const MoreVertical = memo((props: LucideProps) => <MoreVerticalIcon {...props} />);
export const UserMinus = memo((props: LucideProps) => <UserMinusIcon {...props} />);
export const Zap = memo((props: LucideProps) => <ZapIcon {...props} />);
export const Edit2 = memo((props: LucideProps) => <Edit2Icon {...props} />);
export const Crown = memo((props: LucideProps) => <CrownIcon {...props} />);
export const User = memo((props: LucideProps) => <UserIcon {...props} />);

// Set display names for debugging
AlertTriangle.displayName = "MemoAlertTriangle";
AtSign.displayName = "MemoAtSign";
Ban.displayName = "MemoBan";
Bell.displayName = "MemoBell";
CameraOff.displayName = "MemoCameraOff";
Camera.displayName = "MemoCamera";
Check.displayName = "MemoCheck";
ChevronDown.displayName = "MemoChevronDown";
ChevronUp.displayName = "MemoChevronUp";
Copy.displayName = "MemoCopy";
Download.displayName = "MemoDownload";
FileIcon.displayName = "MemoFileIcon";
Gamepad2.displayName = "MemoGamepad2";
Gift.displayName = "MemoGift";
Hash.displayName = "MemoHash";
Headphones.displayName = "MemoHeadphones";
Home.displayName = "MemoHome";
Info.displayName = "MemoInfo";
Link.displayName = "MemoLink";
Loader2.displayName = "MemoLoader2";
Maximize2.displayName = "MemoMaximize2";
Menu.displayName = "MemoMenu";
MessageSquare.displayName = "MemoMessageSquare";
Mic.displayName = "MemoMic";
MicOff.displayName = "MemoMicOff";
Minimize.displayName = "MemoMinimize";
Monitor.displayName = "MemoMonitor";
MonitorX.displayName = "MemoMonitorX";
MoreHorizontal.displayName = "MemoMoreHorizontal";
Music.displayName = "MemoMusic";
Phone.displayName = "MemoPhone";
Pin.displayName = "MemoPin";
Plus.displayName = "MemoPlus";
Radio.displayName = "MemoRadio";
Search.displayName = "MemoSearch";
Settings.displayName = "MemoSettings";
Share2.displayName = "MemoShare2";
Shield.displayName = "MemoShield";
ShieldCheck.displayName = "MemoShieldCheck";
Smile.displayName = "MemoSmile";
SignalHigh.displayName = "MemoSignalHigh";
Sparkles.displayName = "MemoSparkles";
Speaker.displayName = "MemoSpeaker";
Sticker.displayName = "MemoSticker";
Tag.displayName = "MemoTag";
Trash2.displayName = "MemoTrash2";
UserPlus.displayName = "MemoUserPlus";
Users.displayName = "MemoUsers";
Video.displayName = "MemoVideo";
VideoOff.displayName = "MemoVideoOff";
Volume2.displayName = "MemoVolume2";
X.displayName = "MemoX";
XCircle.displayName = "MemoXCircle";
Zap.displayName = "MemoZap";
