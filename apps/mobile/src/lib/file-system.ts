import { hasNativeModule } from "./native";

type FileSystemModule = typeof import("expo-file-system");

/** expo-file-system, or null in a dev client built without it. */
export const fileSystem: FileSystemModule | null = hasNativeModule("FileSystem")
  ? (require("expo-file-system") as FileSystemModule)
  : null;
