import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function Select({
  value,
  onValueChange,
  placeholder,
  options,
  label,
  id,
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  options: { value: string; label: string }[];
  label?: string;
  id: string;
}) {
  return (
    <div className="min-w-0">
      {label && (
        <label htmlFor={id} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </label>
      )}
      <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
        <SelectPrimitive.Trigger
          id={id}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line bg-white px-2.5 text-left text-sm text-ink",
            "focus:outline-none focus:ring-2 focus:ring-accent",
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown className="h-4 w-4 text-muted" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] overflow-auto rounded-lg border border-line bg-white py-1 shadow-lg"
          >
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-slate-100"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check className="h-3.5 w-3.5 text-accent" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
