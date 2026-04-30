import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const LOG_DIR  = path.resolve(__dirname, "../../logs");
const LOG_FILE = path.join(LOG_DIR, "signals.jsonl");


function logSignal(entry) {
  const record = {
    ts:          new Date().toISOString(),
    symbol:      entry.symbol,
    interval:    entry.interval     ?? "1m",
    indicators:  entry.indicators   ?? null,
    finalSignal: entry.finalSignal  ?? null,
    source:      entry.source       ?? "unknown",
  };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + "
", "utf8");
  } catch (err) {
    console.error("[LOGGER] Failed to write signal log:", err.message);
  }
}

export { logSignal, LOG_FILE };
