"use client";

import { useState, useEffect } from "react";
import Navbar from "@/components/navbar";

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

const categories = ["All", "GDP & Growth", "Employment", "Interest Rates", "Inflation", "Exchange Rates", "Housing", "Production", "Business", "Sentiment", "Markets"];

export default function FREDDataPage() {
  const [series, setSeries] = useState<EconomicSeries[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      });
      
      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);
      
      if (!response.ok) {
        const responseText = await response.text();
        console.error('Error response:', responseText);
        
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
        )}

        {/* API Information */}
        <div className="mt-8 bg-blue-900/20 border border-blue-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-3 text-blue-400">About FRED API</h3>
          <div className="space-y-2 text-sm">
            <p className="text-gray-300">🔗 <span className="text-blue-400">Source:</span> Federal Reserve Economic Data (FRED)</p>
            <p className="text-gray-300">📊 <span className="text-green-400">Series Count:</span> {series.length} popular economic indicators</p>
            <p className="text-gray-300">🔄 <span className="text-yellow-400">Update Frequency:</span> Varies by series (daily, weekly, monthly, quarterly)</p>
            <p className="text-gray-300">📈 <span className="text-purple-400">Data Provider:</span> Federal Reserve Bank of St. Louis</p>
          </div>
        </div>
      </div>
    </div>
  );
}