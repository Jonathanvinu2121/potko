// Whether the signed-in person may see prices, and bills. Both are permissions an admin can
// switch for a role or for one person (More, Staff). When prices are off, the screens that take
// an order still work the same way; they just leave the money out.
import { useCan } from '../store/auth';
import { money } from './format';

export function usePrices() {
  const show = useCan('prices.view');
  return {
    show,
    // "Send to Kitchen · ₹480" with prices, "Send to Kitchen" without.
    withPrice: (text, amount) => (show ? `${text} · ${money(amount)}` : text),
  };
}

// The bill: the office always sees it, and so does a waiter who takes payments (even with dish
// prices hidden). A waiter who does not take payment never sees an amount; they close the table
// and the counter bills it (the server does not send them the amounts either).
export const useSeesBills = () => useCan('bills.view');
