"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Lock, Mail, ShieldAlert, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await signIn("credentials", {
        redirect: false,
        email,
        password,
        callbackUrl: "/admin/dashboard",
      });

      // Surface failures loudly instead of bouncing back to /login silently:
      // res is undefined when the sign-in request itself fails.
      if (!res || res.error || !res.ok) {
        setError(
          res?.error
            ? `Sign-in failed (${res.error}). Check credentials or contact admin.`
            : "Sign-in failed: no response from server. Check connection and try again."
        );
      } else {
        // Full-page navigation (not router.push): guarantees the browser
        // re-sends cookies and the middleware evaluates a fresh session.
        // router.push + router.refresh can race and leave you on /login.
        window.location.assign(res.url || "/admin/dashboard");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-slate-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <img
            src="/logo.png"
            alt="JamiCore"
            className="h-20 w-auto rounded-xl bg-white border border-slate-200 shadow-sm px-4 py-2 object-contain"
          />
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold tracking-tight text-slate-900">
          Staff & Admin Sign In
        </h2>
        <p className="mt-2 text-center text-sm text-slate-600">
          Access the invoice verification and management workspace
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-white py-8 px-6 shadow-sm border border-slate-200 rounded-2xl sm:px-10">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3 text-red-700 text-sm">
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Work Email
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@jamicore.com"
                  className="w-full px-3.5 py-2.5 pl-10 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <Mail className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 pl-10 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <Lock className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm"
            >
              {loading ? "Signing in..." : "Sign in to Dashboard"}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-100 text-center text-xs text-slate-500">
            <span>Use your admin/staff account to sign in.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
