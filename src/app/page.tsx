import Link from "next/link";

const primaryActions = [
  {
    href: "/leaderboard",
    title: "Leaderboard",
    description: "See current standings and active users for the latest payout cycle.",
  },
  {
    href: "/admin",
    title: "Admin console",
    description: "Manage payouts, players, analytics, and operational review.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-4">
        <section className="flex flex-1 flex-col justify-center py-12">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-300">
              Prediction Market
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
              Account and operations dashboard
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-gray-300">
              Market browsing is hidden for now. Use the leaderboard and admin
              console to manage balances, review payout readiness, and keep
              operations moving.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {primaryActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="rounded-lg border border-gray-700 bg-gray-900 p-5 transition-colors hover:border-blue-500 hover:bg-gray-800"
              >
                <h2 className="text-xl font-semibold">{action.title}</h2>
                <p className="mt-2 text-sm leading-6 text-gray-300">{action.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
