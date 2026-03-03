// LoginPage — Manus OAuth sign-in
import { useEffect } from "react";
import { useLocation } from "wouter";
import { BarChart3, LogIn, TrendingUp, Shield, Zap } from "lucide-react";
import { getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      setLocation("/");
    }
  }, [isAuthenticated, loading, setLocation]);

  const handleLogin = () => {
    window.location.href = getLoginUrl();
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#080810" }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/8">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-violet-400" />
          <span
            className="text-sm font-bold tracking-widest uppercase text-white"
          >
            AI Sports Betting Models
          </span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          {/* Hero */}
          <div className="text-center space-y-3">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
              style={{ background: "rgba(108,99,255,0.15)", border: "1px solid rgba(108,99,255,0.3)" }}
            >
              <BarChart3 className="w-8 h-8 text-violet-400" />
            </div>
            <h1
              className="text-2xl font-bold tracking-tight text-white"
              style={{ letterSpacing: "0.05em" }}
            >
              Model Projections
            </h1>
            <p className="text-sm text-gray-400 leading-relaxed">
              AI-powered sports betting model projections — spreads, totals, and edges.
            </p>
          </div>

          {/* Features */}
          <div className="space-y-3">
            {[
              { icon: TrendingUp, label: "Spread & total projections" },
              { icon: Zap, label: "Real-time model edges" },
              { icon: Shield, label: "Upload your own model files" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: "#0f0f1a", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(108,99,255,0.15)" }}
                >
                  <Icon className="w-4 h-4 text-violet-400" />
                </div>
                <span className="text-sm text-gray-200">{label}</span>
              </div>
            ))}
          </div>

          {/* Sign in button */}
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-sm text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #6c63ff 0%, #5a52e0 100%)" }}
          >
            <LogIn className="w-4 h-4" />
            Sign in to continue
          </button>

          <p className="text-center text-xs text-gray-500">
            By signing in you agree to gamble responsibly.
            This tool is for informational purposes only.
          </p>
        </div>
      </main>
    </div>
  );
}
