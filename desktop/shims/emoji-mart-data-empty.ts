/**
 * Desktop stand-in for the bare "@emoji-mart/data" import.
 *
 * The real set (~400 KB of JSON) is loaded on demand by src/lib/emoji.ts
 * through `import("@emoji-mart/data/sets/15/native.json")`, which this alias
 * does not match, so it lands in its own chunk instead of the entry.
 */
const emptyEmojiData = { categories: [], emojis: {}, aliases: {} };

export default emptyEmojiData;
