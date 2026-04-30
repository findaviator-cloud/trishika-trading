class RiskManager:
    def __init__(self, capital=100000, risk_per_trade=0.01, max_dd=0.05, max_trades=10):
        self.capital = capital
        self.initial_capital = capital
        self.risk_per_trade = risk_per_trade
        self.max_dd = max_dd
        self.max_trades = max_trades
        self.daily_loss = 0
        self.trades_today = 0
        self.consecutive_losses = 0

    def can_trade(self):
        if self.daily_loss <= -self.capital * self.max_dd:
            return False
        if self.trades_today >= self.max_trades:
            return False
        if self.consecutive_losses >= 3:
            return False
        return True

    def update_after_trade(self, pnl):
        self.capital += pnl
        self.daily_loss += pnl
        self.trades_today += 1

        if pnl < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

    def position_size(self, entry, sl):
        risk_amount = self.capital * self.risk_per_trade
        return risk_amount / abs(entry - sl)
