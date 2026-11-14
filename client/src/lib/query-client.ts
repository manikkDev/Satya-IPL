"use client";

import { QueryClient } from "@tanstack/react-query";

// One query cache for the /app workspace. Cleared on sign-in/sign-out so one
// account never sees another account's cached data.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});
