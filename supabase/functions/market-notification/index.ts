// supabase/functions/market-notification/index.ts
// Simplified version for announcing new markets
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rate limiting helper function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Send emails with rate limiting (2 per second = 500ms delay between emails)
async function sendEmailsWithRateLimit(profiles: any[], emailData: any, RESEND_API_KEY: string) {
  const results = []
  const DELAY_BETWEEN_EMAILS = 750 // 750ms = ~1.3 emails per second to be safe
  
  console.log(`📬 Sending ${profiles.length} emails with rate limiting...`)
  
  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i]
    const emailToSend = {
      ...emailData,
      to: [profile.email],
      html: emailData.html.replace(/\$\{profile\.username\}/g, profile.username || 'there')
    }
    
    console.log(`📧 Sending email ${i + 1}/${profiles.length} to: ${profile.email}`)
    
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailToSend),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`❌ Failed to send email to ${profile.email}:`, errorText)
        results.push({ success: false, email: profile.email, error: errorText })
      } else {
        const result = await response.json()
        console.log(`✅ Email sent to ${profile.email}, ID: ${result.id}`)
        results.push({ success: true, email: profile.email, id: result.id })
      }
    } catch (error) {
      console.error(`❌ Error sending email to ${profile.email}:`, error)
      results.push({ success: false, email: profile.email, error: error.message })
    }
    
    // Add delay between emails (except for the last one)
    if (i < profiles.length - 1) {
      console.log(`⏳ Waiting ${DELAY_BETWEEN_EMAILS}ms before next email...`)
      await delay(DELAY_BETWEEN_EMAILS)
    }
  }
  
  return results
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Allow GET requests for testing
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({ 
        message: 'Market notification function is running',
        timestamp: new Date().toISOString(),
        status: 'healthy'
      }), 
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  }

  try {
    console.log('🚀 Market notification function triggered!')
    console.log('📝 Method:', req.method)
    
    // Parse the request payload
    const requestBody = await req.json()
    console.log('📦 Request payload received:', JSON.stringify(requestBody, null, 2))

    // Extract market information from the FRED function payload
    const marketsCreated = requestBody.markets_created || 0
    const targetDate = requestBody.target_date
    const createdMarkets = requestBody.created_markets || []

    // Validate payload
    if (!marketsCreated || marketsCreated === 0) {
      console.log('ℹ️ No markets were created, nothing to notify about')
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'No markets were created, no notifications sent',
          markets_created: 0
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    console.log(`🎯 Notification for ${marketsCreated} new markets created for ${targetDate}`)

    // Get environment variables
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!RESEND_API_KEY) {
      console.error('❌ RESEND_API_KEY not configured')
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      )
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('❌ Supabase configuration missing')
      console.log('🔍 SUPABASE_URL present:', !!SUPABASE_URL)
      console.log('🔍 SERVICE_ROLE_KEY present:', !!SUPABASE_SERVICE_ROLE_KEY)
      return new Response(
        JSON.stringify({ error: 'Database configuration missing' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      )
    }

    // Create Supabase client with service role key to bypass RLS
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    console.log('🔍 Querying profiles table for notification preferences...')

    // Get users who have email notifications enabled
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, username, email, enable_email_notifications')
      .eq('enable_email_notifications', true)
      .not('email', 'is', null) // Make sure they have an email

    if (profilesError) {
      console.error('❌ Error fetching profiles:', profilesError)
      return new Response(
        JSON.stringify({ 
          error: 'Failed to fetch user profiles',
          details: profilesError.message
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      )
    }

    // Log information about eligible users
    if (!profiles || profiles.length === 0) {
      console.log('ℹ️ No users found with notifications enabled')
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'No users have email notifications enabled',
          notified_count: 0,
          markets_created: marketsCreated
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    console.log(`📧 Found ${profiles.length} users eligible for notifications`)

    // Calculate estimated time based on rate limiting
    const estimatedTimeSeconds = Math.ceil((profiles.length - 1) * 0.75) // 750ms delay between emails
    console.log(`⏱️ Estimated time to send all emails: ${estimatedTimeSeconds} seconds`)

    // Simple email template
    const emailTemplate = {
      from: 'prophet@cassandralabs.org',
      subject: `New Market${marketsCreated > 1 ? 's' : ''} Available for Trading`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
          <h2>Hello \${profile.username}!</h2>
          <p>New prediction market${marketsCreated > 1 ? 's are' : ' is'} now available for trading.</p>
          <p>
            <a href="https://prediction-market-iota.vercel.app/markets" 
               style="background: #007bff; color: white; padding: 10px 20px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              View Markets
            </a>
          </p>
          <p style="font-size: 12px; color: #666; margin-top: 20px;">
            <a href="https://prediction-market-iota.vercel.app/profile" style="color: #666;">
              Manage notification preferences
            </a>
          </p>
        </div>
      `,
      text: `
Hello \${profile.username}!

New prediction market${marketsCreated > 1 ? 's are' : ' is'} now available for trading.

View markets: https://prediction-market-iota.vercel.app/markets

---
Manage your notification preferences: https://prediction-market-iota.vercel.app/profile
      `
    }

    // Send emails with rate limiting
    const startTime = Date.now()
    const results = await sendEmailsWithRateLimit(profiles, emailTemplate, RESEND_API_KEY)
    const endTime = Date.now()
    const actualTimeSeconds = (endTime - startTime) / 1000

    // Calculate success/failure counts
    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    console.log(`📊 Email summary:`)
    console.log(`  ✅ Successfully sent: ${successful}`)
    console.log(`  ❌ Failed to send: ${failed}`)
    console.log(`  ⏱️ Total time taken: ${actualTimeSeconds.toFixed(1)} seconds`)
    console.log(`  📈 Average rate: ${(profiles.length / actualTimeSeconds).toFixed(1)} emails/second`)

    // Log any failures for debugging
    const failedEmails = results.filter(r => !r.success)
    if (failedEmails.length > 0) {
      console.log('❌ Failed email details:')
      failedEmails.forEach((failure, index) => {
        console.log(`  ${index + 1}. ${failure.email}: ${failure.error}`)
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Simple notifications sent to ${successful} users about new markets`,
        stats: {
          markets_created: marketsCreated,
          emails_sent: successful,
          emails_failed: failed,
          time_taken_seconds: actualTimeSeconds
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('💥 Function error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message,
        stack: error.stack
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})