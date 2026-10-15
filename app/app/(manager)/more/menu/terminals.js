import { Redirect } from 'expo-router';

// Kitchen terminals moved to their own place under More. Old links still land there.
export default function Terminals() {
  return <Redirect href="/more/kitchens" />;
}
