import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data for 5 minutes — prevents redundant refetches on navigation
      staleTime: 5 * 60 * 1000,
      // Retry up to 2 times for transient network errors (Failed to fetch)
      // with exponential backoff: 1s, 2s. Avoids 30s+ spinners on slow connections.
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
      // Show stale data while refetching (no spinner flash on navigation)
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;

  // Don't redirect on the home/landing page — unauthenticated users should
  // see the landing page and choose to sign in themselves.
  const onLandingPage = window.location.pathname === "/" || window.location.pathname === "";
  if (onLandingPage) return;

  window.location.href = getLoginUrl();
};

// Procedure paths that are optional / auth-gated client-side — suppress UNAUTHORIZED noise for these.
// They use enabled:false guards but may fire once on initial render before auth state resolves.
// tRPC query keys are arrays like ["trpc", ["favorites", "getMyFavorites"], {...}]
const OPTIONAL_AUTH_PATHS = new Set([
  "favorites,getMyFavorites",
  "favorites,getMyFavoritesWithDates",
]);

function isOptionalAuthQuery(queryKey: readonly unknown[]): boolean {
  // tRPC v11 key shape: ["trpc", ["procedure", "name"], inputHash]
  const pathPart = queryKey[1];
  if (Array.isArray(pathPart)) return OPTIONAL_AUTH_PATHS.has(pathPart.join(","));
  return false;
}

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    // Suppress UNAUTHORIZED console errors for optional auth-gated queries to reduce noise.
    // These queries are already guarded with enabled:!loading && Boolean(appUser) and will
    // silently not fire once auth state resolves.
    const isUnauthorized = error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG;
    if (isOptionalAuthQuery(event.query.queryKey) && isUnauthorized) return; // suppress
    // Suppress transient network errors (Failed to fetch) — these are browser-level
    // connection blips that auto-retry. Logging them causes false-positive error reports.
    const isNetworkBlip = error instanceof TRPCClientError && error.message === "Failed to fetch";
    if (isNetworkBlip) return;
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // Cap GET URL length at 2048 bytes; tRPC will automatically switch to POST
      // for batches that exceed this limit (e.g. 68+ team color queries on Dashboard)
      // preventing HTTP 414 Request-URI Too Large from nginx
      maxURLLength: 2048,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
