import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decideFredResolution, type FredSource } from '../_shared/fred-resolution/decide.ts'

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
      .lte('close_date', todayStr)

    if (specificMarketId) {
      marketsQuery = marketsQuery.eq('id', specificMarketId)
    }
    // A dry run on one specific market may target any status, so the decision
    // can be replayed against already-settled historical markets (writes nothing).
    if (!(dryRun && specificMarketId)) {
      marketsQuery = marketsQuery.eq('status', 'closed')
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

    async function fredGet(path: string, params: Record<string, string>) {
      const qs = new URLSearchParams({ api_key: fredApiKey!, file_type: 'json', ...params })
      const res = await fetch(`https://api.stlouisfed.org/fred/${path}?${qs}`)
      if (!res.ok) throw new Error(`FRED ${path} ${params.series_id}: ${res.status} ${await res.text()}`)
      return await res.json()
    }

    // ALFRED real-time access: publication dates + values as they stood on a date
    const fred: FredSource = {
      async vintageDates(seriesId, start, end) {
        // No realtime range: FRED answers a range with no vintages in it with a
        // 500, not an empty list. Pull the most recent vintages and filter here.
        const data = await fredGet('series/vintagedates', {
          series_id: seriesId, sort_order: 'desc', limit: '1000',
        })
        return (data.vintage_dates || []).filter((d: string) => d >= start && d <= end).sort()
      },
      async latestAsOf(seriesId, asOf) {
        const data = await fredGet('series/observations', {
          series_id: seriesId, realtime_start: asOf, realtime_end: asOf,
          sort_order: 'desc', limit: '10',
        })
        const obs = (data.observations || []).find((o: { value: string }) => Number.isFinite(parseFloat(o.value)))
        return obs ? { date: obs.date, value: parseFloat(obs.value) } : null
      },
    }

    async function callMarketFunction(fn: 'resolve-market' | 'annul-market', body: Record<string, unknown>) {
      if (dryRun) return { success: true, dry_run: true }
      try {
        const res = await fetch(`https://asxaibpmkcorlcpycgqc.supabase.co/functions/v1/${fn}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        })
        if (res.ok) return { success: true, result: await res.json() }
        return { success: false, error: `${fn} failed: ${res.status} ${await res.text()}` }
      } catch (error) {
        return { success: false, error: `${fn} failed: ${(error as Error).message}` }
      }
    }

    // Process each market
    const processedMarkets = []
    const errors = []
    let resolvedCount = 0
    let annulledCount = 0
    let waitingCount = 0
    let skippedCount = 0

    for (const market of markets) {
      try {
        console.log(`Processing market: ${market.name} (${market.id})`)

        const seriesId = extractSeriesId(market.link)
        if (!seriesId) {
          errors.push({ market_id: market.id, market_name: market.name, error: 'Could not extract series ID from market link' })
          skippedCount++
          continue
        }
        if (market.target === null || market.target === undefined) {
          errors.push({ market_id: market.id, market_name: market.name, error: 'Market has no target value' })
          skippedCount++
          continue
        }

        const decision = await decideFredResolution(fred, {
          seriesId, closeDate: market.close_date, target: market.target, today: todayStr,
        })
        console.log(`Market ${market.id} (${seriesId}, close ${market.close_date}): ${JSON.stringify(decision)}`)

        const report = {
          market_id: market.id,
          market_name: market.name,
          market_status: market.status,
          series_id: seriesId,
          close_date: market.close_date,
          target_value: market.target,
          decision,
        }

        if (decision.action === 'wait') {
          waitingCount++
          processedMarkets.push({ ...report, status: 'waiting' })
          continue
        }

        let result
        if (decision.action === 'annul') {
          result = await callMarketFunction('annul-market', { market_id: market.id })
          if (result.success) annulledCount++
        } else {
          const outcome = (market.outcomes || []).find(o => o.name.toLowerCase() === decision.winner.toLowerCase())
          if (!outcome) {
            errors.push({ market_id: market.id, market_name: market.name, available_outcomes: (market.outcomes || []).map(o => o.name), error: 'Market does not have Yes/No outcomes' })
            skippedCount++
            continue
          }
          result = await callMarketFunction('resolve-market', { market_outcome_id: outcome.id })
          if (result.success) resolvedCount++
        }

        processedMarkets.push({ ...report, result, status: result.success ? (decision.action === 'annul' ? 'annulled' : 'resolved') : 'failed' })
        if (!result.success) {
          errors.push({ market_id: market.id, market_name: market.name, error: result.error })
        }
      } catch (error) {
        console.error(`Error processing market ${market.id}:`, error)
        errors.push({ market_id: market.id, market_name: market.name || 'Unknown', error: (error as Error).message })
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
          markets_annulled: annulledCount,
          markets_waiting: waitingCount,
          markets_skipped: skippedCount,
          markets_failed: errors.length - skippedCount,
          processing_errors: errors.length
        },
        processed_markets: processedMarkets,
        processing_errors: errors,
        metadata: {
          timestamp: new Date().toISOString(),
          function_version: "2.0",
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
        error: (error as Error).message,
        timestamp: new Date().toISOString()
      }, null, 2),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})