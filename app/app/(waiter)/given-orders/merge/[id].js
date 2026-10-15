import { useLocalSearchParams } from 'expo-router';
import { MergeTable } from '../../../../src/screens/MergeTable';
import { WAITER_PATHS } from '../../../../src/lib/paths';

export default function Merge() {
  return <MergeTable tableId={Number(useLocalSearchParams().id)} orderPath={WAITER_PATHS.order} />;
}
