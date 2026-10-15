import { useLocalSearchParams, useRouter } from 'expo-router';
import { SplitTable } from '../../../../src/screens/SplitTable';
import { WAITER_PATHS } from '../../../../src/lib/paths';
import { seatAt } from '../../../../src/lib/seating';
import { toast } from '../../../../src/store/toast';

export default function Split() {
  const router = useRouter();
  // After a split, the waiter can seat the newcomers on the free part straight away.
  const seat = (table) => seatAt(table, router).catch((err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error' }));
  return <SplitTable tableId={Number(useLocalSearchParams().id)} orderPath={WAITER_PATHS.order} onSeat={seat} />;
}
