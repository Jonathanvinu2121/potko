import { useLocalSearchParams, useRouter } from 'expo-router';
import { SplitTable } from '../../../../src/screens/SplitTable';
import { TABLES_PATHS } from '../../../../src/lib/paths';
import { seatAt } from '../../../../src/lib/seating';
import { toast } from '../../../../src/store/toast';

// Split a table, opened from the Tables screen. Afterwards the newcomers can be seated on the free part at once.
export default function Split() {
  const router = useRouter();
  const seat = (table) => seatAt(table, router).catch((err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error' }));
  return <SplitTable tableId={Number(useLocalSearchParams().id)} orderPath={TABLES_PATHS.order} onSeat={seat} />;
}
