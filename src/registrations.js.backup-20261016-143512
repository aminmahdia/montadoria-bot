import db from "./database.js"

db.exec(`
  CREATE TABLE IF NOT EXISTS character_registrations (
    telegram_username TEXT COLLATE NOCASE PRIMARY KEY,
    character_name TEXT NOT NULL,
    registration_code TEXT NOT NULL,
    celebrity_name TEXT NOT NULL,
    photo_file_id TEXT,
    channel_message_id INTEGER,
    updated_at TEXT NOT NULL
  )
`)

function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u{1D400}-\u{1D419}]/gu, c =>
      String.fromCharCode(c.codePointAt(0) - 0x1D400 + 65))
    .replace(/[\u{1D41A}-\u{1D433}]/gu, c =>
      String.fromCharCode(c.codePointAt(0) - 0x1D41A + 97))
    .replace(/[\u{1D7CE}-\u{1D7D7}]/gu, c =>
      String.fromCharCode(c.codePointAt(0) - 0x1D7CE + 48))
    .trim()
}

function getField(caption, pattern) {
  for (const line of String(caption ?? "").split(/\r?\n/)) {
    const normalized = normalizeLabel(line)
    if (pattern.test(normalized)) {
      return normalized.replace(/^[^:]*:\s*/, "").trim()
    }
  }
  return null
}
function saveRegistration(ctx) {
  const post = ctx.channelPost || ctx.update?.channel_post
  if (!post || post.chat?.username?.toLowerCase() !== "roleregistration1") {
    return
  }

  const caption = post.caption || ""
  const characterName = getField(caption, /^\s*Name\s*:/i)
  const code = getField(caption, /^\s*Code\s*:/i)
  const celebrityName = getField(
    caption,
    /^\s*(?:Celebrity|Cele[bB]rity|Seleb(?:rity)?)\s+Name\s*:/i
  )
  const rawUsername = getField(caption, /^\s*Username\s*:/i)
  const username = rawUsername?.replace(/^@/, "").trim()
  const photoFileId = post.photo?.at(-1)?.file_id || null

  if (!characterName || !code || !celebrityName || !username) {
    console.log("Registration post skipped: required caption fields are missing.")
    return
  }

  db.prepare(`
    INSERT INTO character_registrations (
      telegram_username, character_name, registration_code,
      celebrity_name, photo_file_id, channel_message_id, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_username) DO UPDATE SET
      character_name = excluded.character_name,
      registration_code = excluded.registration_code,
      celebrity_name = excluded.celebrity_name,
      photo_file_id = COALESCE(
        excluded.photo_file_id,
        character_registrations.photo_file_id
      ),
      channel_message_id = excluded.channel_message_id,
      updated_at = excluded.updated_at
  `).run(
    username,
    characterName,
    code,
    celebrityName,
    photoFileId,
    post.message_id,
    new Date().toISOString()
  )

  console.log(`Registration saved for @${username}`)
}

export function registerRegistrations(bot) {
  bot.on("channel_post", saveRegistration)
  bot.on("edited_channel_post", saveRegistration)
}
