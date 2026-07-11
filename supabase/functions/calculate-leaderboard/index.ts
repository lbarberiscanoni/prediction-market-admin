// supabase/functions/calculate-leaderboard/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface LeaderboardEntry {
  user_id: string;
  username?: string;
  payment_id?: string | null;
  total_profit_loss: number;
  percent_pnl: number;
  total_bought_amount: number;
  remaining_shares_value: number;
  net_trade_pnl: number;
  position: number;
}

interface Profile {
  user_id: string;
  username?: string;
  payment_id?: string | null;
}

interface Prediction {
  user_id: string;
  market_id: number;
  outcome_id: number;
  shares_amt: number;
  trade_value: number;
  trade_type: 'buy' | 'sell';
  created_at: string;
}

interface Market {
  id: number;
  status: string;
  close_date?: string | null;
  outcome_id?: number | null;
}

interface Outcome {
  id: number;
  name: string;
  tokens: number;
  market_id: number;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    console.log('Starting leaderboard calculation...')

    // 1. Get all users with their profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id, username, payment_id")

    if (profilesError) {
      throw new Error(`Failed to fetch user profiles: ${profilesError.message}`)
    }

    if (!profiles) {
      throw new Error("No user profiles found")
    }

    // Filter out any users with null or undefined user_id
    const validProfiles = profiles.filter(profile => profile && profile.user_id) as Profile[]
    
    console.log(`Found ${validProfiles.length} valid profiles out of ${profiles.length} total`)

    // 2. Get markets that meet our criteria:
    // - Markets with status "open"
    // - Markets with status "closed" and close_date within the last 14 days
    // - Markets with status "resolved" and close_date within the last 14 days
    // - Markets with status "annulled" and close_date within the last 14 days
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

    const { data: allMarkets, error: marketsError } = await supabase
      .from("markets")
      .select("id, status, close_date, outcome_id")
      .gt("id", 40)

    if (marketsError) {
      throw new Error(`Failed to fetch markets: ${marketsError.message}`)
    }

    if (!allMarkets) {
      throw new Error("No markets found")
    }

    // Filter markets based on status and close_date
    const eligibleMarkets = allMarkets.filter(market => {
      if (market.status === 'open') {
        return true
      }
      
      if ((market.status === 'closed' || market.status === 'resolved' || market.status === 'annulled') && market.close_date) {
        const closeDate = new Date(market.close_date)
        return closeDate >= fourteenDaysAgo
      }
      
      return false
    }) as Market[]

    const eligibleMarketIds = eligibleMarkets.map(market => market.id)
    
    console.log(`Found ${eligibleMarkets.length} eligible markets out of ${allMarkets.length} total`)
    console.log(`Open markets: ${eligibleMarkets.filter(m => m.status === 'open').length}`)
    console.log(`Closed markets: ${eligibleMarkets.filter(m => m.status === 'closed').length}`)
    console.log(`Resolved markets: ${eligibleMarkets.filter(m => m.status === 'resolved').length}`)
    console.log(`Annulled markets: ${eligibleMarkets.filter(m => m.status === 'annulled').length}`)

    if (eligibleMarketIds.length === 0) {
      console.log('No eligible markets found')
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No eligible markets found for leaderboard calculation',
          total_users: 0
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    // 3. Get all predictions for eligible markets from the past 32 days
    const thirtyTwoDaysAgo = new Date()
    thirtyTwoDaysAgo.setDate(thirtyTwoDaysAgo.getDate() - 32)

    const { data: allPredictions, error: predictionsError } = await supabase
      .from("predictions")
      .select("user_id, market_id, outcome_id, shares_amt, trade_value, trade_type, created_at")
      .in("market_id", eligibleMarketIds)
      .gte("created_at", thirtyTwoDaysAgo.toISOString())

    if (predictionsError) {
      console.warn("Error fetching predictions:", predictionsError)
    }

    console.log(`Fetching predictions from ${thirtyTwoDaysAgo.toISOString()} onwards for eligible markets`)
    console.log(`Found ${allPredictions?.length || 0} predictions for eligible markets`)

    // 4. Get all outcomes for eligible markets to calculate current market odds
    const { data: allOutcomes, error: outcomesError } = await supabase
      .from("outcomes")
      .select("id, name, tokens, market_id")
      .in("market_id", eligibleMarketIds)

    if (outcomesError) {
      console.warn("Error fetching outcomes:", outcomesError)
    }

    console.log(`Found ${allPredictions?.length || 0} predictions and ${allOutcomes?.length || 0} outcomes`)
    console.log(`Calculation period: ${thirtyTwoDaysAgo.toDateString()} to ${new Date().toDateString()}`)

    // 5. Process data for each user
    const leaderboardResults: LeaderboardEntry[] = []

    for (const profile of validProfiles) {
      try {
        const userId = profile.user_id
        
        // Get user's predictions for eligible markets
        const userPredictions = (allPredictions || []).filter(p => p.user_id === userId) as Prediction[]
        
        if (userPredictions.length === 0) {
          // Skip users with no predictions in eligible markets
          continue
        }

        // Calculate total amounts bought (sum of absolute trade values for buy transactions)
        // NOTE: This only includes trades from the past 32 days in eligible markets
        let totalBoughtAmount = 0
        let netTradePnL = 0
        
        // Track shares by outcome (net position from recent trades only)
        const sharesByOutcome: { [outcomeId: number]: number } = {}

        // Process each prediction
        userPredictions.forEach(prediction => {
          const tradeValue = Number(prediction.trade_value || 0)
          const sharesAmt = Number(prediction.shares_amt || 0)
          const outcomeId = prediction.outcome_id

          // Add to net trade P&L (sum of all trade values)
          netTradePnL += tradeValue

          if (prediction.trade_type === 'buy') {
            // For buys, add the absolute trade value to total bought amount
            totalBoughtAmount += Math.abs(tradeValue)
            
            // Add shares to position
            sharesByOutcome[outcomeId] = (sharesByOutcome[outcomeId] || 0) + sharesAmt
          } else if (prediction.trade_type === 'sell') {
            // For sells, subtract shares from position
            sharesByOutcome[outcomeId] = (sharesByOutcome[outcomeId] || 0) - sharesAmt
          }
        })

        // Calculate current value of remaining shares
        let remainingSharesValue = 0

        Object.entries(sharesByOutcome).forEach(([outcomeIdStr, shares]) => {
          if (shares > 0) { // Only count positive positions
            const outcomeId = parseInt(outcomeIdStr)
            
            // Find the outcome and its market
            const outcome = (allOutcomes || []).find(o => o.id === outcomeId) as Outcome | undefined
            if (!outcome) return

            // Check the market status to determine valuation method
            const market = eligibleMarkets.find(m => m.id === outcome.market_id)
            
            if (market?.status === 'annulled') {
              // Market is annulled - each share is worth $0.50 regardless of outcome
              const shareValue = shares * 0.5
              remainingSharesValue += shareValue
              console.log(`User ${userId}: ${shares} shares of outcome ${outcomeId} (${outcome.name}) in ANNULLED market worth ${shareValue.toFixed(3)} at $0.50 per share`)
              
            } else if (market?.status === 'resolved') {
              // Market is resolved - use binary payout (1.00 for winning outcome, 0.00 for losing)
              if (market.outcome_id && outcomeId === market.outcome_id) {
                // This is the winning outcome - each share is worth $1.00
                const shareValue = shares * 1.00
                remainingSharesValue += shareValue
                console.log(`User ${userId}: ${shares} shares of WINNING outcome ${outcomeId} (${outcome.name}) worth ${shareValue.toFixed(3)} at resolution`)
              } else {
                // This is a losing outcome - shares are worth $0.00
                console.log(`User ${userId}: ${shares} shares of LOSING outcome ${outcomeId} (${outcome.name}) worth $0.00 at resolution`)
                // No value added to remainingSharesValue
              }
              
            } else if (market?.status === 'closed') {
              // Market is closed but not yet resolved - use final token distribution
              const marketOutcomes = (allOutcomes || []).filter(o => o.market_id === outcome.market_id) as Outcome[]
              const totalMarketTokens = marketOutcomes.reduce((sum, o) => sum + Number(o.tokens), 0)
              
              if (totalMarketTokens > 0) {
                const finalOdds = Number(outcome.tokens) / totalMarketTokens
                const shareValue = shares * finalOdds
                remainingSharesValue += shareValue
                
                console.log(`User ${userId}: ${shares} shares of outcome ${outcomeId} (${outcome.name}) in CLOSED (unresolved) market worth ${shareValue.toFixed(3)} at final ${(finalOdds * 100).toFixed(1)}% odds`)
              }
              
            } else {
              // For open markets, use current odds
              const marketOutcomes = (allOutcomes || []).filter(o => o.market_id === outcome.market_id) as Outcome[]
              const totalMarketTokens = marketOutcomes.reduce((sum, o) => sum + Number(o.tokens), 0)
              
              if (totalMarketTokens > 0) {
                const currentOdds = Number(outcome.tokens) / totalMarketTokens
                const shareValue = shares * currentOdds
                remainingSharesValue += shareValue
                
                console.log(`User ${userId}: ${shares} shares of outcome ${outcomeId} (${outcome.name}) in OPEN market worth ${shareValue.toFixed(3)} at ${(currentOdds * 100).toFixed(1)}% odds`)
              }
            }
          }
        })

        // Calculate total profit/loss = net trade P&L + current value of remaining shares
        const totalProfitLoss = netTradePnL + remainingSharesValue
        
        // Calculate percentage P&L based on total amount bought
        // Avoid division by zero
        const percentPnL = totalBoughtAmount > 0 ? (totalProfitLoss / totalBoughtAmount) * 100 : 0

        leaderboardResults.push({
          user_id: userId,
          username: profile.username,
          payment_id: profile.payment_id,
          total_profit_loss: totalProfitLoss,
          percent_pnl: percentPnL,
          total_bought_amount: totalBoughtAmount,
          remaining_shares_value: remainingSharesValue,
          net_trade_pnl: netTradePnL,
          position: 0 // Will be set after sorting
        })

        console.log(`User ${userId}: Bought ${totalBoughtAmount.toFixed(2)} (eligible markets), Net Trade P&L: ${netTradePnL.toFixed(2)}, Remaining Shares Value: ${remainingSharesValue.toFixed(2)}, Total P&L: ${totalProfitLoss.toFixed(2)}, Percent: ${percentPnL.toFixed(2)}%`)

      } catch (userError) {
        console.warn(`Skipping user ${profile.user_id} due to error:`, userError)
      }
    }

    // Filter users with activity (total bought amount > 0)
    const activeUsers = leaderboardResults.filter(
      entry => entry.total_bought_amount > 0
    )

    // Sort by total profit/loss (descending)
    const sortedData = activeUsers.sort((a, b) => b.total_profit_loss - a.total_profit_loss)

    // Add position numbers
    sortedData.forEach((entry, index) => {
      entry.position = index + 1
    })

    console.log(`Calculated leaderboard for ${sortedData.length} active users across ${eligibleMarkets.length} eligible markets`)

    // 6. Store the leaderboard in the database
    const leaderboardRecord = {
      calculation_date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
      data: sortedData,
      total_users: sortedData.length
    }

    // Insert the new leaderboard record
    const { error: insertError } = await supabase
      .from('leaderboards')
      .insert(leaderboardRecord)

    if (insertError) {
      throw new Error(`Failed to insert leaderboard: ${insertError.message}`)
    }

    // Optional: Clean up old leaderboard entries (keep only last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { error: cleanupError } = await supabase
      .from('leaderboards')
      .delete()
      .lt('created_at', thirtyDaysAgo.toISOString())

    if (cleanupError) {
      console.warn('Failed to cleanup old leaderboard entries:', cleanupError.message)
    }

    console.log('Leaderboard calculation completed successfully')

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Leaderboard calculated and stored successfully',
        total_users: sortedData.length,
        eligible_markets: eligibleMarkets.length,
        open_markets: eligibleMarkets.filter(m => m.status === 'open').length,
        closed_markets: eligibleMarkets.filter(m => m.status === 'closed').length,
        resolved_markets: eligibleMarkets.filter(m => m.status === 'resolved').length,
        annulled_markets: eligibleMarkets.filter(m => m.status === 'annulled').length,
        calculation_date: leaderboardRecord.calculation_date,
        top_5: sortedData.slice(0, 5).map(user => ({
          position: user.position,
          username: user.username || user.user_id,
          total_profit_loss: user.total_profit_loss,
          percent_pnl: user.percent_pnl
        }))
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in leaderboard calculation:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
      },
    )
  }
})