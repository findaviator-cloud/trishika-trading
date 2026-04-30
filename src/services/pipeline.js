import { CONFIG } from "../config/index.js";
import { groqCall, extractJSON, clampSignal, buildPrompt } from "./ai_helpers.js";
import { localSignalFromIndicators } from "./local_ai.js";
import fs from "fs";
import path from "path";

export async function generateSignal(indicators = {}) {
	const prompt = buildPrompt(indicators);

	// 1) Groq first (if enabled and key present)
	if (CONFIG.useGroq && CONFIG.groqKey) {
		try {
			const text = await groqCall(prompt);
			const parsed = extractJSON(text);
			if (parsed) {
				const s = clampSignal({ ...parsed, _source: "Groq", indicators });
				if (s.confidence >= 40) return s;
			}
		} catch (e) {
			console.error("[GROQ PIPELINE FAIL]", e.message);
		}
	}

	// 2) Local LLaMA via Ollama
	try {
		const local = await localSignalFromIndicators(indicators);
		if (local && local.confidence >= 30) return local;
	} catch (e) {
		console.error("[LOCAL PIPELINE FAIL]", e.message);
	}

	// 3) Neutral fallback
	return clampSignal({
signal: "NEUTRAL",
confidence: 50,
reason: "AI failed, defaulting to neutral",
agent: "System",
_source: "Fallback",
indicators,
});
}


export async function generateAndSaveSignal(snapshot) {
	const symbol = snapshot.meta?.symbol || "Unknown";

	try {
		const indicators = snapshot.indicators || {};
		const aiSignal = await generateSignal(indicators);

		console.log("[AI_RAW]", symbol + ":", JSON.stringify(aiSignal));

		const finalSignal = clampSignal(snapshot, aiSignal);
		saveSignalToFile(symbol, finalSignal);
		return finalSignal;

	} catch (err) {
		console.error("[AI_CALL_ERROR]", symbol + ":", {
message: err.message,
stack: err.stack?.split("\n")[0],
code: err.code
});

const fallback = {
signal: "NEUTRAL",
	confidence: 50,
	reason: `AI failed: ${err.message}`,
	agent: "System",
	_source: "Fallback",
	indicators: snapshot
};

saveSignalToFile(symbol, fallback);
return fallback;
}
}

function saveSignalToFile(symbol, signalObj) {
  try {
    const safeSymbol = String(symbol || "UNKNOWN").replace(/[^\w.-]/g, "_");
    const outDir = path.resolve("signals");

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const file = path.join(outDir, `${safeSymbol}.json`);
    fs.writeFileSync(file, JSON.stringify(signalObj, null, 2), "utf8");
  } catch (e) {
    console.error("[SAVE SIGNAL FAIL]", e.message);
  }
}
