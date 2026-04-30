import fs from 'fs';
const DATA_FILE = './market_data.json';

export const saveHistory = (symbol, candles) => {
    try {
        const data = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : {};
        data[symbol] = candles.slice(-200); // Keep only last 200 for memory efficiency
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Storage Error:", e.message);
    }
};

export const loadHistory = (symbol) => {
    if (!fs.existsSync(DATA_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
// return removeddata[symbol] || [];
};
