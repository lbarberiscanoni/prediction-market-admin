import ActiveUsers from "@/components/ActiveUsers";
import Leaderboard from "@/components/Leaderboard";

export default function LeaderboardPage() {
  return (
    <div className="flex flex-col items-center justify-start min-h-screen w-full p-4">
      <Leaderboard />
      <ActiveUsers />
    </div>
  );
}