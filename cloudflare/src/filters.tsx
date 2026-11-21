import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type FilterOptions } from "@/api";
import { BOOK_PERIOD } from "@/lib/format";

export type Filters = {
  period: string;
  merchant: string;
  scheme: string;
};

const DEFAULT: Filters = { period: "2026-10", merchant: "all", scheme: "all" };

const Ctx = createContext<{
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  options: FilterOptions | null;
  isFiltered: boolean;
}>({ filters: DEFAULT, setFilters: () => undefined, options: null, isFiltered: false });

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, set] = useState<Filters>(DEFAULT);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  useEffect(() => {
    api.filters().then(setOptions).catch(() => undefined);
  }, []);
  const value = useMemo(
    () => ({
      filters,
      setFilters: (f: Partial<Filters>) => set((prev) => ({ ...prev, ...f })),
      options,
      isFiltered: filters.merchant !== "all" || filters.scheme !== "all",
    }),
    [filters, options],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFilters() {
  return useContext(Ctx);
}

export function periodLabel(period: string) {
  return period === "2026-10" ? BOOK_PERIOD.label : period;
}
