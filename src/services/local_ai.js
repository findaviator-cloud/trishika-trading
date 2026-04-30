import axios from "axios";
import { CONFIG } from "../config/index.js";
import { extractJSON, clampSignal, buildPrompt } from "./ai_helpers.js";

const LOCAL_MODEL = process.env.LOCAL_MODEL || "llama3.1:8b";

export async function localSignalFromIndicators(indicators = {}) {
  const prompt = buildPrompt(indicators);
  try {
    const resp = await axios.post(
      CONFIG.ollamaUrl || "http://localhost:11434/api/generate",
      {
        model: LOCAL_MODEL,
        prompt,
        stream: false,
      },
      { timeout: 60000 } // 60s for local analysis
    );
    const text = resp.data?.response || null;
    const parsed = extractJSON(text);
    return parsed
      ? clampSignal({ ...parsed, _source: "LocalLlama", indicators })
      : null;
  } catch (e) {
    console.error("[LOCAL AI FAIL]", e.response?.data || e.message);
    return null;
  }
}
