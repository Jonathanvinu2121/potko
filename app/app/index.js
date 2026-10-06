import { Redirect } from 'expo-router';
import { useAuth } from '../src/store/auth';
import { homeFor } from '../src/lib/roles';

// The app's front door: signed-in users go to their role's home, everyone else picks a role.
export default function Index() {
  const user = useAuth((s) => s.user);
  return <Redirect href={user ? homeFor(user.role) : '/role'} />;
}
