import { Link } from "react-router-dom";
import { APP_NAME, APP_SHORT } from "@/brand";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  to?: string;
  /** Dark navy bar (white/gold type) or light surface (navy type). */
  tone?: "dark" | "light";
  className?: string;
};

export function BrandMark({ to = "/", tone = "dark", className }: BrandMarkProps) {
  const dark = tone === "dark";
  const inner = (
    <>
      <img
        src="/logo-mark.webp"
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 shrink-0 rounded-md bg-white object-contain"
      />
      <span className="min-w-0 leading-tight">
        <span
          className={cn(
            "block text-[11px] font-semibold uppercase tracking-[0.14em]",
            dark ? "text-gold-200" : "text-navy-800",
          )}
        >
          {APP_SHORT}
        </span>
        <span
          className={cn(
            "block truncate text-sm font-semibold",
            dark ? "text-white" : "text-navy-900",
          )}
        >
          Revenue Assurance
        </span>
      </span>
    </>
  );
  const classes = cn("flex items-center gap-2.5", className);
  if (!to) {
    return (
      <div className={classes} aria-label={APP_NAME}>
        {inner}
      </div>
    );
  }
  return (
    <Link to={to} className={cn(classes, "hover:opacity-95")} aria-label={APP_NAME} data-testid="brand">
      {inner}
    </Link>
  );
}
