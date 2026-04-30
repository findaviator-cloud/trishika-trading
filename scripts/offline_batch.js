// scripts/offline_batch.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateAndSaveSignal } from "../src/services/pipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LIVE_DIR = path.join(__dirname, "..", "signals_live");
const OUT_DIR  = path.join(__dirname, "..", "signals_offline");

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function runOfflineBatch() {
  const files = fs.readdirSync(LIVE_DIR).filter(f => f.endsWith(".json"));

  for (const file of files) {
    const filePath = path.join(LIVE_DIR, file);
    const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));

    console.log(`Analyzing ${snapshot.meta?.symbol || file}...`);

    const result = await generateAndSaveSignal(snapshot);

    console.log(
      `Result for ${snapshot.meta?.symbol || file}: ${result.signal} (${result.confidence}%)`
    );

    const safeSymbol = (snapshot.meta?.symbol || file).replace(/[\/:]/g, "_");
    const outFile = path.join(OUT_DIR, safeSymbol + ".json");
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  }
}

runOfflineBatch().catch(console.error);


