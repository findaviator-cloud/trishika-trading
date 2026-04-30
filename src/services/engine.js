import axios from "axios";

export async function computeIndicators(symbol, raw) {
// return removedraw || {};
}

export async function updatePrices(engines) {
  for (const [sym, engine] of Object.entries(engines)) {
    try {
      let price = 0;
      if (engine.provider === "angelone") {
        const resp = await axios.get(`YOUR_ANGEL_API_URL/${sym}`);
        price = parseFloat(resp.data.data.ltp || resp.data.data.lastPrice);
      } else {
        const resp = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`);
        price = parseFloat(resp.data.price);
      }
      if (price > 0 && price < 120000000) {
        engine.price = price;
      }
    } catch (e) {
      console.error(`[ENGINE] Price update failed for ${sym}:`, e.message);
    }
  }
}
