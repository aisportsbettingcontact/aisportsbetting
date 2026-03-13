import { trpc } from "@/lib/trpc";

export function useAppAuth() {
  const { data: appUser, isLoading, refetch } = trpc.appUsers.me.useQuery(undefined, {
    // Cache auth state for 5 minutes — avoids redundant round-trips on every navigation
    staleTime: 5 * 60 * 1000,
    // Only retry once if the request fails — prevents 30s+ spinner on slow connections
    retry: 1,
    retryDelay: 1000,
    // Don't refetch on window focus — reduces unnecessary auth checks
    refetchOnWindowFocus: false,
  });

  return {
    appUser: appUser ?? null,
    loading: isLoading,
    isOwner: appUser?.role === "owner",
    isAdmin: appUser?.role === "admin" || appUser?.role === "owner",
    refetch,
  };
}
