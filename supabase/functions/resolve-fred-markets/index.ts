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
    // Get required environment variables
    const fredApiKey = Deno.env.get('FRED_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!fredApiKey) {
      throw new Error('FRED_API_KEY environment variable is required')
    }
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required')
    }

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // Get parameters from request
    let dryRun = false
    let specificMarketId = null

    if (req.method === 'POST') {
      const body = await req.json()
      dryRun = body.dry_run || false
      specificMarketId = body.market_id || null
    } else {
      const url = new URL(req.url)
      dryRun = url.searchParams.get('dry_run') === 'true'
      specificMarketId = url.searchParams.get('market_id') || null
    }

    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]

    console.log(`Starting market resolution process (dry_run: ${dryRun})`)

    // Get markets that need resolution
    let marketsQuery = supabase
      .from('markets')
      .select(`
        id,
        name,
        target,
        close_date,
        link,
        status,
        outcomes!market_id (
          id,
          name
        )
      `)
      .eq('status', 'closed')
      .lte('close_date', todayStr)

    if (specificMarketId) {
      marketsQuery = marketsQuery.eq('id', specificMarketId)
    }

    const { data: markets, error: marketsError } = await marketsQuery

    if (marketsError) {
      throw new Error(`Failed to fetch markets: ${marketsError.message}`)
    }

    if (!markets || markets.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: specificMarketId 
            ? `No market found with ID ${specificMarketId} that needs resolution`
            : 'No markets found that need resolution',
          markets_processed: 0,
          timestamp: new Date().toISOString()
        }, null, 2),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    console.log(`Found ${markets.length} markets that may need resolution`)

    // Function to extract series ID from FRED link
    function extractSeriesId(link: string): string | null {
      if (!link) return null
      const match = link.match(/\/series\/([A-Z0-9]+)/i)
      return match ? match[1] : null
    }

    // Function to get series metadata and latest observation
    async function getSeriesDataAndLatestObservation(seriesId: string) {
      try {
        // First, get series metadata to check last_updated
        const seriesUrl = `https://api.stlouisfed.org/fred/series`
        const seriesParams = new URLSearchParams({
          api_key: fredApiKey,
          file_type: 'json',
          series_id: seriesId
        })

        console.log(`Fetching series metadata for ${seriesId}`)
        const seriesResponse = await fetch(`${seriesUrl}?${seriesParams}`)
        
        if (!seriesResponse.ok) {
          console.warn(`Failed to fetch series metadata for ${seriesId}: ${seriesResponse.status}`)
          return null
        }

        const seriesData = await seriesResponse.json()
        const series = seriesData.seriess?.[0]
        
        if (!series) {
          console.warn(`No series data found for ${seriesId}`)
          return null
        }

        // Get the latest observation
        const observationsUrl = `https://api.stlouisfed.org/fred/series/observations`
        const obsParams = new URLSearchParams({
          api_key: fredApiKey,
          file_type: 'json',
          series_id: seriesId,
          limit: '1',
          sort_order: 'desc',
          observation_start: '1900-01-01',
          observation_end: '9999-12-31'
        })

        console.log(`Fetching latest observation for ${seriesId}`)
        const obsResponse = await fetch(`${observationsUrl}?${obsParams}`)
        
        if (!obsResponse.ok) {
          console.warn(`Failed to fetch observations for ${seriesId}: ${obsResponse.status}`)
          return null
        }

        const obsData = await obsResponse.json()
        const observations = obsData.observations || []
        
        if (observations.length === 0) {
          console.warn(`No observations found for ${seriesId}`)
          return null
        }

        const latestObs = observations[0]
        
        return {
          series_id: seriesId,
          last_updated: series.last_updated,
          observation: {
            date: latestObs.date,
            value: parseFloat(latestObs.value),
            realtime_start: latestObs.realtime_start,
            realtime_end: latestObs.realtime_end
          }
        }
      } catch (error) {
        console.error(`Error fetching data for ${seriesId}:`, error)
        return null
      }
    }

    // Function to check if last_updated is greater than or equal to close date
    function isDataCurrentForCloseDate(lastUpdated: string, closeDate: string): boolean {
      const lastUpdatedDate = new Date(lastUpdated)
      const closeDateObj = new Date(closeDate)
      
      return lastUpdatedDate >= closeDateObj
    }

    // Function to resolve a market
    async function resolveMarket(marketId: string, outcomeId: string, marketName: string, actualValue: number, targetValue: number, isHigher: boolean) {
      if (dryRun) {
        console.log(`[DRY RUN] Would resolve market "${marketName}" (${marketId}) with outcome ${outcomeId}`)
        return { success: true, dry_run: true }
      }

      try {
        console.log(`Resolving market "${marketName}" (${marketId}) with outcome ${outcomeId} - Actual: ${actualValue}, Target: ${targetValue}, Higher: ${isHigher}`)
        
        const resolveResponse = await fetch('https://asxaibpmkcorlcpycgqc.supabase.co/functions/v1/resolve-market', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzeGFpYnBta2NvcmxjcHljZ3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzA5MjE1ODMsImV4cCI6MjA0NjQ5NzU4M30.0VuRkHRnR0sNYqhKBPWlwQRYBLA5dPw4D18mfAZYnA8',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            market_outcome_id: outcomeId
          })
        })

        if (resolveResponse.ok) {
          const result = await resolveResponse.json()
          console.log(`✅ Successfully resolved market "${marketName}" (${marketId})`)
          return { success: true, result }
        } else {
          const errorText = await resolveResponse.text()
          console.error(`❌ Failed to resolve market "${marketName}" (${marketId}): ${resolveResponse.status} ${errorText}`)
          return { success: false, error: `Resolution failed: ${resolveResponse.status} ${errorText}` }
        }
      } catch (error) {
        console.error(`Error resolving market "${marketName}" (${marketId}):`, error)
        return { success: false, error: error.message }
      }
    }

    // Process each market
    const processedMarkets = []
    const errors = []
    let resolvedCount = 0
    let skippedCount = 0

    for (const market of markets) {
      try {
        console.log(`Processing market: ${market.name} (${market.id})`)
        
        // Extract series ID from link
        const seriesId = extractSeriesId(market.link)
        if (!seriesId) {
          console.warn(`Could not extract series ID from link: ${market.link}`)
          errors.push({
            market_id: market.id,
            market_name: market.name,
            error: 'Could not extract series ID from market link'
          })
          skippedCount++
          continue
        }

        // Get series data and latest observation
        const seriesData = await getSeriesDataAndLatestObservation(seriesId)
        if (!seriesData) {
          console.warn(`No series data found for ${seriesId}`)
          errors.push({
            market_id: market.id,
            market_name: market.name,
            series_id: seriesId,
            error: 'No series data or observation found'
          })
          skippedCount++
          continue
        }

        // Check if data is current for the close date
        if (!isDataCurrentForCloseDate(seriesData.last_updated, market.close_date)) {
          console.warn(`Series last_updated ${seriesData.last_updated} is before close date ${market.close_date}`)
          errors.push({
            market_id: market.id,
            market_name: market.name,
            series_id: seriesId,
            last_updated: seriesData.last_updated,
            close_date: market.close_date,
            error: 'Series data was not updated on or after the close date'
          })
          skippedCount++
          continue
        }

        // Validate target value
        if (market.target === null || market.target === undefined) {
          console.warn(`Market ${market.id} has no target value`)
          errors.push({
            market_id: market.id,
            market_name: market.name,
            error: 'Market has no target value'
          })
          skippedCount++
          continue
        }

        // Determine if actual value is higher than target
        const actualValue = seriesData.observation.value
        const targetValue = market.target
        const isHigher = actualValue > targetValue

        // Find the correct outcome
        const outcomes = market.outcomes || []
        if (outcomes.length < 2) {
          console.warn(`Market ${market.id} doesn't have enough outcomes (expected at least 2)`)
          errors.push({
            market_id: market.id,
            market_name: market.name,
            error: 'Market does not have enough outcomes (expected Yes/No)'
          })
          skippedCount++
          continue
        }

        // Find Yes/No outcomes
        const yesOutcome = outcomes.find(o => o.name.toLowerCase() === 'yes')
        const noOutcome = outcomes.find(o => o.name.toLowerCase() === 'no')

        if (!yesOutcome || !noOutcome) {
          console.warn(`Market ${market.id} doesn't have Yes/No outcomes`)
          errors.push({
            market_id: market.id,
            market_name: market.name,
            available_outcomes: outcomes.map(o => o.name),
            error: 'Market does not have Yes/No outcomes'
          })
          skippedCount++
          continue
        }

        // Select the winning outcome
        const winningOutcome = isHigher ? yesOutcome : noOutcome

        // Resolve the market
        const resolutionResult = await resolveMarket(
          market.id,
          winningOutcome.id,
          market.name,
          actualValue,
          targetValue,
          isHigher
        )

        processedMarkets.push({
          market_id: market.id,
          market_name: market.name,
          series_id: seriesId,
          close_date: market.close_date,
          last_updated: seriesData.last_updated,
          observation_date: seriesData.observation.date,
          actual_value: actualValue,
          target_value: targetValue,
          is_higher: isHigher,
          winning_outcome: winningOutcome.name,
          winning_outcome_id: winningOutcome.id,
          resolution_result: resolutionResult,
          status: resolutionResult.success ? 'resolved' : 'failed'
        })

        if (resolutionResult.success) {
          resolvedCount++
        } else {
          errors.push({
            market_id: market.id,
            market_name: market.name,
            error: resolutionResult.error
          })
        }

      } catch (error) {
        console.error(`Error processing market ${market.id}:`, error)
        errors.push({
          market_id: market.id,
          market_name: market.name || 'Unknown',
          error: error.message
        })
        skippedCount++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        summary: {
          total_markets_checked: markets.length,
          markets_resolved: resolvedCount,
          markets_skipped: skippedCount,
          markets_failed: errors.length - skippedCount,
          processing_errors: errors.length
        },
        processed_markets: processedMarkets,
        processing_errors: errors,
        metadata: {
          timestamp: new Date().toISOString(),
          function_version: "1.1",
          target_date: todayStr,
          specific_market_id: specificMarketId
        }
      }, null, 2),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Function error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }, null, 2),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})