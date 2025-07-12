// src/app/api/fred/route.ts
import { NextRequest, NextResponse } from 'next/server';

interface FREDSeriesResponse {
  realtime_start: string;
  realtime_end: string;
  seriess: Array<{
    id: string;
    title: string;
    frequency: string;
    units: string;
    last_updated: string;
  }>;
}

interface FREDObservationsResponse {
  realtime_start: string;
  realtime_end: string;
  observations: Array<{
    date: string;
    value: string;
  }>;
}

const POPULAR_SERIES = [
  { id: "GDP", category: "GDP & Growth", title: "Gross Domestic Product" },
  { id: "GDPPOT", category: "GDP & Growth", title: "Real Potential GDP" },
  { id: "UNRATE", category: "Employment", title: "Unemployment Rate" },
  { id: "PAYEMS", category: "Employment", title: "Total Nonfarm Payrolls" },
  { id: "FEDFUNDS", category: "Interest Rates", title: "Federal Funds Rate" },
  { id: "DGS10", category: "Interest Rates", title: "10-Year Treasury Rate" },
  { id: "CPIAUCSL", category: "Inflation", title: "Consumer Price Index" },
  { id: "CPILFESL", category: "Inflation", title: "Core CPI" },
  { id: "DEXUSEU", category: "Exchange Rates", title: "US/Euro Exchange Rate" },
  { id: "HOUST", category: "Housing", title: "Housing Starts" },
  { id: "CSUSHPISA", category: "Housing", title: "Case-Shiller Home Price Index" },
  { id: "INDPRO", category: "Production", title: "Industrial Production Index" },
  { id: "NAPM", category: "Business", title: "ISM Manufacturing PMI" },
  { id: "UMCSENT", category: "Sentiment", title: "Consumer Sentiment" },
  { id: "VIXCLS", category: "Markets", title: "VIX Volatility Index" }
];

export async function GET(request: NextRequest) {
  console.log('FRED API route called');
  
  const apiKey = process.env.FRED_API_KEY;
  
  if (!apiKey) {
    console.error('FRED API key not found in environment variables');
    return NextResponse.json(
      { error: 'FRED API key not configured. Please add FRED_API_KEY to your environment variables.' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const seriesId = searchParams.get('series');

  try {
    // If a specific series is requested
    if (seriesId) {
      console.log(`Fetching specific series: ${seriesId}`);
      
      const [seriesResponse, observationsResponse] = await Promise.all([
        fetch(`https://api.stlouisfed.org/fred/series?series_id=${seriesId}&api_key=${apiKey}&file_type=json`),
        fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&limit=2&sort_order=desc`)
      ]);

      if (!seriesResponse.ok || !observationsResponse.ok) {
        throw new Error(`Failed to fetch data for series ${seriesId}`);
      }

      const seriesData: FREDSeriesResponse = await seriesResponse.json();
      const observationsData: FREDObservationsResponse = await observationsResponse.json();

      return NextResponse.json({
        series: seriesData.seriess[0],
        observations: observationsData.observations
      });
    }

    // Fetch all popular series
    console.log('Fetching all popular series...');
    const seriesPromises = POPULAR_SERIES.map(async (seriesConfig) => {
      try {
        console.log(`Fetching ${seriesConfig.id}...`);
        
        const [seriesResponse, observationsResponse] = await Promise.all([
          fetch(`https://api.stlouisfed.org/fred/series?series_id=${seriesConfig.id}&api_key=${apiKey}&file_type=json`),
          fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${seriesConfig.id}&api_key=${apiKey}&file_type=json&limit=2&sort_order=desc`)
        ]);

        if (!seriesResponse.ok || !observationsResponse.ok) {
          console.warn(`Failed to fetch data for series ${seriesConfig.id}`);
          return null;
        }

        const seriesData: FREDSeriesResponse = await seriesResponse.json();
        const observationsData: FREDObservationsResponse = await observationsResponse.json();

        const series = seriesData.seriess[0];
        const observations = observationsData.observations;

        if (!series || !observations.length) {
          console.warn(`No data found for series ${seriesConfig.id}`);
          return null;
        }

        const currentValue = parseFloat(observations[0].value);
        const previousValue = observations[1] ? parseFloat(observations[1].value) : NaN;

        // Calculate change
        let change = "N/A";
        let changeType: "increase" | "decrease" | "neutral" = "neutral";

        if (!isNaN(currentValue) && !isNaN(previousValue)) {
          const diff = currentValue - previousValue;
          const percentChange = previousValue !== 0 ? (diff / previousValue) * 100 : 0;

          if (diff > 0) changeType = "increase";
          else if (diff < 0) changeType = "decrease";

          change = diff >= 0 ? 
            `+${diff.toFixed(2)} (+${percentChange.toFixed(2)}%)` : 
            `${diff.toFixed(2)} (${percentChange.toFixed(2)}%)`;
        }

        console.log(`Successfully processed ${seriesConfig.id}`);
        
        return {
          id: seriesConfig.id,
          title: series.title,
          value: isNaN(currentValue) ? observations[0].value : currentValue.toLocaleString(),
          change,
          changeType,
          period: observations[0].date,
          category: seriesConfig.category,
          frequency: series.frequency,
          units: series.units,
          lastUpdated: series.last_updated,
          rawValue: currentValue,
          previousValue: previousValue
        };

      } catch (error) {
        console.error(`Error processing series ${seriesConfig.id}:`, error);
        return null;
      }
    });

    const results = await Promise.all(seriesPromises);
    const validSeries = results.filter(series => series !== null);

    console.log(`Successfully fetched ${validSeries.length} series out of ${POPULAR_SERIES.length}`);

    return NextResponse.json({ 
      series: validSeries,
      totalRequested: POPULAR_SERIES.length,
      totalReturned: validSeries.length 
    });

  } catch (error) {
    console.error('Error fetching FRED data:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch FRED data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}