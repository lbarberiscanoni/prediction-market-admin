import Link from "next/link";
import CyclePayoutReview from "@/components/CyclePayoutReview";

const adminTools = [
  {
    href: "/payments",
    title: "Payments",
    description: "Review pending leaderboard payouts, run manual batches, and audit payment status.",
    cta: "Open payments",
  },
  {
    href: "/players",
    title: "Players",
    description: "Find users, check balances, payment setup, and profile records.",
    cta: "View players",
  },
  {
    href: "/analytics",
    title: "Analytics",
    description: "Monitor user activity, trade volume, market health, and growth trends.",
    cta: "Open analytics",
  },
  {
    href: "/leaderboard",
    title: "Leaderboard",
    description: "Review current rankings and active users before approving payout cycles.",
    cta: "View leaderboard",
  },
];

export default function Admin() {
  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-300">
            Admin Console
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Operations hub</h1>
              <p className="mt-2 max-w-2xl text-gray-300">
                Manage payouts, players, and operational reporting from one place.
                Market creation is hidden for now while the admin workflow is focused
                on payments and review.
              </p>
            </div>
            <Link
              href="/payments"
              className="inline-flex items-center justify-center rounded-lg bg-green-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-green-700"
            >
              Go to payments
            </Link>
          </div>
        </header>

        <CyclePayoutReview />

        <section className="grid gap-4 md:grid-cols-2">
          {adminTools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-lg border border-gray-700 bg-gray-900 p-5 transition-colors hover:border-blue-500 hover:bg-gray-800"
            >
              <h2 className="text-xl font-semibold">{tool.title}</h2>
              <p className="mt-2 text-sm leading-6 text-gray-300">{tool.description}</p>
              <p className="mt-4 text-sm font-semibold text-blue-300">{tool.cta}</p>
            </Link>
          ))}
        </section>

        <section className="rounded-lg border border-amber-700 bg-amber-950/30 p-5">
          <h2 className="text-lg font-semibold text-amber-200">Payment safety checklist</h2>
          <div className="mt-3 grid gap-3 text-sm text-amber-50 md:grid-cols-3">
            <p>Confirm payout cycle date and total before sending.</p>
            <p>Review skipped users and missing payment IDs before approval.</p>
            <p>Use payment records for reconciliation after PayPal accepts the batch.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
