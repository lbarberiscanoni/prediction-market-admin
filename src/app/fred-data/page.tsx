"use client";

import { useState, useEffect } from "react";
import AddIndicatorMarket from "@/components/AddIndicatorMarket";

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

interface ReleaseSchedule {
  seriesId: string;
  nextReleaseDate: Date;
  releasePattern: string;
  importance: "high" | "medium" | "low";
}

// Known release schedules for major indicators
const RELEASE_SCHEDULES = [
  {
    seriesId: "UNRATE",
    releaseDay: "first-friday",
    importance: "high" as const,
    description: "First Friday of each month"
  },
  {
    seriesId: "PAYEMS", 
    releaseDay: "first-friday",
    importance: "high" as const,
    description: "First Friday of each month"
  },
  {
    seriesId: "CPIAUCSL",
    releaseDay: "mid-month",
    importance: "high" as const,
    description: "Mid-month (around 10th-15th)"
  },
  {
    seriesId: "CPILFESL",
    releaseDay: "mid-month", 
    importance: "high" as const,
    description: "Mid-month (around 10th-15th)"
  },
  {
    seriesId: "GDP",
    releaseDay: "quarterly-end",
    importance: "high" as const,
    description: "End of month after quarter"
  },
  {
    seriesId: "GDPPOT",
    releaseDay: "quarterly-end",
    importance: "medium" as const,
    description: "End of month after quarter"
  },
  {
    seriesId: "FEDFUNDS",
    releaseDay: "fomc-meeting",
    importance: "high" as const,
    description: "After FOMC meetings"
  },
  {
    seriesId: "DGS10",
    releaseDay: "daily",
    importance: "medium" as const,
    description: "Daily (business days)"
  },
  {
    seriesId: "INDPRO",
    releaseDay: "mid-month",
    importance: "medium" as const,
    description: "Mid-month (around 15th)"
  },
  {
    seriesId: "HOUST",
    releaseDay: "mid-month",
    importance: "medium" as const,
    description: "Mid-month (around 17th)"
  },
  {
    seriesId: "CSUSHPISA",
    releaseDay: "end-month",
    importance: "medium" as const,
    description: "Last Tuesday of month"
  },
  {
    seriesId: "NAPM",
    releaseDay: "first-business-day",
    importance: "medium" as const,
    description: "First business day of month"
  },
  {
    seriesId: "UMCSENT",
    releaseDay: "mid-month",
    importance: "low" as const,
    description: "Mid-month (preliminary and final)"
  },
  {
    seriesId: "VIXCLS",
    releaseDay: "daily",
    importance: "low" as const,
    description: "Daily (market days)"
  },
  {
    seriesId: "DEXUSEU",
    releaseDay: "daily",
    importance: "low" as const,
    description: "Daily (business days)"
  }
];

// FOMC meeting dates for 2025
const FOMC_DATES_2025 = [
  new Date(2025, 0, 29), // January 28-29 (announcement on 29th)
  new Date(2025, 2, 19), // March 18-19 (announcement on 19th)
  new Date(2025, 4, 7),  // May 6-7 (announcement on 7th)
  new Date(2025, 5, 18), // June 17-18 (announcement on 18th)
  new Date(2025, 6, 30), // July 29-30 (announcement on 30th)
  new Date(2025, 8, 17), // September 16-17 (announcement on 17th)
  new Date(2025, 10, 5), // November 4-5 (announcement on 5th)
  new Date(2025, 11, 17) // December 16-17 (announcement on 17th)
];

const categories = ["All", "GDP & Growth", "Employment", "Interest Rates", "Inflation", "Exchange Rates", "Housing", "Production", "Business", "Sentiment", "Markets"];

export default function FREDDataPage() {
  const [series, setSeries] = useState<EconomicSeries[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [releaseSchedules, setReleaseSchedules] = useState<ReleaseSchedule[]>([]);

  // Calculate next release date based on pattern
  const calculateNextReleaseDate = (releaseDay: string): Date => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    switch (releaseDay) {
      case "first-friday": {
        // First Friday of current month if not passed, otherwise next month
        const firstOfMonth = new Date(currentYear, currentMonth, 1);
        const dayOfWeek = firstOfMonth.getDay();
        const daysToFirstFriday = (5 - dayOfWeek + 7) % 7;
        const firstFriday = new Date(currentYear, currentMonth, 1 + daysToFirstFriday);
        
        if (firstFriday > now) {
          return firstFriday;
        } else {
          // Next month's first Friday
          const nextMonth = new Date(currentYear, currentMonth + 1, 1);
          const nextDayOfWeek = nextMonth.getDay();
          const nextDaysToFirstFriday = (5 - nextDayOfWeek + 7) % 7;
          return new Date(currentYear, currentMonth + 1, 1 + nextDaysToFirstFriday);
        }
      }
      
      case "mid-month": {
        // Around 15th of current or next month
        const midCurrentMonth = new Date(currentYear, currentMonth, 15);
        if (midCurrentMonth > now) {
          return midCurrentMonth;
        }
        return new Date(currentYear, currentMonth + 1, 15);
      }

      case "end-month": {
        // Last Tuesday of current or next month
        const lastDayCurrentMonth = new Date(currentYear, currentMonth + 1, 0);
        const lastTuesday = new Date(lastDayCurrentMonth);
        
        // Find last Tuesday
        while (lastTuesday.getDay() !== 2) {
          lastTuesday.setDate(lastTuesday.getDate() - 1);
        }
        
        if (lastTuesday > now) {
          return lastTuesday;
        }
        
        // Next month's last Tuesday
        const lastDayNextMonth = new Date(currentYear, currentMonth + 2, 0);
        const nextLastTuesday = new Date(lastDayNextMonth);
        while (nextLastTuesday.getDay() !== 2) {
          nextLastTuesday.setDate(nextLastTuesday.getDate() - 1);
        }
        return nextLastTuesday;
      }

      case "quarterly-end": {
        // Next quarterly release (end of Jan, Apr, Jul, Oct)
        const quarterlyMonths = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct
        const nextQuarterMonth = quarterlyMonths.find(month => {
          const quarterEnd = new Date(currentYear, month, 30);
          return quarterEnd > now;
        });
        
        if (nextQuarterMonth !== undefined) {
          return new Date(currentYear, nextQuarterMonth, 30);
        }
        // If no quarters left this year, first quarter next year
        return new Date(currentYear + 1, 0, 30);
      }

      case "first-business-day": {
        // First business day of next month
        const firstOfNextMonth = new Date(currentYear, currentMonth + 1, 1);
        while (firstOfNextMonth.getDay() === 0 || firstOfNextMonth.getDay() === 6) {
          firstOfNextMonth.setDate(firstOfNextMonth.getDate() + 1);
        }
        return firstOfNextMonth;
      }

      case "fomc-meeting": {
        // Next FOMC meeting
        const nextMeeting = FOMC_DATES_2025.find(date => date > now);
        return nextMeeting || FOMC_DATES_2025[0];
      }

      case "daily": {
        // Next business day
        const nextDay = new Date(now);
        nextDay.setDate(nextDay.getDate() + 1);
        while (nextDay.getDay() === 0 || nextDay.getDay() === 6) {
          nextDay.setDate(nextDay.getDate() + 1);
        }
        return nextDay;
      }

      default:
        return new Date(currentYear, currentMonth + 1, 1);
    }
  };

  // Generate release schedules
  useEffect(() => {
    const schedules: ReleaseSchedule[] = RELEASE_SCHEDULES.map(schedule => ({
      seriesId: schedule.seriesId,
      nextReleaseDate: calculateNextReleaseDate(schedule.releaseDay),
      releasePattern: schedule.description,
      importance: schedule.importance
    }));
    
    setReleaseSchedules(schedules);
  }, []);

  // Auto-load data on mount
  useEffect(() => {
    loadFREDData();
  }, []);

  // Load FRED data using our API route
  const loadFREDData = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('Fetching FRED data from /api/fred...');
      
      const response = await fetch('/api/fred', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store'
      });
      
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const responseText = await response.text();
        console.error('Error response:', responseText);
        
        if (response.status === 404) {
          throw new Error('FRED API route not found. Make sure src/app/api/fred/route.ts exists.');
        }
        
        try {
          const errorData = JSON.parse(responseText);
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        } catch {
          throw new Error(`HTTP error! status: ${response.status}. Response: ${responseText.substring(0, 200)}...`);
        }
      }
      
      const data = await response.json();
      console.log('Received data:', data);
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      setSeries(data.series || []);

      if (!data.series || data.series.length === 0) {
        setError("No data could be loaded from FRED API. Check console for details.");
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

  const getImportanceColor = (importance?: string) => {
    switch (importance) {
      case "high": return "bg-red-600/20 text-red-400 border-red-600";
      case "medium": return "bg-yellow-600/20 text-yellow-400 border-yellow-600";
      case "low": return "bg-green-600/20 text-green-400 border-green-600";
      default: return "bg-gray-600/20 text-gray-400 border-gray-600";
    }
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffTime = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
    
    if (diffDays < 0) return `${dateStr} (Past)`;
    if (diffDays === 0) return `${dateStr} (Today)`;
    if (diffDays === 1) return `${dateStr} (Tomorrow)`;
    if (diffDays < 7) return `${dateStr} (${diffDays}d)`;
    if (diffDays < 30) return `${dateStr} (${Math.floor(diffDays / 7)}w)`;
    return `${dateStr} (${Math.floor(diffDays / 30)}m)`;
  };

  const getReleaseInfo = (seriesId: string) => {
    return releaseSchedules.find(schedule => schedule.seriesId === seriesId);
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">FRED Economic Data</h1>
          <p className="text-gray-400">
            Live data from the Federal Reserve Economic Data (FRED) API with upcoming release schedules
          </p>
          {error && (
            <div className="mt-2 p-3 bg-red-900/30 border border-red-700 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Refresh Controls */}
        <div className="mb-6 bg-green-900/20 border border-green-800 rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold text-green-400">FRED Data Dashboard</h3>
              <p className="text-gray-300">Federal Reserve Economic Data from St. Louis Fed</p>
            </div>
            <button
              onClick={loadFREDData}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg font-medium transition-colors"
            >
              {loading ? "Loading..." : "Refresh Data"}
            </button>
          </div>
        </div>

        {/* Search and Filter Controls */}
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

        {/* Series List */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-400">Loading FRED data...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSeries.map((item) => {
              const releaseInfo = getReleaseInfo(item.id);
              
              return (
                <div
                  key={item.id}
                  className="bg-gray-900 rounded-lg p-6 border border-gray-800 hover:border-gray-700 transition-colors"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left section - Name and details */}
                    <div className="flex-1">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                        <h3 className="text-lg font-semibold">{item.title}</h3>
                        <div className="flex gap-2">
                          <span className="text-sm text-blue-400 bg-blue-900/30 px-2 py-1 rounded w-fit">
                            {item.id}
                          </span>
                          {releaseInfo && (
                            <span className={`text-xs px-2 py-1 rounded border ${getImportanceColor(releaseInfo.importance)}`}>
                              {releaseInfo.importance.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 space-y-1">
                        <p><span className="text-gray-400">Category:</span> {item.category}</p>
                        <p><span className="text-gray-400">Frequency:</span> {item.frequency}</p>
                        <p><span className="text-gray-400">Units:</span> {item.units}</p>
                        {releaseInfo && (
                          <p><span className="text-gray-400">Release Schedule:</span> {releaseInfo.releasePattern}</p>
                        )}
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

                    {/* Right section - Metadata and Actions */}
                    <div className="flex flex-col lg:items-end text-sm text-gray-400 gap-1">
                      <div className="flex flex-col gap-1 mb-3">
                        <p><span className="text-gray-500">Period:</span> {item.period}</p>
                        <p><span className="text-gray-500">Updated:</span> {new Date(item.lastUpdated).toLocaleDateString()}</p>
                        {releaseInfo && (
                          <p><span className="text-gray-500">Next Release:</span> 
                            <span className="ml-1 text-blue-400 font-medium">
                              {formatDate(releaseInfo.nextReleaseDate)}
                            </span>
                          </p>
                        )}
                      </div>
                      
                      {/* Add Market Button */}
                      <div className="w-full lg:w-auto">
                        <AddIndicatorMarket 
                          indicator={item}
                          onMarketCreated={(marketId) => {
                            console.log(`Market created with ID: ${marketId}`);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            
            {filteredSeries.length === 0 && !loading && (
              <div className="text-center py-12">
                <p className="text-gray-400 text-lg">No data found matching your criteria</p>
              </div>
            )}
          </div>
        )}

        {/* Release Importance Legend */}
        <div className="mt-8 bg-gray-900 rounded-lg p-6 border border-gray-800">
          <h3 className="text-lg font-semibold mb-4">Release Importance</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-red-600/20 text-red-400 border border-red-600 text-xs rounded">HIGH</span>
              <span className="text-gray-400 text-sm">Market-moving releases</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-yellow-600/20 text-yellow-400 border border-yellow-600 text-xs rounded">MEDIUM</span>
              <span className="text-gray-400 text-sm">Sector-specific indicators</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-green-600/20 text-green-400 border border-green-600 text-xs rounded">LOW</span>
              <span className="text-gray-400 text-sm">Regular updates</span>
            </div>
          </div>
        </div>

        {/* API Information */}
        <div className="mt-8 bg-blue-900/20 border border-blue-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-3 text-blue-400">About FRED API</h3>
          <div className="space-y-2 text-sm">
            <p className="text-gray-300">🔗 <span className="text-blue-400">Source:</span> Federal Reserve Economic Data (FRED)</p>
            <p className="text-gray-300">📊 <span className="text-green-400">Series Count:</span> {series.length} popular economic indicators</p>
            <p className="text-gray-300">🔄 <span className="text-yellow-400">Update Frequency:</span> Varies by series (daily, weekly, monthly, quarterly)</p>
            <p className="text-gray-300">📈 <span className="text-purple-400">Data Provider:</span> Federal Reserve Bank of St. Louis</p>
            <p className="text-gray-300">📅 <span className="text-orange-400">Release Schedules:</span> Estimated based on typical patterns - actual dates may vary</p>
          </div>
        </div>
      </div>
    </div>
  );
}
