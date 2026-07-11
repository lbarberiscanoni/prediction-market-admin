// supabase/functions/auto-close-markets/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Database {
  public: {
    Tables: {
      markets: {
        Row: {
          id: number
          name: string
          status: string
          close_date: string
        }
        Update: {
          status?: string
        }
      }
    }
  }
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create supabase client
    const supabaseClient = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Get current date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0]
    
    console.log(`Running auto-close markets for date: ${today}`)

    // Find all markets that should be closed today
    // Markets where:
    // 1. Status is currently 'open'
    // 2. close_date is today or earlier
    const { data: marketsToClose, error: fetchError } = await supabaseClient
      .from('markets')
      .select('id, name, status, close_date')
      .eq('status', 'open')
      .lte('close_date', today)

    if (fetchError) {
      console.error('Error fetching markets to close:', fetchError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch markets', details: fetchError }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    if (!marketsToClose || marketsToClose.length === 0) {
      console.log('No markets to close today')
      return new Response(
        JSON.stringify({ 
          message: 'No markets to close', 
          date: today,
          processed: 0 
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    console.log(`Found ${marketsToClose.length} markets to close:`, marketsToClose.map(m => ({ id: m.id, name: m.name, close_date: m.close_date })))

    // Update all markets to closed status
    const marketIds = marketsToClose.map(market => market.id)
    
    const { data: updatedMarkets, error: updateError } = await supabaseClient
      .from('markets')
      .update({ status: 'closed' })
      .in('id', marketIds)
      .select('id, name, status')

    if (updateError) {
      console.error('Error updating markets:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to update markets', details: updateError }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    console.log(`Successfully closed ${updatedMarkets?.length || 0} markets`)

    // Return success response with details
    return new Response(
      JSON.stringify({
        message: 'Markets auto-closed successfully',
        date: today,
        processed: updatedMarkets?.length || 0,
        markets: updatedMarkets || [],
        closedMarkets: marketsToClose.map(market => ({
          id: market.id,
          name: market.name,
          close_date: market.close_date
        }))
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )

  } catch (error) {
    console.error('Unexpected error in auto-close markets function:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})