import { FOOTER_TEXT } from "@/brand";

export function AppFooter() {
  return (
    <footer
      className="no-print mt-auto border-t border-navy-800 bg-navy-900 px-4 py-3 text-center text-[11px] leading-relaxed text-slate-300 sm:px-6 sm:text-xs"
      data-testid="app-footer"
    >
      <p className="mx-auto max-w-3xl text-pretty">{FOOTER_TEXT}</p>
    </footer>
  );
}
