import supabase from "@/lib/supabase/createClient";

interface Outcome {
  name: string;
  tokens: number;
}

interface Market {
  id: number;
  name: string;
  description: string;
  token_pool: number;
  market_maker: string;
  tags: string[];
  status?: 'open' | 'closed' | 'annulled';
  close_date?: string;
  outcomes?: Outcome[];
}

export async function getMarkets(): Promise<Market[] | null> {
  const { data, error } = await supabase
    .from('markets')
    .select(`
      id,
      name,
      description,
      token_pool,
      market_maker,
      tags,
      status,
      close_date,
      outcomes!market_id( name, tokens )
    `);

  if (error) {
    console.error('Error fetching markets:', error.message);
    return null;
  }

  return data as Market[];
}