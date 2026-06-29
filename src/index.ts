import { logger } from "./lib/logger.js";
import { startBot } from "./bot/index.js";

startBot();

logger.info("Bot started");
