import { useLocalSearchParams } from 'expo-router';
import { MergeTable } from '../../../../src/screens/MergeTable';
import { TABLES_PATHS } from '../../../../src/lib/paths';

// Merge the parts of a split table, or join whole tables, opened from the Tables screen.
export default function Merge() {
  return <MergeTable tableId={Number(useLocalSearchParams().id)} orderPath={TABLES_PATHS.order} />;
}
