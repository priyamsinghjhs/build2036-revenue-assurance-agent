import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth";
import { APP_NAME } from "@/brand";
import { AppFooter } from "@/components/AppFooter";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { USERS } from "@shared/roles";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    const dest = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    return <Navigate to={dest} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="brand-bar sticky top-0 z-50 h-14 shrink-0 bg-navy-900 text-white shadow-sm">
        <div className="flex h-full items-center px-4 md:px-6">
          <BrandMark to="/login" />
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md rounded-2xl border border-line bg-white p-8 shadow-sm" data-testid="login-page">
          <img
            src="/logo-full.webp"
            alt={APP_NAME}
            width={256}
            height={255}
            className="mx-auto h-auto w-44 sm:w-52"
          />
          <p className="mt-4 text-center text-xs font-semibold uppercase tracking-[0.14em] text-navy-800">
            Kosha Kshema
          </p>
          <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight text-navy-900">Sign in</h1>
          <p className="mt-2 text-center text-sm text-muted">
            {APP_NAME}. Use your role login ID. The app records your user id on every approval and write.
          </p>
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Username</span>
              <input
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
                placeholder="admin@ra.local"
                required
                data-testid="login-username"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
                required
                data-testid="login-password"
              />
            </label>
            {error ? <p className="text-sm text-danger" data-testid="login-error">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full" data-testid="login-submit">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <div className="mt-6">
            <p className="text-[11px] uppercase tracking-wide text-muted">Role login IDs</p>
            <ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-ink sm:grid-cols-2">
              {USERS.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="text-left text-accent hover:underline"
                    onClick={() => setUsername(u.id)}
                    data-testid={`login-id-${u.role}`}
                  >
                    {u.id}
                  </button>
                  <span className="text-muted"> · {u.role}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
