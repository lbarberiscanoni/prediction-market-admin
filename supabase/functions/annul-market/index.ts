import { serve } from "https://deno.land/std@0.170.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

// Retrieve environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  Deno.exit(1);
}

console.log("Service Role Key is present.");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
  try {
    // Parse the JSON body from the incoming request
    const { market_id, dry_run = false } = await req.json();
    if (!market_id) {
      return new Response(
        JSON.stringify({ error: "market_id is required" }),
        { status: 400 }
      );
    }
    console.log("Received market_id:", market_id);
    console.log("Dry run mode:", dry_run ? "ENABLED" : "DISABLED");

    // 1. Fetch the market record to verify it exists and get current status
    const { data: market, error: marketError } = await supabase
      .from("markets")
      .select("*")
      .eq("id", market_id)
      .single();
    if (marketError || !market) {
      console.error("Error fetching market:", marketError?.message || "Market not found");
      return new Response(
        JSON.stringify({ error: marketError?.message || "Market not found" }),
        { status: 404 }
      );
    }
    console.log("Fetched market:", market);

    // Check if market is already annulled
    if (market.status === 'annulled') {
      return new Response(
        JSON.stringify({ error: "Market is already annulled" }),
        { status: 400 }
      );
    }

    // 2. Retrieve all predictions for the market from the "predictions" table
    const { data: predictions, error: predictionsError } = await supabase
      .from("predictions")
      .select("*")
      .eq("market_id", market_id);
    if (predictionsError) {
      console.error("Error fetching predictions:", predictionsError.message);
      return new Response(
        JSON.stringify({ error: predictionsError.message }),
        { status: 500 }
      );
    }
    console.log(`Fetched ${predictions.length} predictions for market ${market_id}`);
    
    // 3. Calculate net shares per user across ALL outcomes and track all P&L
    const userShares = {};
    const userProfitLoss = {};
    
    for (const prediction of predictions) {
      const userId = prediction.user_id;
      
      // Initialize records if first time seeing this user
      if (!userShares[userId]) {
        userShares[userId] = 0;
      }
      if (!userProfitLoss[userId]) {
        userProfitLoss[userId] = 0;
      }
      
      // Track net share position across ALL outcomes (for annulment, all shares are treated equally)
      if (prediction.trade_type === 'buy') {
        userShares[userId] += Number(prediction.shares_amt || 0);
      } else if (prediction.trade_type === 'sell') {
        userShares[userId] -= Number(prediction.shares_amt || 0);
      }
      
      // Track P&L from all trading activity
      userProfitLoss[userId] += Number(prediction.trade_value || 0);
    }
    
    console.log("User net shares across all outcomes:", userShares);
    console.log("User P&L from trading activity:", userProfitLoss);

    // 4. Calculate potential payouts and prepare records
    const payoutSimulation = [];
    let totalPayoutsSimulated = 0;
    let totalPayoutAmountSimulated = 0;
    
    for (const [userId, shares] of Object.entries(userShares)) {
      // Convert shares to a number to ensure proper comparison
      const numShares = Number(shares);
      
      // Only pay users with positive share balances
      if (numShares <= 0) {
        console.log(`User ${userId} has zero or negative shares (${numShares}), no payout`);
        continue;
      }
      
      // Calculate payout amount ($0.50 per share for annulled markets)
      const payoutAmount = numShares * 0.5;
      
      // Get trading P&L and ensure it's a number
      const tradingPL = Number(userProfitLoss[userId] || 0);
      
      // Calculate total profit
      const totalProfit = tradingPL + payoutAmount;
      
      // Create a simulation record
      const simulatedPayout = {
        user_id: userId,
        market_id: market_id,
        outcome_id: null, // No specific outcome for annulled markets
        payout_amount: payoutAmount,
        payout_type: 'annulment'
      };
      
      payoutSimulation.push(simulatedPayout);
      totalPayoutsSimulated++;
      totalPayoutAmountSimulated += payoutAmount;
      
      console.log(`[SIMULATION] User ${userId} would receive $${payoutAmount.toFixed(2)} for ${numShares.toFixed(2)} shares (annulment rate: $0.50/share)`);
      console.log(`[SIMULATION] User ${userId} total P&L: $${totalProfit.toFixed(2)} (Trading: $${tradingPL.toFixed(2)}, Payout: $${payoutAmount.toFixed(2)})`);
      
      // In dry run mode, fetch the current balance to display what it would be after payout
      if (dry_run) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("balance")
          .eq("user_id", userId)
          .single();
          
        if (!profileError && profile) {
          const currentBalance = Number(profile.balance || 0);
          const newBalance = currentBalance + payoutAmount;
          console.log(`[SIMULATION] User ${userId} balance would change from $${currentBalance.toFixed(2)} to $${newBalance.toFixed(2)}`);
        }
      }
    }
    
    // In dry run mode, don't actually process any payouts or update the database
    if (dry_run) {
      console.log("[SIMULATION] Dry run complete, no actual payouts processed or status changes made");
      return new Response(
        JSON.stringify({
          simulation: true,
          market_id: market_id,
          market_name: market.name,
          current_status: market.status,
          action: "annulment",
          payout_rate: 0.5,
          totalPayoutsSimulated,
          totalPayoutAmountSimulated,
          payouts: payoutSimulation
        }),
        { status: 200 }
      );
    }
    
    // If not a dry run, proceed with actual annulment processing...
    console.log("Proceeding with actual annulment processing...");
    
    // First, update the market status to "annulled"
    const { error: updateMarketError } = await supabase
      .from("markets")
      .update({ status: "annulled" })
      .eq("id", market_id);
      
    if (updateMarketError) {
      console.error("Error updating market status:", updateMarketError);
      return new Response(
        JSON.stringify({ error: "Failed to update market status: " + updateMarketError.message }),
        { status: 500 }
      );
    }
    
    console.log(`Market ${market_id} status updated to "annulled"`);
    
    // Process the actual payouts
    let totalPayoutsProcessed = 0;
    const processedPayouts = [];
    
    for (const payout of payoutSimulation) {
      const userId = payout.user_id;
      const payoutAmount = payout.payout_amount;
      
      // Call the RPC function to increment user balance
      const { data, error } = await supabase.rpc("increment_balance", {
        user_id_input: userId,
        amount: payoutAmount,
      });
      
      if (error) {
        console.error("Error updating balance for user", userId, error);
        continue;
      }
      
      // Insert the payout record into your payouts table
      const { error: insertError } = await supabase
        .from("payouts")
        .insert([payout]);
        
      if (insertError) {
        console.error("Error inserting payout record for user", userId, insertError);
        continue;
      }
      
      processedPayouts.push(payout);
      totalPayoutsProcessed++;
      
      console.log(`Processed annulment payout for user ${userId}: $${payoutAmount.toFixed(2)}`);
    }
    
    console.log("Annulment process complete. Total payouts processed:", totalPayoutsProcessed);
    return new Response(
      JSON.stringify({
        success: true,
        market_id: market_id,
        market_name: market.name,
        action: "annulment",
        status_updated: "annulled",
        payout_rate: 0.5,
        totalPayoutsProcessed,
        totalPayoutAmount: processedPayouts.reduce((sum, record) => sum + record.payout_amount, 0)
      }),
      { status: 200 }
    );
    
  } catch (error: any) {
    console.error("Error in annulment function execution:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});