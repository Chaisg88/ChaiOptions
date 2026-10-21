export const direction = trade => trade.strategy === 'buy_put' ? -1 : 1;
export function openingCash(trade) { return direction(trade) * trade.premium * trade.quantity * trade.multiplier - trade.fees; }
export function closingCash(trade) { return trade.close ? -direction(trade) * trade.close.premium * trade.quantity * trade.multiplier - trade.close.fees : 0; }
export function realized(trade) { return trade.close ? openingCash(trade) + closingCash(trade) : null; }
export function events(trades) {
  return trades.flatMap(t => [ {date:t.date, amount:openingCash(t), strategy:t.strategy, kind:'open', trade:t}, ...(t.close ? [{date:t.close.date, amount:closingCash(t), strategy:t.strategy, kind:'close', trade:t}] : [])]);
}
