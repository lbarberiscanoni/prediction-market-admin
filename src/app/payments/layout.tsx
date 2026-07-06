import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServerComponentClient } from '@/lib/supabase/server-client';

export default async function PaymentsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth');
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || profile?.is_admin !== true) {
    redirect('/');
  }

  return children;
}
