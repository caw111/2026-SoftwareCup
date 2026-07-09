import { getDatabasePool } from "../db/pool.js";

export async function claimLegacyImportRecord(userId, sourceKey) {
  const [result] = await getDatabasePool().execute(
    "INSERT IGNORE INTO legacy_imports (source_key, user_id) VALUES (?, ?)",
    [sourceKey, userId]
  );
  return result.affectedRows > 0;
}

export async function releaseLegacyImportRecord(userId, sourceKey) {
  await getDatabasePool().execute(
    "DELETE FROM legacy_imports WHERE source_key = ? AND user_id = ?",
    [sourceKey, userId]
  );
}
