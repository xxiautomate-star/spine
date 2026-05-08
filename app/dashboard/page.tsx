import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// /dashboard has no UI of its own — every meaningful surface lives at a
// sub-route (timeline, keys, billing, …). The marketing pages and the
// free-plan CTA all link here, so without this redirect they 404.
// Timeline is the natural landing — it's what a user wants to see first.
export default function DashboardIndex() {
  redirect('/dashboard/timeline');
}
