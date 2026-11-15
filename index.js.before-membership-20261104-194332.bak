import { Bot, API_CONSTANTS } from "grammy"
import { registerCommands } from "./src/commands.js"
import { registerSetNames } from "./src/setnames.js"
import { registerObserver } from "./src/observer.js"
import { registerRegistrations } from "./src/registrations.js"

const token = process.env.TELEGRAM_BOT_TOKEN

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is missing.")
  process.exit(1)
}

const bot = new Bot(token)

registerSetNames(bot)
registerCommands(bot)
registerObserver(bot)
registerRegistrations(bot)

bot.catch((err) => {
  console.error("Bot error:", err.error ?? err)
})

console.log("MONTADORIA bot is starting...")

bot.start({
  allowed_updates: [...new Set([...API_CONSTANTS.DEFAULT_UPDATE_TYPES, "chat_member", "chat_join_request"])],
  onStart: (botInfo) => {
    console.log(`Bot started as @${botInfo.username}`)
  },
})
