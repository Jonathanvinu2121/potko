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

// The bill is always shown: a waiter who takes payments needs the amount even when dish prices are hidden.
export const useSeesBills = () => true;
