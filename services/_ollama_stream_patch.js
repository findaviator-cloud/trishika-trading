export async function readOllamaStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value);
  }

  const lines = raw.trim().split("\n");
  let fullContent = "";

  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (json.message?.content) {
        fullContent += json.message.content;
      }
    } catch {}
  }

  const parsed = JSON.parse(fullContent);

  // --- NORMALIZATION ---
  let signal = parsed.signal?.toUpperCase?.() || "NEUTRAL";

  if (signal === "BUY") signal = "LONG";
  if (signal === "SELL") signal = "SHORT";

  let confidence = parsed.confidence ?? 0;
  if (confidence <= 1) {
    confidence = Math.round(confidence * 100);
  }

  return {
    ...parsed,
    signal,
    confidence,
  };
}
