import { minutesSince } from '../lib/useNow';
import { Chip } from './Chip';

// How long an order has been waiting: grey under 15 min, amber 15–25 min, red over 25 min.
// The minutes are always written out, so the colour is never the only signal.
export const timerTone = (minutes) => (minutes > 25 ? 'error' : minutes >= 15 ? 'warning' : 'neutral');

export function TimerChip({ since, now }) {
  const minutes = minutesSince(since, now);
  return <Chip label={`${minutes}m`} icon="clock-outline" tone={timerTone(minutes)} size={14} />;
}
