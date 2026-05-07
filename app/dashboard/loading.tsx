// Dashboard-wide loading skeleton. Renders while a Server Component segment
// is fetching data — replaces the previous blank flash. Kept deliberately
// quiet: a thin pulse-band where the header sits, and three muted cards
// where most dashboard pages render their first row of content. No
// pretend-content or fake numbers — empty cells, correct rhythm.

export default function DashboardLoading() {
  return (
    <main
      className="min-h-screen bg-night text-cream pt-24 px-6 md:px-10"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="max-w-6xl mx-auto">
        <div className="mb-10 space-y-4">
          <div
            className="h-3 w-32 rounded-sm bg-cream/8 animate-pulse"
            style={{ animationDuration: '1800ms' }}
          />
          <div
            className="h-10 w-72 rounded-sm bg-cream/10 animate-pulse"
            style={{ animationDuration: '1800ms' }}
          />
          <div
            className="h-3 w-96 rounded-sm bg-cream/6 animate-pulse"
            style={{ animationDuration: '2400ms' }}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-md border border-cream/5 bg-cream/[0.02] p-6 space-y-4 animate-pulse"
              style={{ animationDuration: '2200ms', animationDelay: `${i * 120}ms` }}
            >
              <div className="h-3 w-20 rounded-sm bg-cream/10" />
              <div className="h-8 w-32 rounded-sm bg-cream/12" />
              <div className="h-2 w-full rounded-sm bg-cream/6" />
              <div className="h-2 w-3/4 rounded-sm bg-cream/6" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
