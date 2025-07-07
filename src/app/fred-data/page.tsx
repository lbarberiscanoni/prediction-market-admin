"use client";

import { useState, useEffect } from "react";
import Navbar from "@/components/navbar";

interface FREDSeries {
  id: string;
  realtime_start: string;
  realtime_end: string;
  title: string;
  observation_start: string;
  observation_end: string;
  frequency: string;
  frequency_short: string;
  units: string;
  units_short: string;
  seasonal_adjustment: string;
  seasonal_adjustment_short: string;
  last_updated: string;
  popularity: number;
  notes?: string;
}

interface FREDObservation {
  realtime_start: string;
  realtime_end: string;
  date: string;
  value: string;
}

interface FREDResponse {
  realtime_start: string;
  realtime_end: string;
  observation_start: string;
  observation_end: string;
  units: string;
  output_type: number;
  file_type: string;
  order_by: string;
  sort_order: string;
  count: number;
  offset: number;
  limit: number;
  observations: FREDObservation[];
}

interface EconomicSeries {
  id: string;
  title: string;
  value: string;
  change: string;
  changeType: "increase" | "decrease" | "neutral";
  period: string;
  category: string;
  frequency: string;
  units: string;
  lastUpdated: string;
  rawValue?: number;
  previousValue?: number;
}

// Popular FRED series IDs
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

const categories = ["All", "GDP & Growth", "Employment", "Interest Rates", "Inflation", "Exchange Rates", "Housing", "Production", "Business", "Sentiment", "Markets"];

export default function FREDDataPage() {
  const [series, setSeries] = useState<EconomicSeries[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(true);

  // Check for API key in localStorage on mount
  useEffect(() => {
    const savedApiKey = localStorage.getItem('fred_api_key');
    if (savedApiKey) {
      setApiKey(savedApiKey);
      setShowApiKeyInput(false);
    }
  }, []);

  // Auto-load data when API key is set
  useEffect(() => {
    if (apiKey && !showApiKeyInput) {
      loadFREDData();
    }
  }, [apiKey, showApiKeyInput]);

  const saveApiKey = () => {
    if (apiKey.trim()) {
      localStorage.setItem('fred_api_key', apiKey.trim());
      setShowApiKeyInput(false);
      setError(null);
    } else {
      setError("Please enter a valid FRED API key");
    }
  };

  const clearApiKey = () => {
    localStorage.removeItem('fred_api_key');
    setApiKey("");
    setShowApiKeyInput(true);
    setSeries([]);
  };

  // Fetch series metadata
  const fetchSeriesInfo = async (seriesId: string): Promise<FREDSeries | null> => {
    try {
      const response = await fetch(
        `https://api.stlouisfed.org/fred/series?series_id=${seriesId}&api_key=${apiKey}&file_type=json`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch series info for ${seriesId}`);
      }

      const data = await response.json();
      return data.seriess?.[0] || null;
    } catch (error) {
      console.error(`Error fetching series info for ${seriesId}:`, error);
      return null;
    }
  };

  // Fetch latest observations for a series
  const fetchSeriesData = async (seriesId: string): Promise<FREDObservation[]> => {
    try {
      const response = await fetch(
        `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&limit=2&sort_order=desc`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch data for ${seriesId}`);
      }

      const data: FREDResponse = await response.json();
      return data.observations || [];
    } catch (error) {
      console.error(`Error fetching data for ${seriesId}:`, error);
      return [];
    }
  };

  // Calculate change between two values
  const calculateChange = (current: number, previous: number): { change: string; changeType: "increase" | "decrease" | "neutral" } => {
    if (isNaN(current) || isNaN(previous)) {
      return { change: "N/A", changeType: "neutral" };
    }

    const diff = current - previous;
    const percentChange = previous !== 0 ? (diff / previous) * 100 : 0;

    let changeType: "increase" | "decrease" | "neutral" = "neutral";
    if (diff > 0) changeType = "increase";
    else if (diff < 0) changeType = "decrease";

    const changeStr = diff >= 0 ? 
      `+${diff.toFixed(2)} (+${percentChange.toFixed(2)}%)` : 
      `${diff.toFixed(2)} (${percentChange.toFixed(2)}%)`;

    return { change: changeStr, changeType };
  };

  // Load FRED data for all popular series
  const loadFREDData = async () => {
    if (!apiKey) {
      setError("Please enter your FRED API key first");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const seriesPromises = POPULAR_SERIES.map(async (seriesConfig) => {
        try {
          // Fetch series metadata and latest data in parallel
          const [seriesInfo, observations] = await Promise.all([
            fetchSeriesInfo(seriesConfig.id),
            fetchSeriesData(seriesConfig.id)
          ]);

          if (!seriesInfo || !observations.length) {
            console.warn(`No data found for series ${seriesConfig.id}`);
            return null;
          }

          // Get current and previous values
          const currentObs = observations[0];
          const previousObs = observations[1];

          const currentValue = parseFloat(currentObs.value);
          const previousValue = previousObs ? parseFloat(previousObs.value) : NaN;

          // Calculate change
          const { change, changeType } = calculateChange(currentValue, previousValue);

          const economicSeries: EconomicSeries = {
            id: seriesConfig.id,
            title: seriesInfo.title,
            value: isNaN(currentValue) ? currentObs.value : currentValue.toLocaleString(),
            change,
            changeType,
            period: currentObs.date,
            category: seriesConfig.category,
            frequency: seriesInfo.frequency,
            units: seriesInfo.units,
            lastUpdated: seriesInfo.last_updated,
            rawValue: currentValue,
            previousValue: previousValue
          };

          return economicSeries;
        } catch (error) {
          console.error(`Error processing series ${seriesConfig.id}:`, error);
          return null;
        }
      });

      const results = await Promise.all(seriesPromises);
      const validSeries = results.filter((series): series is EconomicSeries => series !== null);

      setSeries(validSeries);

      if (validSeries.length === 0) {
        setError("No data could be loaded. Please check your API key and try again.");
      }

    } catch (error) {
      console.error("Error loading FRED data:", error);
      setError(`Failed to load FRED data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredSeries = series.filter(item => {
    const matchesCategory = selectedCategory === "All" || item.category === selectedCategory;
    const matchesSearch = item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.category.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const getChangeColor = (changeType: string) => {
    switch (changeType) {
      case "increase":
        return "text-green-400";
      case "decrease":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  const getChangeIcon = (changeType: string) => {
    switch (changeType) {
      case "increase":
        return "↗";
      case "decrease":
        return "↘";
      default:
        return "→";
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <div className="container mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">FRED Economic Data</h1>
          <p className="text-gray-400">
            Live data from the Federal Reserve Economic Data (FRED) API
          </p>
          {error && (
            <div className="mt-2 p-3 bg-red-900/30 border border-red-700 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* API Key Input */}
        {showApiKeyInput && (
          <div className="mb-6 bg-blue-900/20 border border-blue-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3 text-blue-400">FRED API Key Required</h3>
            <p className="text-gray-300 mb-4">
              To access FRED data, you need an API key from the Federal Reserve Bank of St. Louis.
              <a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline ml-1">
                Get your free API key here →
              </a>
            </p>
            <div className="flex gap-3">
              <input
                type="password"
                placeholder="Enter your FRED API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="flex-1 p-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={saveApiKey}
                disabled={!apiKey.trim()}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
              >
                Save API Key
              </button>
            </div>
          </div>
        )}

        {/* API Key Management */}
        {!showApiKeyInput && (
          <div className="mb-6 bg-green-900/20 border border-green-800 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-green-400">API Key Configured</h3>
                <p className="text-gray-300">FRED API key is saved and ready to use</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={loadFREDData}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg font-medium transition-colors"
                >
                  {loading ? "Loading..." : "Refresh Data"}
                </button>
                <button
                  onClick={clearApiKey}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition-colors"
                >
                  Clear API Key
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search and Filter Controls */}
        {!showApiKeyInput && (
          <div className="mb-6 space-y-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search by series name, ID, or category..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                      selectedCategory === category
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Series List */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-400">Loading FRED data...</span>
          </div>
        ) : !showApiKeyInput ? (
          <div className="space-y-4">
            {filteredSeries.map((item) => (
              <div
                key={item.id}
                className="bg-gray-900 rounded-lg p-6 border border-gray-800 hover:border-gray-700 transition-colors"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left section - Name and details */}
                  <div className="flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold">{item.title}</h3>
                      <span className="text-sm text-blue-400 bg-blue-900/30 px-2 py-1 rounded w-fit">
                        {item.id}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 space-y-1">
                      <p><span className="text-gray-400">Category:</span> {item.category}</p>
                      <p><span className="text-gray-400">Frequency:</span> {item.frequency}</p>
                      <p><span className="text-gray-400">Units:</span> {item.units}</p>
                    </div>
                  </div>

                  {/* Middle section - Value */}
                  <div className="flex flex-col items-start lg:items-center gap-1">
                    <span className="text-2xl font-bold">{item.value}</span>
                    <span className={`text-sm flex items-center gap-1 ${getChangeColor(item.changeType)}`}>
                      {getChangeIcon(item.changeType)}
                      {item.change}
                    </span>
                  </div>

                  {/* Right section - Metadata */}
                  <div className="flex flex-col lg:items-end text-sm text-gray-400 gap-1">
                    <p><span className="text-gray-500">Period:</span> {item.period}</p>
                    <p><span className="text-gray-500">Updated:</span> {new Date(item.lastUpdated).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            ))}
            
            {filteredSeries.length === 0 && !loading && (
              <div className="text-center py-12">
                <p className="text-gray-400 text-lg">No data found matching your criteria</p>
              </div>
            )}
          </div>
        ) : null}

        {/* API Information */}
        {!showApiKeyInput && (
          <div className="mt-8 bg-blue-900/20 border border-blue-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3 text-blue-400">About FRED API</h3>
            <div className="space-y-2 text-sm">
              <p className="text-gray-300">🔗 <span className="text-blue-400">Source:</span> Federal Reserve Economic Data (FRED)</p>
              <p className="text-gray-300">📊 <span className="text-green-400">Series Count:</span> {series.length} popular economic indicators</p>
              <p className="text-gray-300">🔄 <span className="text-yellow-400">Update Frequency:</span> Varies by series (daily, weekly, monthly, quarterly)</p>
              <p className="text-gray-300">📈 <span className="text-purple-400">Data Provider:</span> Federal Reserve Bank of St. Louis</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}