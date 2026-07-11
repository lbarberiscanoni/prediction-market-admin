import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role key for elevated permissions
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Get FRED API key
    const fredApiKey = Deno.env.get('FRED_API_KEY')
    
    if (!fredApiKey) {
      console.error('FRED_API_KEY environment variable not set')
      return new Response(
        JSON.stringify({ 
          error: 'FRED_API_KEY environment variable not set',
          message: 'Please configure the FRED API key in Supabase environment variables'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      )
    }

    // Calculate the date 15 days from now
    const fifteenDaysFromNow = new Date()
    fifteenDaysFromNow.setDate(fifteenDaysFromNow.getDate() + 14)
    
    // Format date to match your database format (assuming it's a date/timestamp)
    const targetDate = fifteenDaysFromNow.toISOString().split('T')[0] // YYYY-MM-DD format

    console.log(`Looking for markets closing on: ${targetDate}`)

    // Get markets that close in 15 days
    const { data: markets, error: marketsError } = await supabaseClient
      .from('markets')
      .select('id, name, close_date, description')
      .eq('close_date', targetDate)

    if (marketsError) {
      console.error('Error fetching markets:', marketsError)
      throw marketsError
    }

    console.log(`Found ${markets?.length || 0} markets closing in 15 days`)

    if (!markets || markets.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: 'No markets found closing in 15 days',
          date_checked: targetDate 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    const createdOutcomes = []
    const updatedMarkets = []
    const creatorId = 'ebc7e4e8-b321-437b-8587-7071fdf73183'

    // Create outcomes for each market
    for (const market of markets) {
      console.log(`Processing market: ${market.id} (${market.name})`)

      // Search FRED for series matching the market name
      let fredSeriesId = null
      let seriesTitle = null
      
      try {
        console.log(`Searching FRED for: "${market.name}"`)
        
        // Search for series by the market name
        const searchUrl = `https://api.stlouisfed.org/fred/series/search?search_text=${encodeURIComponent(market.name)}&api_key=${fredApiKey}&file_type=json&limit=10&order_by=popularity&sort_order=desc`
        const searchResponse = await fetch(searchUrl)
        const searchData = await searchResponse.json()
        
        if (!searchResponse.ok) {
          console.error(`FRED search API error for ${market.name}:`, searchData)
          continue
        }
        
        if (!searchData.seriess || searchData.seriess.length === 0) {
          console.log(`No FRED series found for "${market.name}", skipping...`)
          continue
        }
        
        // Take the most popular/relevant series (first result when sorted by popularity)
        const selectedSeries = searchData.seriess[0]
        fredSeriesId = selectedSeries.id
        seriesTitle = selectedSeries.title
        
        console.log(`Found FRED series for "${market.name}":`)
        console.log(`  Series ID: ${fredSeriesId}`)
        console.log(`  Title: ${seriesTitle}`)
        console.log(`  Frequency: ${selectedSeries.frequency}`)
        
      } catch (searchError) {
        console.error(`Error searching FRED for "${market.name}":`, searchError)
        continue
      }

      if (!fredSeriesId) {
        console.log(`No FRED series ID found for "${market.name}", skipping...`)
        continue
      }

      try {
        // Fetch the most recent observation for this series
        const fredUrl = `https://api.stlouisfed.org/fred/series/observations?series_id=${fredSeriesId}&api_key=${fredApiKey}&file_type=json&limit=1&sort_order=desc&output_type=1`
        
        console.log(`Fetching latest data for series: ${fredSeriesId}`)
        
        const fredResponse = await fetch(fredUrl)
        const fredData = await fredResponse.json()

        if (!fredResponse.ok) {
          console.error(`FRED API error for ${market.name}:`, fredData)
          continue
        }

        if (!fredData.observations || fredData.observations.length === 0) {
          console.log(`No observations found for ${market.name}, skipping...`)
          continue
        }

        const latestObservation = fredData.observations[0]
        const latestValue = latestObservation.value

        if (latestValue === '.' || latestValue === null || latestValue === undefined) {
          console.log(`No valid value found for ${market.name} (value: ${latestValue}), skipping...`)
          continue
        }

        console.log(`Found latest value for "${market.name}": ${latestValue} (date: ${latestObservation.date})`)
        console.log(`Series: ${fredSeriesId} - ${seriesTitle}`)

        // Update market description and status
        const newDescription = `Will the next release of ${market.name} be above ${latestValue}?`
        
        const { error: updateError } = await supabaseClient
          .from('markets')
          .update({ 
            description: newDescription,
            status: 'open'
          })
          .eq('id', market.id)

        if (updateError) {
          console.error(`Error updating description for market ${market.id}:`, updateError)
          continue
        }

        console.log(`Updated description and status for market ${market.id}`)
        updatedMarkets.push({
          market_id: market.id,
          market_name: market.name,
          fred_series_id: fredSeriesId,
          fred_series_title: seriesTitle,
          previous_value: latestValue,
          observation_date: latestObservation.date,
          new_description: newDescription,
          status: 'open'
        })

      } catch (error) {
        console.error(`Error fetching FRED data for ${market.name}:`, error)
        continue
      }

      // Check if outcomes already exist for this market
      const { data: existingOutcomes, error: checkError } = await supabaseClient
        .from('outcomes')
        .select('id')
        .eq('market_id', market.id)

      if (checkError) {
        console.error(`Error checking existing outcomes for market ${market.id}:`, checkError)
        continue
      }

      if (existingOutcomes && existingOutcomes.length > 0) {
        console.log(`Outcomes already exist for market ${market.id}, skipping...`)
        continue
      }

      // Create "Yes" and "No" outcomes
      const outcomesToCreate = [
        {
          tokens: 10000,
          market_id: market.id,
          name: 'Yes',
          creator_id: creatorId
        },
        {
          tokens: 10000,
          market_id: market.id,
          name: 'No',
          creator_id: creatorId
        }
      ]

      const { data: newOutcomes, error: outcomeError } = await supabaseClient
        .from('outcomes')
        .insert(outcomesToCreate)
        .select()

      if (outcomeError) {
        console.error(`Error creating outcomes for market ${market.id}:`, outcomeError)
        continue
      }

      createdOutcomes.push({
        market_id: market.id,
        market_name: market.name,
        outcomes: newOutcomes
      })

      console.log(`Successfully created ${newOutcomes?.length || 0} outcomes for market ${market.id}`)
    }

    return new Response(
      JSON.stringify({
        message: `Successfully processed ${markets.length} markets`,
        date_checked: targetDate,
        markets_processed: markets.length,
        markets_updated: updatedMarkets.length,
        outcomes_created: createdOutcomes.length * 2,
        market_updates: updatedMarkets,
        outcome_details: createdOutcomes
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: 'An error occurred while creating market outcomes'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})