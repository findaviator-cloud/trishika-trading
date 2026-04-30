import { loadHistory } from './services/storage.js';

export async function warmStart(symbols) {
    console.log("📂 Starting Warm Start: Loading offline data...");
    const state = {};
    for (const symbol of symbols) {
        const history = loadHistory(symbol);
        if (history.length > 0) {
            state[symbol] = history;
            console.log(`✅ Loaded ${history.length} candles for ${symbol}`);
        } else {
            console.log(`⚠️ No saved data for ${symbol}. Waiting for live feed...`);
        }
    }
    return state;
}
