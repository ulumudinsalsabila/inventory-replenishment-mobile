import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth-provider';

export type BranchOption = { id: string; name: string; code?: string };

type BranchFilterValue = {
  branches: BranchOption[];
  /** Branch the screens should show. Empty string means all branches. */
  selectedBranchId: string;
  setSelectedBranchId: (id: string) => void;
  /** True when the signed-in user is assigned to one branch and cannot switch. */
  locked: boolean;
};

const BranchFilterContext = createContext<BranchFilterValue | null>(null);

export function BranchFilterProvider({ children }: { children: ReactNode }) {
  const { user, accessToken, authorizedRequest } = useAuth();
  const assignedBranchId = user?.branchId ?? '';
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [chosenBranchId, setChosenBranchId] = useState('');
  const [chosenForUser, setChosenForUser] = useState(user?.id);

  // A new sign-in starts from "all branches" instead of the previous user's choice.
  if (chosenForUser !== user?.id) {
    setChosenForUser(user?.id);
    setChosenBranchId('');
  }

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void authorizedRequest<{ data: BranchOption[] }>('catalog/branches?page=1&perPage=100&sortBy=name&sortOrder=asc')
      .then((result) => { if (active) setBranches(result.data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [accessToken, authorizedRequest, user?.id]);

  const value = useMemo<BranchFilterValue>(() => ({
    branches,
    selectedBranchId: assignedBranchId || chosenBranchId,
    setSelectedBranchId: setChosenBranchId,
    locked: Boolean(assignedBranchId),
  }), [assignedBranchId, branches, chosenBranchId]);

  return <BranchFilterContext.Provider value={value}>{children}</BranchFilterContext.Provider>;
}

export function useBranchFilter() {
  const value = useContext(BranchFilterContext);
  if (!value) throw new Error('useBranchFilter must be used inside BranchFilterProvider.');
  return value;
}
