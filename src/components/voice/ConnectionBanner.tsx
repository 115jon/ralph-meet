/**
 * The stage's connection banner (talk-tree-spec §3 rule 4). It is the one
 * `ConnectionBanner` from `chat/ConnectionBanner`, placed inline under the
 * stage header and carrying the chat link's state too, so a chat drop and a
 * call drop at the same time read as one banner.
 */
export { StageConnectionBanner as ConnectionBanner } from "@/components/chat/ConnectionBanner";
