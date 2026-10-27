import type { ReactNode } from 'react';
import { useAuth } from './auth-provider';

/** True for cashier accounts (role PEGAWAI). */
export const isEmployeeUser = (user: { roles: string[] } | null | undefined) => user?.roles.some((role) => role.toUpperCase() === 'PEGAWAI') ?? false;

/**
 * Renders its children for admins only. Used for "pick from gallery" on photo evidence: cashiers must take the photo
 * with the camera on the spot, admins may also attach existing pictures.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user && !isEmployeeUser(user) ? <>{children}</> : null;
}
