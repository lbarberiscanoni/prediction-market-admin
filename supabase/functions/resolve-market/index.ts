import { serve } from "https://deno.land/std@0.170.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { computeResolutionPayouts } from "../_shared/market-lifecycle/payouts.ts";

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
    const { market_outcome_id, dry_run = false } = await req.json();
    if (!market_outcome_id) {
      return new Response(
        JSON.stringify({ error: "market_outcome_id is required" }),
        { status: 400 }
      );
    }
    console.log("Received market_outcome_id:", market_outcome_id);
    console.log("Dry run mode:", dry_run ? "ENABLED" : "DISABLED");

    // 1. Fetch the outcome record from the "outcomes" table
    const { data: outcome, error: outcomeError } = await supabase
      .from("outcomes")
      .select("*")
      .eq("id", market_outcome_id)
      .single();
    if (outcomeError || !outcome) {
      console.error("Error fetching outcome:", outcomeError?.message || "Outcome not found");
      return new Response(
        JSON.stringify({ error: outcomeError?.message || "Outcome not found" }),
        { status: 404 }
      );
    }
    console.log("Fetched outcome:", outcome);

    // Retrieve the market ID from the outcome record
    const marketId = outcome.market_id;
    console.log("Market ID:", marketId);

    // 2. Retrieve all predictions for the market from the "predictions" table
    const { data: predictions, error: predictionsError } = await supabase
      .from("predictions")
      .select("*")
      .eq("market_id", marketId);
    if (predictionsError) {
      console.error("Error fetching predictions:", predictionsError.message);
      return new Response(
        JSON.stringify({ error: predictionsError.message }),
        { status: 500 }
      );
    }
    console.log(`Fetched ${predictions.length} predictions for market ${marketId}`);
    
    // 3. Compute payouts with the shared, unit-tested lifecycle module
    //    (net shares on the winning outcome, paid at $1.00/share).
    const {
      payouts: payoutSimulation,
      totalCount: totalPayoutsSimulated,
      totalAmount: totalPayoutAmountSimulated,
    } = computeResolutionPayouts(predictions, market_outcome_id, marketId);

    console.log(
      `[SIMULATION] ${totalPayoutsSimulated} payout(s) totaling $${totalPayoutAmountSimulated.toFixed(2)}`,
    );

    // Get market info for reporting
    const { data: market, error: marketError } = await supabase
      .from("markets")
      .select("name, status")
      .eq("id", marketId)
      .single();
    
    const marketName = marketError ? `Market #${marketId}` : market.name;
    const currentStatus = marketError ? "unknown" : market.status;
    
    // In dry run mode, don't actually process any payouts or update the database
    if (dry_run) {
      console.log("[SIMULATION] Dry run complete, no actual payouts processed");
      console.log(`[SIMULATION] Would update market ${marketId} status from '${currentStatus}' to 'resolved'`);
      console.log(`[SIMULATION] Would set outcome_id to ${market_outcome_id}`);
      
      return new Response(
        JSON.stringify({
          simulation: true,
          market_id: marketId,
          market_name: marketName,
          current_status: currentStatus,
          would_update_to_status: 'resolved',
          winning_outcome_id: market_outcome_id,
          totalPayoutsSimulated,
          totalPayoutAmountSimulated,
          payouts: payoutSimulation
        }),
        { status: 200 }
      );
    }
    
    // If not a dry run, proceed with actual payment processing...
    console.log("Proceeding with actual payment processing...");
    
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
      
      console.log(`Processed payout for user ${userId}: $${payoutAmount.toFixed(2)}`);
    }
    
    // 5. Update market status to 'resolved' and set the winning outcome
    // FIXED: Changed 'winning_outcome_id' to 'outcome_id'
    console.log("Updating market status to resolved...");
    const resolvedAt = new Date().toISOString();
    const { error: marketUpdateError } = await supabase
      .from("markets")
      .update({ 
        status: 'resolved',
        outcome_id: market_outcome_id,
        resolved_at: resolvedAt
      })
      .eq("id", marketId);
    
    if (marketUpdateError) {
      console.error("Error updating market status:", marketUpdateError.message);
      return new Response(
        JSON.stringify({ 
          error: "Payouts processed but failed to update market status: " + marketUpdateError.message,
          payouts_processed: totalPayoutsProcessed,
          market_id: marketId,
          winning_outcome_id: market_outcome_id
        }),
        { status: 500 }
      );
    }
    
    console.log(`Market ${marketId} successfully resolved with winning outcome ${market_outcome_id}`);
    
    console.log("Payout process complete. Total payouts processed:", totalPayoutsProcessed);
    return new Response(
      JSON.stringify({
        success: true,
        market_id: marketId,
        market_name: marketName,
        winning_outcome_id: market_outcome_id,
        market_status: 'resolved',
        resolved_at: resolvedAt,
        totalPayoutsProcessed,
        totalPayoutAmount: processedPayouts.reduce((sum, record) => sum + record.payout_amount, 0)
      }),
      { status: 200 }
    );
    
  } catch (error: any) {
    console.error("Error in function execution:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});