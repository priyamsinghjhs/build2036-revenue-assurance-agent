import { useMemo, useState } from "react";
import { api, type AuditSuggestion, type SuggestionDecision } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/SeverityBadge";
import { inr } from "@/lib/format";

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
  }));
}

export function AuditPanel({
  output,
  exceptionId,
  decisions,
  compact,
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
  const [commentFor, setCommentFor] = useState<string>("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

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
          ? `Accepted. Created Action Queue item${res.action_id ? " " + res.action_id.slice(0, 8) : ""}${res.draft_id ? " and an in-app draft" : ""}. Nothing was sent externally.`
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

  return (
    <div className="space-y-3 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {verdict ? <SeverityBadge value={verdict} /> : null}
        {output.source === "skeleton" && (
          <span className="text-[11px] uppercase tracking-wide text-muted">Deterministic skeleton</span>
        )}
        {output.confidence != null && (
          <span className="text-[11px] text-muted">Confidence {String(output.confidence)}%</span>
        )}
      </div>
      {typeof output.cfo_one_liner === "string" && (
        <p className={compact ? "text-sm text-ink" : "text-sm text-ink"}>{output.cfo_one_liner}</p>
      )}
      {typeof output.rationale === "string" && output.rationale && !compact && (
        <p className="text-xs text-muted">{output.rationale}</p>
      )}
      {checks.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Audit checklist</h3>
          <div className="flex flex-wrap gap-1.5">
            {checks.map((c) => {
              const pass = String(c.result) === "pass";
              return (
                <span
                  key={String(c.name)}
                  title={`${String(c.evidence ?? "")} Source: ${String(c.source ?? "")}`}
                  className="max-w-full"
                >
                  <Badge tone={pass ? "low" : "high"} className="normal-case tracking-normal">
                    {pass ? "Pass" : "Fail"} · {CHECK_LABELS[String(c.name)] ?? String(c.name).replace(/_/g, " ")}
                  </Badge>
                </span>
              );
            })}
          </div>
          {!compact && (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {checks.map((c) => (
                <li key={`ev-${String(c.name)}`} className="min-w-0 break-words">
                  <span className="font-medium text-ink">{CHECK_LABELS[String(c.name)] ?? String(c.name)}:</span>{" "}
                  {String(c.evidence ?? "")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {findings.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Findings</h3>
          <ul className="space-y-1">
            {findings.map((f, i) => (
              <li key={i} className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 rounded-md border border-line bg-slate-50 px-2 py-1 text-xs">
                <span className="min-w-0 flex-1 break-words">
                  <SeverityBadge value={String(f.severity ?? "medium")} />{" "}
                  {String(f.issue ?? "")}
                </span>
                <span className="shrink-0 tabular-nums text-danger">{inr(Number(f.impact || 0), true)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {suggestions.length > 0 && exceptionId && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Suggestions</h3>
          <p className="mb-2 text-[11px] text-muted">Proposals only. Accept creates an Action Queue item or an in-app draft. Nothing is sent externally.</p>
          <div className="grid gap-2 md:grid-cols-2">
            {suggestions.map((s) => {
              const prior = decided.get(s.suggestion_id);
              return (
                <div key={s.suggestion_id} className="min-w-0 rounded-xl border border-line bg-white p-3">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink" title={s.title}>{s.title}</div>
                      <div className="text-[11px] text-muted">
                        {s.owner_team} · {s.priority} · {s.maps_to.replace(/_/g, " ")}
                      </div>
                    </div>
                    {s.expected_recovery ? (
                      <div className="shrink-0 text-right text-xs tabular-nums text-danger">{inr(s.expected_recovery, true)}</div>
                    ) : null}
                  </div>
                  {s.rationale && <p className="mt-1 text-xs text-muted">{s.rationale}</p>}
                  {prior ? (
                    <p className="mt-2 text-xs text-success">
                      {String(prior.decision) === "accepted"
                        ? `Accepted — Action Queue${prior.action_id ? " " + String(prior.action_id).slice(0, 8) : ""}`
                        : "Dismissed"}
                      {prior.comment ? ` · ${String(prior.comment)}` : ""}
                    </p>
                  ) : (
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
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {note && <p className="text-xs text-success">{note}</p>}
    </div>
  );
}
