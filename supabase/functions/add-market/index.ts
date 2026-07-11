// supabase/functions/add-market/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AddMarketRequest {
  name: string;
  description: string;
  token_pool?: number;
  market_maker?: string;
  close_date?: string;
  tags?: string[];
  status?: 'pending' | 'open' | 'closed' | 'annulled';
  link?: string;
  target?: number; // Added target field
  creator_id?: string;
  outcomes?: Array<{
    name: string;
    tokens?: number;
    description?: string;
  }>;
}

interface AddMarketResponse {
  success: boolean;
  market?: {
    id: number;
    name: string;
    description: string;
    token_pool: number;
    market_maker: string;
    close_date?: string;
    tags: string[];
    status: string;
    link?: string;
    target?: number; // Added target field
    creator_id: string;
    created_at: string;
  };
  outcomes?: Array<{
    id: number;
    name: string;
    tokens: number;
    market_id: number;
    created_at: string;
  }>;
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Parse request body
    let requestData: AddMarketRequest
    try {
      requestData = await req.json()
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON in request body' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Validate required fields
    const { name, description } = requestData
    if (!name || !description) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: name and description are required' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Validate outcomes array
    const outcomesToCreate = requestData.outcomes && requestData.outcomes.length > 0 ? requestData.outcomes : [
      { name: 'Yes', tokens: 10000, description: null },
      { name: 'No', tokens: 10000, description: null }
    ];
    
    // Validate outcomes
    if (outcomesToCreate.length < 2) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'At least 2 outcomes are required for a market' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Validate each outcome has a name
    for (const outcome of outcomesToCreate) {
      if (!outcome.name) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Each outcome must have a name' 
          }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }
    }

    // Set creator_id (default to specific admin user if not provided)
    let creator_id = requestData.creator_id
    if (!creator_id) {
      // Try to get authenticated user first
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        creator_id = user.id
      } else {
        // Fall back to default admin creator
        creator_id = 'ebc7e4e8-b321-437b-8587-7071fdf73183'
      }
    }

    // Set defaults
    const token_pool = requestData.token_pool || 20000
    const market_maker = requestData.market_maker || 'CPMM'
    const tags = requestData.tags || []
    const status = requestData.status || 'open'

    // Calculate total tokens from outcomes
    const totalOutcomeTokens = outcomesToCreate.reduce((sum, outcome) => 
      sum + (outcome.tokens || 10000), 0
    )

    console.log('Outcomes to create:', outcomesToCreate)
    console.log('Total outcome tokens:', totalOutcomeTokens)

    // Prepare market data - ADDED target field here
    const marketData = {
      creator_id,
      name,
      description,
      token_pool: totalOutcomeTokens,
      market_maker,
      tags,
      status,
      close_date: requestData.close_date || null,
      link: requestData.link || null,
      target: requestData.target !== undefined ? requestData.target : null, // Added this line
      created_at: new Date().toISOString()
    }

    // Start a transaction by inserting the market first
    const { data: market, error: marketError } = await supabase
      .from('markets')
      .insert(marketData)
      .select('*')
      .single()

    if (marketError) {
      console.error('Error creating market:', marketError)
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Failed to create market: ${marketError.message}` 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Create the outcomes based on the request
    const outcomesData = outcomesToCreate.map(outcome => ({
      market_id: market.id,
      name: outcome.name,
      tokens: outcome.tokens || 10000,
      description: outcome.description || null,
      creator_id,
      created_at: new Date().toISOString()
    }))

    const { data: outcomes, error: outcomesError } = await supabase
      .from('outcomes')
      .insert(outcomesData)
      .select('*')

    if (outcomesError) {
      console.error('Error creating outcomes:', outcomesError)
      
      // Rollback: delete the market that was created
      await supabase
        .from('markets')
        .delete()
        .eq('id', market.id)

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Failed to create outcomes: ${outcomesError.message}` 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Return success response
    const response: AddMarketResponse = {
      success: true,
      market,
      outcomes
    }

    return new Response(
      JSON.stringify(response),
      { 
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Internal server error' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

/* To deploy this function:

1. Make sure you have the Supabase CLI installed
2. Create the function directory: 
   mkdir -p supabase/functions/add-market
3. Save this file as supabase/functions/add-market/index.ts
4. Deploy with: supabase functions deploy add-market

Usage examples:

// Basic market creation
POST https://your-project-id.supabase.co/functions/v1/add-market
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "name": "Will it rain tomorrow?",
  "description": "Will it rain in New York City tomorrow?",
  "close_date": "2024-01-15T12:00:00Z",
  "tags": ["weather", "prediction"]
}

// Market with custom probability and token pool
{
  "name": "Will Bitcoin reach $100k in 2024?",
  "description": "Will Bitcoin's price reach $100,000 USD by December 31, 2024?",
  "token_pool": 30000,
  "initial_probability": 30,
  "close_date": "2024-12-31T23:59:59Z",
  "tags": ["crypto", "bitcoin", "price"],
  "link": "https://coinmarketcap.com/currencies/bitcoin/"
}

// Market with pending status (admin only)
{
  "name": "Election outcome",
  "description": "Who will win the 2024 election?",
  "status": "pending",
  "creator_id": "admin-user-id",
  "close_date": "2024-11-05T23:59:59Z",
  "tags": ["politics", "election"]
}
*/