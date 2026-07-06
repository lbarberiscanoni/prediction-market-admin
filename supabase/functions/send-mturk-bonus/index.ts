// supabase/functions/send-mturk-bonus/index.ts

// Import map to control dependency resolution
// Put this at the top of your file
/// <reference types="https://esm.sh/v135/node_http@0.131.0/index.d.ts" />

import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';
import { 
  MTurkClient, 
  SendBonusCommand 
} from 'https://esm.sh/v135/@aws-sdk/client-mturk@3.414.0?target=deno';

interface BonusRequest {
  workerId: string;
  assignmentId: string;
  amount: number;
  reason: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    // Parse and validate the incoming JSON
    const { workerId, assignmentId, amount, reason } = await req.json() as BonusRequest;
    
    // Validate required fields
    if (!workerId || !assignmentId || typeof amount !== 'number' || amount <= 0 || !reason) {
      return new Response(
        JSON.stringify({ error: 'Invalid workerId, assignmentId, amount, or reason' }),
        { 
          status: 400, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }

    // Load AWS credentials from Supabase function secrets
    const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
    const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
    
    if (!accessKeyId || !secretAccessKey) {
      return new Response(
        JSON.stringify({ error: 'AWS credentials missing (set via Supabase secrets)' }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }

    // Initialize MTurk client with direct credentials, avoiding the credential provider chain
    const client = new MTurkClient({
      region: 'us-east-1',
      endpoint: 'https://mturk-requester-sandbox.us-east-1.amazonaws.com',
      // Provide credentials directly as an object, not via a provider
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      // Add extra parameters to disable credential loading from file system
      customUserAgent: 'supabase-edge-function',
      maxAttempts: 1,
    });

    // Send the bonus command
    const command = new SendBonusCommand({
      WorkerId: workerId,
      AssignmentId: assignmentId,
      BonusAmount: amount.toFixed(2), // e.g. "1.00"
      Reason: reason,
      // Add a unique token to prevent accidental duplicate submissions
      UniqueRequestToken: `bonus-${workerId}-${Date.now()}`,
    });

    const result = await client.send(command);
    const transactionId = result.$metadata.requestId;

    console.log(`Successfully sent bonus of $${amount.toFixed(2)} to worker ${workerId}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        transactionId,
        message: `Successfully sent bonus of $${amount.toFixed(2)} to worker ${workerId}`
      }),
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        } 
      }
    );
  } catch (err) {
    console.error('Error sending bonus:', err);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: err.message ?? 'Unknown error',
      }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        } 
      }
    );
  }
});

/*
To deploy this function to Supabase:

1. Create a new function in Supabase:
   supabase functions new send-mturk-bonus

2. Copy this code to supabase/functions/send-mturk-bonus/index.ts

3. Set up your AWS credentials as secrets:
   supabase secrets set AWS_ACCESS_KEY_ID=your_access_key_id AWS_SECRET_ACCESS_KEY=your_secret_access_key

4. Deploy the function:
   supabase functions deploy send-mturk-bonus --no-verify-jwt

5. Call the function with:
   curl -X POST https://your-project-ref.supabase.co/functions/v1/send-mturk-bonus \
     -H "Content-Type: application/json" \
     -d '{"workerId": "A1B2C3D4E5", "assignmentId": "123456789", "amount": 1.50, "reason": "Great work!"}'
*/