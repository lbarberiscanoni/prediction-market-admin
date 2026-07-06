import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { NextResponse } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (code || (tokenHash && type)) {
    const supabase = createSupabaseServerClient();

    try {
      let error = null;

      if (code) {
        ({ error } = await supabase.auth.exchangeCodeForSession(code));
      } else if (tokenHash && type) {
        ({ error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        }));
      }

      if (error) {
        console.error("Error handling auth callback:", error.message);
        return NextResponse.redirect(`${origin}/auth/auth-error`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    } catch (error) {
      console.error("Unexpected error during auth callback:", error);
      return NextResponse.redirect(`${origin}/auth/auth-error`);
    }
  }

  console.error("Missing 'code' parameter in callback URL.");
  return NextResponse.redirect(`${origin}/auth/auth-error`);
}
