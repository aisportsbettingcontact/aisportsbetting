// LoginPage — Custom email/password sign-in for app users
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { BarChart3, LogIn, Eye, EyeOff, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/_core/hooks/useAppAuth";
import { toast } from "sonner";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { appUser, loading: authLoading, refetch } = useAppAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Auth loading timeout — if auth check takes > 4s, show the login page anyway
  // Prevents the infinite black spinner on slow connections or dead server instances
  const [authTimedOut, setAuthTimedOut] = useState(false);
  useEffect(() => {
    if (!authLoading) return;
    const timer = setTimeout(() => setAuthTimedOut(true), 4000);
    return () => clearTimeout(timer);
  }, [authLoading]);

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && appUser) {
      setLocation("/");
    }
  }, [appUser, authLoading, setLocation]);

  const loginMutation = trpc.appUsers.login.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Welcome back!");
      setLocation("/");
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("Please enter your email and password.");
      return;
    }
    loginMutation.mutate({ emailOrUsername: email.trim(), password });
  };

  // Show spinner only while loading AND within the 4-second timeout window
  if (authLoading && !authTimedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-center px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <span className="text-sm font-black tracking-widest uppercase text-white">
            PREZ BETS
          </span>
          <span className="text-border text-sm">|</span>
          <span className="text-sm font-medium tracking-widest uppercase text-muted-foreground">
            AI MODEL PROJECTIONS
          </span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          {/* Hero */}
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto bg-primary/10 border border-primary/20">
              <BarChart3 className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-xl font-black tracking-widest uppercase text-white">
              Sign In
            </h1>
            <p className="text-xs text-muted-foreground">
              Access your AI model projections dashboard.
            </p>
          </div>

          {/* Login form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full px-3 py-2.5 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="w-full px-3 py-2.5 pr-10 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loginMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {loginMutation.isPending ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p className="text-center text-xs text-muted-foreground/60">
            This tool is for informational purposes only. Gamble responsibly.
          </p>
        </div>
      </main>
    </div>
  );
}
