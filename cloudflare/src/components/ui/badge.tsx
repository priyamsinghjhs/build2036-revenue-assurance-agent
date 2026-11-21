import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
  {
    variants: {
      tone: {
        neutral: "bg-slate-100 text-slate-700",
        high: "bg-red-50 text-danger",
        medium: "bg-amber-50 text-warning",
        low: "bg-emerald-50 text-success",
        info: "bg-blue-50 text-accent-700",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
