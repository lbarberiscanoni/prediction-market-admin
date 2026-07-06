"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthError() {
  const router = useRouter();

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("type") === "recovery" && hash.get("access_token")) {
      router.replace(`/auth/reset-password${window.location.hash}`);
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 text-gray-900">
      <div className="w-full max-w-md p-8 space-y-4 bg-white shadow-md rounded-md text-center">
        <h1 className="text-2xl font-bold">Authentication Error</h1>
        <p className="text-sm text-gray-600">
          This auth link could not be handled automatically. If you were resetting your password,
          request a new recovery email from the login page.
        </p>
      </div>
    </div>
  );
}
