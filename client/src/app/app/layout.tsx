"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/v2/app-shell";
import { queryClient } from "@/lib/query-client";

export default function V2AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell>{children}</AppShell>
    </QueryClientProvider>
  );
}
