import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseReqResClient } from "./lib/supabase/server-client";

// This repo is the admin console only — the public platform lives in a
// separate repo. Every route here requires an authenticated admin, except
// the auth flow itself (login, callback, password reset, error page).
const PUBLIC_PREFIXES = ["/auth"];

function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const { pathname } = request.nextUrl;

  // Always allow the auth flow so users can sign in and recover passwords.
  if (isPublicPath(pathname)) {
    return response;
  }

  const isApi = pathname.startsWith("/api");
  const supabase = await createSupabaseReqResClient(request, response);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Must be signed in.
  if (!user) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  // Must be an admin.
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.is_admin !== true) {
    if (isApi) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
