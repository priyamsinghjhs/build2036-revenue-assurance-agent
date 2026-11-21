import { inr, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

type Point = Record<string, unknown>;

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function BarRow({
  name,
  value,
  max,
  tone = "accent",
  suffix,
}: {
  name: string;
  value: number;
  max: number;
  tone?: "accent" | "danger" | "ok" | "warn" | "ink";
  suffix?: string;
}) {
  const toneClass =
    tone === "danger" ? "bg-danger" : tone === "ok" ? "bg-success" : tone === "warn" ? "bg-amber-500" : tone === "ink" ? "bg-slate-700" : "bg-accent";
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium text-ink" title={name}>{name}</span>
        <span className="shrink-0 tabular-nums text-ink">{suffix ?? inr(Math.abs(value), true)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full", toneClass)} style={{ width: `${Math.max(4, Math.round((Math.abs(value) / Math.max(max, 1)) * 100))}%` }} />
      </div>
    </div>
  );
}

export function DomainCharts({ type, points }: { type: string; points: Point[] }) {
  if (type === "settlement") return <SettlementCharts points={points} />;
  if (type === "funding") return <FundingCharts points={points} />;
  if (type === "acquirer") return <AcquirerCharts points={points} />;
  if (type === "config") return <ConfigCharts points={points} />;
  if (type === "tax") return <TaxCharts points={points} />;
  if (type === "kyc") return <KycCharts points={points} />;
  if (type === "interfaces") return <InterfaceCharts points={points} />;
  if (type === "aml") return <SimpleNamed points={points} title="AML / fraud exposure by pattern" />;
  if (type === "success") return <SuccessCharts points={points} />;
  return null;
}

function SettlementCharts({ points }: { points: Point[] }) {
  const waterfall = points.filter((p) => p.kind === "waterfall");
  const timeline = points.filter((p) => p.kind === "status");
  const maxWater = Math.max(...waterfall.map((s) => Math.abs(num(s.value))), 1);
  const order = ["open", "cut_off", "calculated", "approved", "funded"];
  const byStatus = new Map(timeline.map((s) => [String(s.step ?? s.name), s]));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-medium text-ink">Gross-to-net waterfall</h3>
        <p className="mb-3 text-xs text-muted">Portfolio of October settlement batches after MDR, refunds, chargebacks, reserves and adjustments.</p>
        <div className="space-y-2">
          {waterfall.map((s) => (
            <BarRow
              key={String(s.name)}
              name={String(s.name)}
              value={num(s.value)}
              max={maxWater}
              tone={s.step === "net" ? "ok" : s.step === "deduct" ? "danger" : "accent"}
            />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-medium text-ink">Batch status timeline</h3>
        <p className="mb-3 text-xs text-muted">open → cut-off → calculated → approved → funded</p>
        <ol className="space-y-3">
          {order.map((st, i) => {
            const row = byStatus.get(st);
            const n = row?.n != null ? num(row.n) : undefined;
            const amount = num(row?.value);
            return (
              <li key={st} className="flex items-center gap-3">
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", n || amount ? "bg-accent text-white" : "bg-slate-100 text-slate-500")}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="capitalize text-ink">{st.replace("_", "-")}</span>
                    <span className="tabular-nums text-ink">{row ? inr(amount, true) : "—"}</span>
                  </div>
                  {n != null ? <div className="text-[11px] text-muted">{n} batches</div> : null}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-muted">Values are net settlement sitting in each status at book close.</p>
      </div>
    </div>
  );
}

function FundingCharts({ points }: { points: Point[] }) {
  const rails = points.filter((p) => p.kind === "rail");
  const ageing = points.filter((p) => p.kind === "ageing");
  const calendar = points.filter((p) => p.kind === "calendar");
  const onTime = rails.reduce((s, r) => s + num(r.on_time), 0);
  const total = rails.reduce((s, r) => s + num(r.n), 0);
  const maxAge = Math.max(...ageing.map((s) => num(s.amount)), 1);
  const days = calendar
    .map((c) => ({ day: String(c.day ?? c.name), n: num(c.n), amount: num(c.amount) }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))
    .sort((a, b) => a.day.localeCompare(b.day));
  const maxAmt = Math.max(...days.map((d) => d.amount), 1);
  // October 2026 starts on Thursday; pad to weeks
  const start = new Date("2026-10-01T00:00:00Z");
  const startWeekday = start.getUTCDay(); // 4
  const cells: { label: string; amount: number; n: number; inMonth: boolean }[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ label: "", amount: 0, n: 0, inMonth: false });
  for (let d = 1; d <= 31; d++) {
    const key = `2026-10-${String(d).padStart(2, "0")}`;
    const hit = days.find((x) => x.day === key);
    cells.push({ label: String(d), amount: hit?.amount ?? 0, n: hit?.n ?? 0, inMonth: true });
  }
  const ageingTone = (name: string) =>
    name === "On time" ? "ok" : name === "Held" || name === "Failed" || name === "Returned" || name === "Duplicate" ? "danger" : "warn";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="text-2xl font-semibold tabular-nums text-ink">{pct(total ? onTime / total : 1)}</div>
        <p className="text-sm text-muted">on-time funding ({onTime} of {total} instructions)</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-medium text-ink">SLA ageing</h3>
          <div className="space-y-2">
            {ageing
              .slice()
              .sort((a, b) => num(b.amount) - num(a.amount))
              .map((s) => (
                <BarRow
                  key={String(s.name)}
                  name={`${s.name} · ${num(s.n)}`}
                  value={num(s.amount)}
                  max={maxAge}
                  tone={ageingTone(String(s.name))}
                />
              ))}
          </div>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-medium text-ink">Funding calendar · October 2026</h3>
          <p className="mb-2 text-xs text-muted">Colour intensity is funded amount on the value date. Sunday–Saturday weeks.</p>
          <div className="grid grid-cols-7 gap-1">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={`${d}-${i}`} className="text-center text-[10px] font-medium uppercase text-muted">{d}</div>
            ))}
            {cells.map((c, i) => {
              const intensity = c.amount <= 0 ? 0 : Math.max(0.12, c.amount / maxAmt);
              return (
                <div
                  key={i}
                  title={c.inMonth ? `${c.label} Oct · ${c.n} txns · ${inr(c.amount, true)}` : undefined}
                  className={cn(
                    "flex aspect-square min-h-8 items-center justify-center rounded-sm text-[10px] tabular-nums",
                    !c.inMonth && "bg-transparent",
                    c.inMonth && c.amount <= 0 && "bg-slate-100 text-slate-500",
                    c.inMonth && c.amount > 0 && "text-white",
                  )}
                  style={c.inMonth && c.amount > 0 ? { backgroundColor: `rgba(29, 78, 216, ${intensity})` } : undefined}
                >
                  {c.inMonth ? c.label : ""}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function AcquirerCharts({ points }: { points: Point[] }) {
  const rows = points.filter((p) => p.kind === "compare" || p.name);
  const maxVol = Math.max(...rows.map((r) => num(r.volume)), 1);
  const maxFee = Math.max(...rows.map((r) => Math.max(num(r.fee_invoiced), num(r.fee_expected))), 1);
  const maxPt = Math.max(...rows.map((r) => Math.max(num(r.passthrough_invoiced), num(r.passthrough_expected))), 1);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-medium text-ink">Capture volume and approval rate</h3>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={String(r.name)} className="min-w-0">
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-medium text-ink" title={String(r.name)}>{String(r.name)}</span>
                <span className="shrink-0 tabular-nums text-ink">
                  {inr(num(r.volume), true)} · {num(r.approval_rate).toFixed(1)}% approved
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.round((num(r.volume) / maxVol) * 100))}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-medium text-ink">Acquirer fees · invoiced vs contract</h3>
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={`fee-${r.name}`} className="space-y-1">
                <div className="text-xs font-medium text-ink">{String(r.name)}</div>
                <BarRow name="Contract" value={num(r.fee_expected)} max={maxFee} tone="ink" />
                <BarRow
                  name="Invoiced"
                  value={num(r.fee_invoiced)}
                  max={maxFee}
                  tone={num(r.fee_invoiced) - num(r.fee_expected) > 0.5 ? "danger" : "accent"}
                />
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-medium text-ink">Interchange++ / scheme pass-through</h3>
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={`pt-${r.name}`} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-xs font-medium text-ink">
                  <span className="truncate">{String(r.name)}</span>
                  <span className="tabular-nums text-muted">{num(r.settle_lag) > 0 ? `Settle lag ${num(r.settle_lag)}d` : "On-time settle"}</span>
                </div>
                <BarRow name="Expected pass-through" value={num(r.passthrough_expected)} max={maxPt} tone="ink" />
                <BarRow
                  name="Invoiced pass-through"
                  value={num(r.passthrough_invoiced)}
                  max={maxPt}
                  tone={num(r.passthrough_invoiced) - num(r.passthrough_expected) > 0.5 ? "danger" : "accent"}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


function ConfigCharts({ points }: { points: Point[] }) {
  const rows = points.filter((p) => p.kind === "change" || p.name);
  const max = Math.max(...rows.map((r) => num(r.value)), 1);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Revenue impact since each change. Unapproved changes are highlighted.</p>
      {rows.map((r) => (
        <BarRow
          key={String(r.name)}
          name={`${r.name}${Number(r.approved) === 1 ? "" : " · unapproved"}`}
          value={num(r.value)}
          max={max}
          tone={Number(r.approved) === 1 ? "ok" : "danger"}
        />
      ))}
    </div>
  );
}

function TaxCharts({ points }: { points: Point[] }) {
  const gst = points.filter((p) => p.kind === "gst");
  const tds = points.filter((p) => p.kind === "tds");
  const max = Math.max(...points.map((p) => Math.max(num(p.expected), num(p.actual), num(p.statutory))), 1);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-medium text-ink">GST on invoices vs 18% statutory</h3>
        <div className="space-y-3">
          {gst.map((r) => (
            <div key={String(r.name)} className="space-y-1">
              <div className="truncate text-xs font-medium text-ink" title={String(r.name)}>{String(r.name)}</div>
              <BarRow name="Statutory 18%" value={num(r.statutory ?? r.expected)} max={max} tone="ink" />
              <BarRow name="Charged" value={num(r.actual)} max={max} tone={Math.abs(num(r.actual) - num(r.statutory ?? r.expected)) > 0.5 ? "danger" : "ok"} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-medium text-ink">TDS on partner commission (illustrative 5%)</h3>
        <div className="space-y-3">
          {tds.map((r) => (
            <div key={String(r.name)} className="space-y-1">
              <div className="truncate text-xs font-medium text-ink">{String(r.name)}</div>
              <BarRow name="Expected TDS" value={num(r.expected)} max={max} tone="ink" />
              <BarRow name="Withheld" value={num(r.actual)} max={max} tone={num(r.actual) + 0.5 < num(r.expected) ? "danger" : "ok"} />
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">Zero MDR on RuPay debit / UPI P2M is labelled illustrative and listed in the exceptions table.</p>
      </div>
    </div>
  );
}

function KycCharts({ points }: { points: Point[] }) {
  const status = points.filter((p) => p.kind === "status");
  const tier = points.filter((p) => p.kind === "tier");
  const max = Math.max(...points.map((p) => num(p.n)), 1);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-medium text-ink">KYC status</h3>
        <div className="space-y-2">
          {status.map((r) => (
            <BarRow key={String(r.name)} name={String(r.name)} value={num(r.n)} max={max} tone={String(r.name) === "active" ? "ok" : "danger"} suffix={String(num(r.n))} />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-medium text-ink">Risk tier</h3>
        <div className="space-y-2">
          {tier.map((r) => (
            <BarRow key={String(r.name)} name={String(r.name)} value={num(r.n)} max={max} tone={String(r.name) === "high" ? "danger" : "accent"} suffix={String(num(r.n))} />
          ))}
        </div>
      </div>
    </div>
  );
}

function InterfaceCharts({ points }: { points: Point[] }) {
  const hops = ["gateway", "switch", "clearing", "settlement", "bank", "gl"];
  const totals = hops.map((hop) => {
    const rows = points.filter((p) => p.hop === hop);
    return {
      hop,
      n: rows.reduce((s, r) => s + num(r.n), 0),
      volume: rows.reduce((s, r) => s + num(r.volume), 0),
      drop_n: rows.reduce((s, r) => s + num(r.drop_n), 0),
    };
  });
  const max = Math.max(...totals.map((t) => t.volume), 1);
  const days = Array.from(new Set(points.map((p) => String(p.day)))).sort();
  const peak = days
    .map((day) => ({ day, volume: points.filter((p) => p.day === day && p.hop === "gateway").reduce((s, r) => s + num(r.volume), 0) }))
    .sort((a, b) => b.volume - a.volume)[0];
  const funnel = hops.map((hop) => {
    const row = points.find((p) => p.day === peak?.day && p.hop === hop);
    return { hop, n: num(row?.n), volume: num(row?.volume) };
  });
  const fmax = Math.max(...funnel.map((f) => f.volume), 1);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-medium text-ink">Book totals by hop</h3>
        <div className="space-y-2">
          {totals.map((t) => (
            <BarRow
              key={t.hop}
              name={`${t.hop}${t.drop_n ? ` · ${t.drop_n} drops` : ""}`}
              value={t.volume}
              max={max}
              tone={t.drop_n ? "warn" : "accent"}
            />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-medium text-ink">Daily funnel · {peak?.day ?? "—"}</h3>
        <p className="mb-3 text-xs text-muted">Highest-volume gateway day in the October book, then the same calendar day at later hops (clearing and settlement may land on a later value date).</p>
        <div className="space-y-2">
          {funnel.map((f) => (
            <BarRow key={f.hop} name={`${f.hop} · ${f.n} msgs`} value={f.volume} max={fmax} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SimpleNamed({ points, title }: { points: Point[]; title: string }) {
  const max = Math.max(...points.map((p) => num(p.value)), 1);
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-ink">{title}</h3>
      <div className="space-y-2">
        {points.map((p) => (
          <BarRow key={String(p.name)} name={`${p.name} · ${num(p.n)}`} value={num(p.value)} max={max} tone="danger" />
        ))}
      </div>
    </div>
  );
}

function SuccessCharts({ points }: { points: Point[] }) {
  const channel = points.filter((p) => p.kind === "channel");
  const acquirer = points.filter((p) => p.kind === "acquirer");
  const reason = points.filter((p) => p.kind === "reason");
  const emi = points.filter((p) => p.kind === "emi");
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-medium text-ink">Approval rate by channel</h3>
          <div className="space-y-2">
            {channel.map((r) => (
              <BarRow
                key={String(r.name)}
                name={`${r.name} · ${num(r.approved)}/${num(r.n)}`}
                value={num(r.rate)}
                max={1}
                tone={num(r.rate) < 0.85 ? "danger" : "ok"}
                suffix={pct(num(r.rate))}
              />
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-medium text-ink">Approval rate by acquirer</h3>
          <div className="space-y-2">
            {acquirer.map((r) => (
              <BarRow
                key={String(r.name)}
                name={`${r.name} · ${num(r.approved)}/${num(r.n)}`}
                value={num(r.rate)}
                max={1}
                tone={num(r.rate) < 0.85 ? "danger" : "ok"}
                suffix={pct(num(r.rate))}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-medium text-ink">Decline reasons</h3>
          <div className="space-y-2">
            {reason.map((r) => (
              <BarRow key={String(r.name)} name={String(r.name)} value={num(r.n)} max={Math.max(...reason.map((x) => num(x.n)), 1)} tone="warn" suffix={String(num(r.n))} />
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-medium text-ink">EMI vs non-EMI (card)</h3>
          <div className="space-y-2">
            {emi.map((r) => (
              <BarRow
                key={String(r.name)}
                name={`${r.name} · ${num(r.n)} txns`}
                value={num(r.volume)}
                max={Math.max(...emi.map((x) => num(x.volume)), 1)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
