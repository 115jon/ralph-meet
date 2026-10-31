import { BricolageGrotesque_600SemiBold } from "@expo-google-fonts/bricolage-grotesque/600SemiBold";
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque/800ExtraBold";
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { MartianMono_500Medium } from "@expo-google-fonts/martian-mono/500Medium";
import { MartianMono_600SemiBold } from "@expo-google-fonts/martian-mono/600SemiBold";

/** Registered with expo-font under these keys: static weights, one family each. */
export const FONT_ASSETS = {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
  Geist_400Regular,
  Geist_500Medium,
  MartianMono_500Medium,
  MartianMono_600SemiBold,
};

/** Bricolage: titles, names, control labels. Martian: silkscreen and numbers. Geist: prose. */
export const FONT = {
  control: "BricolageGrotesque_600SemiBold",
  name: "BricolageGrotesque_700Bold",
  display: "BricolageGrotesque_800ExtraBold",
  body: "Geist_400Regular",
  row: "Geist_500Medium",
  silk: "MartianMono_500Medium",
  silkStrong: "MartianMono_600SemiBold",
} as const;
