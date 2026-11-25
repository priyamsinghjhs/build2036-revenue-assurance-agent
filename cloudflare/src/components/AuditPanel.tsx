import { useMemo, useState } from "react";
import { api, type AuditSuggestion, type SuggestionDecision } from "@/api";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/SeverityBadge";
import { inrExact } from "../../shared/money";
import { formatConfidence } from "@/lib/format";

const CHECK_LABELS: Record<string, string> = {
  amount_reconciliation: "Amount reconciliation",
  evidence_completeness: "Evidence completeness",
  policy_compliance: "Policy / contract",
  duplicate_prior_case: "Duplicate / prior case",
  segregation_of_duties: "SoD / approval limits",
  grounding: "Grounding",
};

function asChecks(output: Record<string, unknown>) {
  return Array.isArray(output.checks) ? (output.checks as Record<string, unknown>[]) : [];
}
function asFindings(output: Record<string, unknown>) {
  return Array.isArray(output.findings) ? (output.findings as Record<string, unknown>[]) : [];
}
function asSuggestions(output: Record<string, unknown>): AuditSuggestion[] {
  if (!Array.isArray(output.suggestions)) return [];
  return (output.suggestions as Record<string, unknown>[]).map((s, i) => ({
    suggestion_id: String(s.suggestion_id ?? s.id ?? `sug-${i + 1}`),
    action: String(s.action ?? s.type ?? "escalate"),
    title: String(s.title ?? s.summary ?? s.action ?? "Suggestion"),
    owner_team: String(s.owner_team ?? s.owner ?? "Ops"),
    priority: String(s.priority ?? "medium"),
    expected_recovery: Number(s.expected_recovery ?? s.amount ?? 0),
    maps_to: String(s.maps_to ?? "action_queue"),
    rationale: String(s.rationale ?? s.reason ?? ""),
    kind: s.kind === "recommendation" || s.kind === "fact" ? (s.kind as "recommendation" | "fact") : undefined,
    citation: s.citation ? String(s.citation) : undefined,
  }));
}

function resultTone(result: string): string {
  if (result === "pass") return "text-success bg-emerald-50";
  if (result === "n/a") return "text-muted bg-slate-100";
  return "text-danger bg-red-50";
}

function resultLabel(result: string): string {
  if (result === "pass") return "Pass";
  if (result === "n/a") return "N/A";
  return "Fail";
}

export function AuditPanel({
  output,
  exceptionId,
  decisions,
  onDecided,
}: {
  output: Record<string, unknown>;
  exceptionId?: string;
  decisions?: SuggestionDecision[];
  compact?: boolean;
  onDecided?: () => void;
}) {
  const verdict = String(output.verdict ?? output.signoff ?? "");
  const checks = asChecks(output);
  const findings = asFindings(output);
  const suggestions = asSuggestions(output);
  const decided = useMemo(() => {
    const m = new Map<string, SuggestionDecision>();
    for (const d of decisions ?? []) m.set(String(d.suggestion_id), d);
    return m;
  }, [decisions]);
  const [commentFor, setCommentFor] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  async function act(s: AuditSuggestion, decision: "accepted" | "dismissed") {
    if (!exceptionId) return;
    if (decision === "dismissed" && !comment.trim()) {
      setError("A comment is required to dismiss a suggestion.");
      setCommentFor(s.suggestion_id);
      return;
    }
    setBusy(`${decision}:${s.suggestion_id}`);
    setError("");
    try {
      const res = await api.decideSuggestion({
        exception_id: exceptionId,
        suggestion: s,
        decision,
        comment: comment.trim() || undefined,
      });
      setNote(
        decision === "accepted"
          ? `Accepted. Created an Action Queue item${res.action_id ? " " + res.action_id.slice(0, 8) : ""}${res.draft_id ? " and an in-app draft" : ""}. Nothing was sent externally.`
          : "Dismissed. The comment was written to the learning log.",
      );
      setComment("");
      setCommentFor("");
      onDecided?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const summary = String(output.cfo_one_liner ?? output.rationale ?? "");

  return (
    <div className="space-y-4 text-sm" data-testid="auditor-panel">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {verdict ? (
          <span data-testid="auditor-verdict">
            <SeverityBadge value={verdict} />
          </span>
        ) : null}
        {output.confidence != null && (
          <span className="text-[11px] text-muted">Confidence {formatConfidence(output.confidence)}</span>
        )}
      </div>
      {summary && (
        <p className="text-sm text-ink" data-testid="auditor-summary">{summary}</p>
      )}

      {checks.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Checklist</h3>
          <ul className="divide-y divide-line rounded-xl border border-line bg-white" data-testid="auditor-checklist">
            {checks.map((c) => {
              const name = String(c.name);
              const result = String(c.result ?? "").toLowerCase();
              const failed = result !== "pass" && result !== "n/a";
              const expanded = failed || open[name];
              return (
                <li key={name} className="px-3 py-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 text-left"
                    onClick={() => setOpen((s) => ({ ...s, [name]: !s[name] }))}
                    aria-expanded={expanded}
                  >
                    <span className="text-sm text-ink">{CHECK_LABELS[name] ?? name.replace(/_/g, " ")}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${resultTone(result)}`}>
                      {resultLabel(result)}
                    </span>
                  </button>
                  {expanded && (
                    <p className="mt-1 text-xs leading-relaxed text-muted">{String(c.evidence ?? "")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {findings.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Findings</h3>
          <ul className="space-y-1" data-testid="auditor-findings">
            {findings.map((f, i) => (
              <li key={i} className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 rounded-md border border-line bg-slate-50 px-2 py-1 text-xs">
                <span className="min-w-0 flex-1 break-words">
                  <SeverityBadge value={String(f.severity ?? "medium")} />{" "}
                  {String(f.issue ?? "")}
                </span>
                <span className="shrink-0 tabular-nums text-danger">{inrExact(Number(f.impact || 0))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div data-testid="auditor-suggestions">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Suggestions</h3>
        {suggestions.length === 0 ? (
          <p className="text-xs text-muted">No suggestions were produced. Retry the auditor step.</p>
        ) : (
          <div className="space-y-2">
            {suggestions.map((s) => {
              const prior = decided.get(s.suggestion_id);
              return (
                <div key={s.suggestion_id} className="min-w-0 rounded-xl border border-line bg-white p-3">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{s.title}</p>
                      <p className="text-[11px] text-muted">
                        Owner {s.owner_team} · {s.priority} priority
                        {s.expected_recovery ? ` · recover ${inrExact(s.expected_recovery)}` : ""}
                      </p>
                      {s.kind === "recommendation" ? (
                        <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">Recommendation</span>
                      ) : s.citation ? (
                        <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-muted">Evidence {s.citation}</span>
                      ) : null}
                    </div>
                  </div>
                  {s.rationale && <p className="mt-1 text-xs text-muted">{s.rationale}</p>}
                  {prior ? (
                    <p className="mt-2 text-xs text-success">
                      {String(prior.decision) === "accepted"
                        ? `Accepted — Action Queue${prior.action_id ? " " + String(prior.action_id).slice(0, 8) : ""}`
                        : "Dismissed"}
                      {prior.comment ? ` · ${String(prior.comment)}` : ""}
                    </p>
                  ) : exceptionId ? (
                    <div className="mt-2 space-y-2">
                      {commentFor === s.suggestion_id && (
                        <textarea
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          rows={2}
                          placeholder="Comment required to dismiss"
                          className="w-full rounded-md border border-line px-2 py-1 text-xs"
                        />
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" disabled={!!busy} onClick={() => void act(s, "accepted")}>
                          {busy === `accepted:${s.suggestion_id}` ? "Saving…" : "Accept"}
                        </Button>
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act(s, "dismissed")}>
                          {busy === `dismissed:${s.suggestion_id}` ? "Saving…" : "Dismiss"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {note && <p className="text-xs text-success">{note}</p>}
    </div>
  );
}
