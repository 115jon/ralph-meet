import type { D1Database } from "@cloudflare/workers-types";

let pronounsColumnEnsured = false;
let soundSettingsColumnEnsured = false;

function isDuplicateColumnError(error: unknown, columnName: string) {
  if (!(error instanceof Error)) return false;
  return error.message
    .toLowerCase()
    .includes(`duplicate column name: ${columnName.toLowerCase()}`);
}

export async function ensureUserProfileSchema(db: D1Database) {
  if (pronounsColumnEnsured && soundSettingsColumnEnsured) return;

  if (!pronounsColumnEnsured) {
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN pronouns TEXT").run();
    } catch (error) {
      if (!isDuplicateColumnError(error, "pronouns")) {
        throw error;
      }
    }
    pronounsColumnEnsured = true;
  }

  if (!soundSettingsColumnEnsured) {
    try {
      await db
        .prepare("ALTER TABLE users ADD COLUMN sound_settings TEXT")
        .run();
    } catch (error) {
      if (!isDuplicateColumnError(error, "sound_settings")) {
        throw error;
      }
    }
    soundSettingsColumnEnsured = true;
  }
}
