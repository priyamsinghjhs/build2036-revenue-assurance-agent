import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Term = { term: string; definition: string; category?: string };

export default function GlossaryPage() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/glossary", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => setTerms(j.terms || j.glossary || []))
      .catch(() => setTerms([]));
  }, []);

  const filtered = terms.filter(
    (t) =>
      t.term.toLowerCase().includes(q.toLowerCase()) ||
      t.definition.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Glossary</h1>
      <input
        className="w-full max-w-md rounded border px-3 py-2 text-sm"
        placeholder="Search terms…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((t) => (
          <Card key={t.term}>
            <CardHeader className="py-3">
              <CardTitle className="text-base">{t.term}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{t.definition}</CardContent>
          </Card>
        ))}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground">No matching terms.</p>}
      </div>
    </div>
  );
}
