import { useAuth } from '../store/auth';
import { homeFor } from './roles';

// For a role's layout: returns where to send someone who should not be here, or null if they belong.
// (The server checks the role on every request as well; this only keeps people on their own screens.)
export function useRoleGuard(...allowed) {
  const user = useAuth((s) => s.user);
  if (!user) return '/role';
  if (!allowed.includes(user.role)) return homeFor(user.role);
  return null;
}
