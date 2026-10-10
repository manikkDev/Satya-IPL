import NetworkGraph from "@/components/NetworkGraph";
import ProtectedRoute from "@/components/auth/protected-route";

export const metadata = {
  title: "Network Graph - Live Stream with Neo4j Thinking",
};

export default function GraphPage() {
  return (
    <ProtectedRoute allowedRoles={["analyst", "admin"]}>
      <main
        className="min-h-screen"
        style={{
          background:
            "radial-gradient(900px 420px at 12% -10%, rgba(52,178,123,0.18), transparent), radial-gradient(700px 360px at 90% 0%, rgba(106,169,255,0.16), transparent), var(--background)",
          padding: "42px 24px 64px",
        }}
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
                Network Graph
              </h1>
              <span className="pill-badge">LIVE STREAM</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Pseudonymised account graph streams via SSE. Search queries Neo4j in real time.
            </p>
          </div>

          <div className="float-card p-3 md:p-4">
            <NetworkGraph
              apiUrl={
                process.env.NEXT_PUBLIC_API_URL
                  ? `${process.env.NEXT_PUBLIC_API_URL}/api/graph`
                  : "http://localhost:5002/api/graph"
              }
              useStreaming={true}
              height={620}
            />
          </div>
        </div>
      </main>
    </ProtectedRoute>
  );
}
