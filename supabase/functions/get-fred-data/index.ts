import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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
    // Get FRED API key from environment variables
    const fredApiKey = Deno.env.get('FRED_API_KEY')
    if (!fredApiKey) {
      throw new Error('FRED_API_KEY environment variable is required')
    }

    // Get parameters from request (support both GET query params and POST body)
    let daysAhead = 30
    let createMarkets = false
    let creatorId = 'ebc7e4e8-b321-437b-8587-7071fdf73183'
    let jwtToken = ''
    let supabaseProjectUrl = ''

    if (req.method === 'POST') {
      // Parse POST body
      const body = await req.json()
      daysAhead = body.days_ahead || 30
      createMarkets = body.create_markets || false
      creatorId = body.creator_id || creatorId
      jwtToken = body.jwt_token || ''
      supabaseProjectUrl = body.supabase_project_url || ''
    } else {
      // Fallback to GET query parameters
      const url = new URL(req.url)
      daysAhead = parseInt(url.searchParams.get('days_ahead') || '30')
      createMarkets = url.searchParams.get('create_markets') === 'true'
      jwtToken = url.searchParams.get('jwt_token') || ''
      supabaseProjectUrl = url.searchParams.get('supabase_project_url') || ''
    }

    // Calculate target date (X days from today)
    const today = new Date()
    const targetDate = new Date()
    targetDate.setDate(today.getDate() + daysAhead)

    const formatDate = (date: Date) => date.toISOString().split('T')[0]
    const targetDateStr = formatDate(targetDate)

    // Define target indicators with their confirmed FRED release IDs and series IDs
    const targetIndicators = [
      {
        name: "Advance Real Retail and Food Services Sales",
        releaseId: 92,
        seriesId: "RRSFS",
      },
      {
        name: "Brave-Butters-Kelley Real Gross Domestic Product",
        releaseId: 488,
        seriesId: "BBKMGDP",
      },
      {
        name: "Business Applications: Total for All NAICS in the United States",
        releaseId: 443,
        seriesId: "BABATOTALSAUS",
      },
      {
        name: "Total Construction Spending: Total Construction in the United States",
        releaseId: 229,
        seriesId: "TTLCONS",
      },
      {
        name: "Median Consumer Price Index",
        releaseId: 315,
        seriesId: "MEDCPIM158SFRBCLE",
      },
      {
        name: "Industrial Production: Total Index",
        releaseId: 13,
        seriesId: "INDPRO",
      },
      {
        name: "Commercial Bank Interest Rate on Credit Card Plans, All Accounts",
        releaseId: 14,
        seriesId: "TERMCBCCALLNS",
      },
      {
        name: "Housing Inventory: Active Listing Count in the United States",
        releaseId: 462,
        seriesId: "ACTLISCOUUS",
      },
      {
        name: "Kansas City Financial Stress Index",
        releaseId: 198,
        seriesId: "KCFSI",
      },
      {
        name: "Producer Price Index by Commodity: All Commodities",
        releaseId: 46,
        seriesId: "PPIACO",
      },
      {
        name: "Import Price Index (End Use): All Commodities",
        releaseId: 188,
        seriesId: "IR",
      },
      {
        name: "Export Price Index (End Use): All Commodities",
        releaseId: 188,
        seriesId: "IQ",
      },
      {
        name: "Trade Balance: Goods and Services, Balance of Payments Basis",
        releaseId: 51,
        seriesId: "BOPGSTB",
      },
      {
        name: "Smoothed U.S. Recession Probabilities",
        releaseId: 261,
        seriesId: "RECPROUSM156N",
      },
      {
        name: "Imports of Goods: Manufactured Commodities for United States",
        releaseId: 449,
        seriesId: "IMPMANUS",
      },
      {
        name: "Visa Spending Momentum Index: Headline: United States",
        releaseId: 736,
        seriesId: "VISASMIHSA",
      }
    ]

    // Function to get the most recent observation for a series
    async function getLatestObservation(seriesId: string) {
      const observationsUrl = `https://api.stlouisfed.org/fred/series/observations`
      const params = new URLSearchParams({
        api_key: fredApiKey,
        file_type: 'json',
        series_id: seriesId,
        limit: '1',
        sort_order: 'desc',
        observation_start: '1900-01-01',
        observation_end: '9999-12-31'
      })

      try {
        console.log(`Fetching latest observation for ${seriesId}`)
        const response = await fetch(`${observationsUrl}?${params}`)
        
        if (!response.ok) {
          console.warn(`Failed to fetch observations for ${seriesId}: ${response.status}`)
          return null
        }

        const data = await response.json()
        const observations = data.observations || []
        
        if (observations.length === 0) {
          console.warn(`No observations found for ${seriesId}`)
          return null
        }

        const latestObs = observations[0]
        return {
          series_id: seriesId,
          date: latestObs.date,
          value: latestObs.value,
          realtime_start: latestObs.realtime_start,
          realtime_end: latestObs.realtime_end
        }
      } catch (error) {
        console.error(`Error fetching observations for ${seriesId}:`, error)
        return null
      }
    }

    // Function to get release dates for a specific release ID on a specific date
    async function getReleaseCalendar(releaseId: number, indicatorName: string, seriesId: string) {
      const calendarUrl = `https://api.stlouisfed.org/fred/release/dates`
      const params = new URLSearchParams({
        api_key: fredApiKey,
        file_type: 'json',
        release_id: releaseId.toString(),
        realtime_start: targetDateStr,
        realtime_end: targetDateStr, // Same date for both start and end to get only that specific day
        include_release_dates_with_no_data: 'true',
        sort_order: 'asc'
      })

      try {
        console.log(`Checking release calendar for ${indicatorName} on ${targetDateStr} (Release ID: ${releaseId})`)
        const response = await fetch(`${calendarUrl}?${params}`)
        
        if (!response.ok) {
          console.warn(`Failed to fetch release calendar for ${releaseId}: ${response.status}`)
          return []
        }

        const data = await response.json()
        const releaseDates = data.release_dates || []

        // Filter to only include releases on the exact target date
        const targetReleases = releaseDates.filter(release => release.date === targetDateStr)

        return targetReleases.map(release => ({
          series_id: seriesId,
          series_name: indicatorName,
          release_id: releaseId,
          release_name: indicatorName,
          release_date: release.date,
          days_until_release: daysAhead
        }))
      } catch (error) {
        console.error(`Error fetching release calendar for ${releaseId}:`, error)
        return []
      }
    }

    console.log(`Checking for releases on specific date: ${targetDateStr} (${daysAhead} days from today)`)

    // STEP 1: Get all release information for the specific target date
    const allReleases = []
    const errors = []

    // Process all indicators to find releases on the specific date
    for (const indicator of targetIndicators) {
      try {
        const releases = await getReleaseCalendar(indicator.releaseId, indicator.name, indicator.seriesId)
        if (releases && releases.length > 0) {
          allReleases.push(...releases)
        }
      } catch (error) {
        console.error(`Error processing ${indicator.name}:`, error)
        errors.push({
          indicator: indicator.name,
          series_id: indicator.seriesId,
          release_id: indicator.releaseId,
          error: error.message
        })
      }
    }

    // STEP 2: Only get latest observations for series that have releases on the target date
    const seriesWithReleasesOnTargetDate = new Set(allReleases.map(release => release.series_id))
    const latestObservations = []

    console.log(`Found ${seriesWithReleasesOnTargetDate.size} series with releases on ${targetDateStr}, fetching their latest observations...`)

    for (const seriesId of seriesWithReleasesOnTargetDate) {
      try {
        const latestObs = await getLatestObservation(seriesId)
        if (latestObs) {
          // Find the corresponding indicator name
          const indicator = targetIndicators.find(ind => ind.seriesId === seriesId)
          latestObservations.push({
            ...latestObs,
            series_name: indicator?.name || seriesId
          })
        }
      } catch (error) {
        console.error(`Error fetching latest observation for ${seriesId}:`, error)
        errors.push({
          indicator: seriesId,
          series_id: seriesId,
          error: error.message,
          operation: 'latest_observation'
        })
      }
    }

    // Sort releases by date
    allReleases.sort((a, b) => new Date(a.release_date).getTime() - new Date(b.release_date).getTime())

    // Create market entries using the external API if requested
    let marketEntries = []
    let createdMarkets = []
    let insertError = null
    let notificationResult = null

    if (createMarkets && allReleases.length > 0 && jwtToken && supabaseProjectUrl) {
      console.log(`Creating markets for ${allReleases.length} releases using external API...`)
      
      for (const release of allReleases) {
        try {
          // Find the latest observation for this series
          const latestObs = latestObservations.find(obs => obs.series_id === release.series_id)
          
          if (!latestObs) {
            console.warn(`No latest observation found for ${release.series_id}, skipping market creation`)
            errors.push({
              series_id: release.series_id,
              series_name: release.series_name,
              error: 'No latest observation data available for market creation'
            })
            continue
          }

          // Convert the latest observation value to number for the target field
          const targetValue = parseFloat(latestObs.value)
          
          if (isNaN(targetValue)) {
            console.warn(`Invalid target value for ${release.series_id}: ${latestObs.value}, skipping market creation`)
            errors.push({
              series_id: release.series_id,
              series_name: release.series_name,
              error: `Invalid target value: ${latestObs.value} (not a number)`
            })
            continue
          }

          // Prepare market data with target value
          const marketData = {
            name: release.series_name,
            description: `Will the next release on ${release.release_date} be higher than ${latestObs.value}?`,
            link: `https://fred.stlouisfed.org/series/${release.series_id}`,
            close_date: release.release_date,
            tags: ["Economics"],
            target: targetValue  // Add the target value from latest observation
          }

          // Call the market creation API
          console.log(`Creating market for ${release.series_name} with target value: ${targetValue}...`)
          const marketResponse = await fetch(`${supabaseProjectUrl}/functions/v1/add-market`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${jwtToken}`
            },
            body: JSON.stringify(marketData)
          })

          if (marketResponse.ok) {
            const marketResult = await marketResponse.json()
            createdMarkets.push({
              series_id: release.series_id,
              series_name: release.series_name,
              market_id: marketResult.market?.id,
              market_name: marketResult.market?.name,
              previous_value: latestObs.value,
              target_value: targetValue,  // Include target value in response
              release_date: release.release_date,
              market_result: marketResult
            })
            console.log(`✅ Created market for ${release.series_name} (ID: ${marketResult.market?.id}) with target: ${targetValue}`)
          } else {
            const errorText = await marketResponse.text()
            console.error(`❌ Failed to create market for ${release.series_name}: ${marketResponse.status} ${errorText}`)
            errors.push({
              series_id: release.series_id,
              series_name: release.series_name,
              error: `Market creation failed: ${marketResponse.status} ${errorText}`
            })
          }
        } catch (error) {
          console.error(`Error creating market for ${release.series_name}:`, error)
          errors.push({
            series_id: release.series_id,
            series_name: release.series_name,
            error: error.message
          })
        }
      }

      // Call market-notification function if any markets were successfully created
      if (createdMarkets.length > 0) {
        try {
          console.log(`Calling market-notification function for ${createdMarkets.length} created markets...`)
          
          const notificationData = {
            markets_created: createdMarkets.length,
            target_date: targetDateStr,
            days_ahead: daysAhead,
            created_markets: createdMarkets.map(market => ({
              market_id: market.market_id,
              market_name: market.market_name,
              series_name: market.series_name,
              release_date: market.release_date,
              target_value: market.target_value  // Include target value in notification
            }))
          }

          const notificationResponse = await fetch(`${supabaseProjectUrl}/functions/v1/market-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${jwtToken}`
            },
            body: JSON.stringify(notificationData)
          })

          if (notificationResponse.ok) {
            notificationResult = await notificationResponse.json()
            console.log(`✅ Market notification sent successfully`)
          } else {
            const notificationError = await notificationResponse.text()
            console.error(`❌ Failed to send market notification: ${notificationResponse.status} ${notificationError}`)
            notificationResult = {
              success: false,
              error: `Notification failed: ${notificationResponse.status} ${notificationError}`
            }
          }
        } catch (error) {
          console.error(`Error calling market-notification function:`, error)
          notificationResult = {
            success: false,
            error: error.message
          }
        }
      }
    } else if (createMarkets && (!jwtToken || !supabaseProjectUrl)) {
      insertError = "Market creation requested but jwt_token and/or supabase_project_url not provided"
    }

    // Group releases by date for summary (should all be the same date now)
    const releasesByDate = {}
    allReleases.forEach(release => {
      if (!releasesByDate[release.release_date]) {
        releasesByDate[release.release_date] = []
      }
      releasesByDate[release.release_date].push(release)
    })

    // Create summary statistics
    const releaseCount = allReleases.length

    // Count releases by indicator
    const releasesByIndicator = {}
    allReleases.forEach(release => {
      releasesByIndicator[release.series_name] = (releasesByIndicator[release.series_name] || 0) + 1
    })

    // Create summary of latest observations
    const observationsSummary = {}
    latestObservations.forEach(obs => {
      observationsSummary[obs.series_id] = {
        series_name: obs.series_name,
        latest_date: obs.date,
        latest_value: obs.value,
        days_since_latest: Math.ceil((today.getTime() - new Date(obs.date).getTime()) / (1000 * 60 * 60 * 24))
      }
    })

    return new Response(
      JSON.stringify({
        query_parameters: {
          method: req.method,
          target_date: targetDateStr,
          days_ahead: daysAhead,
          create_markets: createMarkets,
          creator_id: creatorId,
          total_indicators_checked: targetIndicators.length
        },
        summary: {
          target_date: targetDateStr,
          days_until_target: daysAhead,
          releases_found_on_target_date: releaseCount,
          unique_indicators_with_releases: Object.keys(releasesByIndicator).length,
          series_with_releases_on_target_date: seriesWithReleasesOnTargetDate.size,
          latest_observations_found: latestObservations.length,
          processing_errors: errors.length,
          releases_by_indicator: releasesByIndicator,
          observations_summary: observationsSummary
        },
        releases_on_target_date: allReleases,
        releases_by_date: releasesByDate,
        latest_observations: latestObservations,
        database_operations: createMarkets ? {
          markets_requested: allReleases.length,
          markets_created: createdMarkets.length,
          creation_successful: createdMarkets.length > 0,
          creation_errors: errors.filter(e => e.error.includes('Market creation')).length,
          insert_error: insertError,
          created_markets: createdMarkets,
          notification_result: notificationResult
        } : { message: "Market creation disabled (set create_markets=true and provide jwt_token + supabase_project_url to enable)" },
        processing_errors: errors,
        metadata: {
          timestamp: new Date().toISOString(),
          function_version: "6.2",
          execution_time_ms: Date.now() - today.getTime(),
          api_calls_made: targetIndicators.length + seriesWithReleasesOnTargetDate.size + (createMarkets ? createdMarkets.length : 0) + (notificationResult ? 1 : 0),
          release_calendar_calls: targetIndicators.length,
          observations_calls: seriesWithReleasesOnTargetDate.size,
          market_creation_calls: createMarkets ? allReleases.length : 0,
          notification_calls: notificationResult ? 1 : 0,
          optimization: "Checks releases on specific target date, fetches observations for those series, creates markets via external API with target values, and sends notifications"
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