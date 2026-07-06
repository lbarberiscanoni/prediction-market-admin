"use client";

import { useState, useEffect } from "react";

interface EconomicIndicator {
  id: string;
  name: string;
  value: string;
  change: string;
  changeType: "increase" | "decrease" | "neutral";
  period: string;
  category: string;
  source: string;
  description: string;
  lastUpdated: string;
  rawValue?: number;
  timeSlot: string;
  errorData: string;
  categoryCode: string;
  seasonallyAdj: string;
  dataTypeCode: string;
}

interface CensusDataPoint {
  cellValue: string;
  timeSlotId: string;
  errorData: string;
  categoryCode: string;
  seasonallyAdj: string;
  dataTypeCode: string;
  time: string;
  us: string;
}

interface APIResult {
  data: string[][];
  year: number;
}

const categories = ["All", "Business Formation"];

export default function EconomicIndicatorsPage() {
  const [indicators, setIndicators] = useState<EconomicIndicator[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rawData, setRawData] = useState<CensusDataPoint[]>([]);

  // Fetch business formation data from Census API
  const fetchBusinessFormationData = async (): Promise<APIResult> => {
    setLoading(true);
    setError(null);

    try {
      // Use the exact API call you specified
      const apiUrl = 'https://api.census.gov/data/timeseries/eits/bfs?get=cell_value,time_slot_id,error_data,category_code&seasonally_adj&data_type_code&for=US&time=2024';
      
      console.log('Fetching from:', apiUrl);
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
      
      const data: string[][] = await response.json();
      console.log('Raw API Response:', data);
      return { data, year: 2024 };
      
    } catch (error) {
      console.error('Error fetching business formation data:', error);
      throw error;
    }
  };

  // Process Census API data into our indicator format
  const processCensusData = (apiData: string[][], year: number): { indicators: EconomicIndicator[], rawDataPoints: CensusDataPoint[] } => {
    if (!apiData || apiData.length < 2) {
      return { indicators: [], rawDataPoints: [] };
    }

    const headers = apiData[0];
    const dataRows = apiData.slice(1);
    
    console.log('API Headers:', headers);
    console.log('Data rows:', dataRows);

    const processedIndicators: EconomicIndicator[] = [];
    const rawDataPoints: CensusDataPoint[] = [];
    
    // Process each row of data
    dataRows.forEach((row, index) => {
      const cellValueIndex = headers.indexOf('cell_value');
      const timeSlotIdIndex = headers.indexOf('time_slot_id');
      const errorDataIndex = headers.indexOf('error_data');
      const categoryCodeIndex = headers.indexOf('category_code');
      const seasonallyAdjIndex = headers.indexOf('seasonally_adj');
      const dataTypeCodeIndex = headers.indexOf('data_type_code');
      const timeIndex = headers.indexOf('time');
      const usIndex = headers.indexOf('us');
      
      if (cellValueIndex === -1) {
        console.warn('cell_value column not found in API response');
        return;
      }
      
      const cellValue = row[cellValueIndex] || '';
      const timeSlotId = timeSlotIdIndex >= 0 ? row[timeSlotIdIndex] : '';
      const errorData = errorDataIndex >= 0 ? row[errorDataIndex] : '';
      const categoryCode = categoryCodeIndex >= 0 ? row[categoryCodeIndex] : '';
      const seasonallyAdj = seasonallyAdjIndex >= 0 ? row[seasonallyAdjIndex] : '';
      const dataTypeCode = dataTypeCodeIndex >= 0 ? row[dataTypeCodeIndex] : '';
      const time = timeIndex >= 0 ? row[timeIndex] : '';
      const us = usIndex >= 0 ? row[usIndex] : '';

      // Store raw data point
      rawDataPoints.push({
        cellValue,
        timeSlotId,
        errorData,
        categoryCode,
        seasonallyAdj,
        dataTypeCode,
        time,
        us
      });

      // Create indicator from this data point
      const numericValue = parseFloat(cellValue) || 0;
      
      // Determine indicator name based on category and data type codes
      let name = `${categoryCode} - ${dataTypeCode}`;
      let description = `Business formation metric: ${categoryCode} (${dataTypeCode})`;
      
      // Try to make more readable names
      if (categoryCode.includes('NAICS')) {
        name = `NAICS Sector ${categoryCode.replace('NAICS', '')} Business Formation`;
        description = `Business formation data for NAICS sector ${categoryCode.replace('NAICS', '')}`;
      }

      processedIndicators.push({
        id: `bfs_${index}`,
        name,
        value: numericValue.toLocaleString(),
        change: "N/A", // We need multiple time periods to calculate change
        changeType: "neutral",
        period: time || `${year}`,
        category: "Business Formation",
        source: "U.S. Census Bureau",
        description,
        lastUpdated: new Date().toISOString().split('T')[0],
        rawValue: numericValue,
        timeSlot: timeSlotId,
        errorData: errorData,
        categoryCode: categoryCode,
        seasonallyAdj: seasonallyAdj,
        dataTypeCode: dataTypeCode
      });
    });

    return { indicators: processedIndicators, rawDataPoints };
  };

  // Load data on component mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const result = await fetchBusinessFormationData();
        const { indicators: censusIndicators, rawDataPoints } = processCensusData(result.data, result.year);
        
        console.log('Processed indicators:', censusIndicators);
        console.log('Raw data points:', rawDataPoints);
        
        setIndicators(censusIndicators);
        setRawData(rawDataPoints);
        
      } catch (error) {
        console.error('Failed to load Census data:', error);
        setError(`Failed to load business formation data from Census API: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setIndicators([]);
        setRawData([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const filteredIndicators = indicators.filter(indicator => {
    const matchesCategory = selectedCategory === "All" || indicator.category === selectedCategory;
    const matchesSearch = indicator.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         indicator.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         indicator.categoryCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         indicator.dataTypeCode.toLowerCase().includes(searchTerm.toLowerCase());
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
      <div className="container mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Census Bureau Business Formation Data</h1>
          <p className="text-gray-400">
            Live data from the Business Formation Statistics (BFS) API for 2024
          </p>
          {error && (
            <div className="mt-2 p-3 bg-red-900/30 border border-red-700 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Search and Filter Controls */}
        <div className="mb-6 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by category code, data type, or description..."
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

        {/* API Call Information */}
        <div className="mb-6 bg-blue-900/20 border border-blue-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-2 text-blue-400">API Call Details</h3>
          <p className="text-sm text-gray-300 font-mono break-all">
            https://api.census.gov/data/timeseries/eits/bfs?get=cell_value,time_slot_id,error_data,category_code&seasonally_adj&data_type_code&for=US&time=2024
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Data count: {indicators.length} records
          </p>
        </div>

        {/* Indicators List */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-400">Loading Census Bureau data...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredIndicators.map((indicator) => (
              <div
                key={indicator.id}
                className="bg-gray-900 rounded-lg p-6 border border-gray-800 hover:border-gray-700 transition-colors"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left section - Name and details */}
                  <div className="flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold">{indicator.name}</h3>
                      <span className="text-sm text-green-400 bg-green-900/30 px-2 py-1 rounded w-fit">
                        Live API Data
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mb-2">{indicator.description}</p>
                    <div className="text-xs text-gray-500 space-y-1">
                      <p><span className="text-gray-400">Category Code:</span> {indicator.categoryCode}</p>
                      <p><span className="text-gray-400">Data Type Code:</span> {indicator.dataTypeCode}</p>
                      <p><span className="text-gray-400">Time Slot:</span> {indicator.timeSlot}</p>
                      <p><span className="text-gray-400">Seasonally Adjusted:</span> {indicator.seasonallyAdj}</p>
                      <p><span className="text-gray-400">Error Data:</span> {indicator.errorData}</p>
                    </div>
                  </div>

                  {/* Middle section - Value */}
                  <div className="flex flex-col items-start lg:items-center gap-1">
                    <span className="text-2xl font-bold">{indicator.value}</span>
                    <span className={`text-sm flex items-center gap-1 ${getChangeColor(indicator.changeType)}`}>
                      {getChangeIcon(indicator.changeType)}
                      {indicator.change}
                    </span>
                  </div>

                  {/* Right section - Metadata */}
                  <div className="flex flex-col lg:items-end text-sm text-gray-400 gap-1">
                    <p><span className="text-gray-500">Period:</span> {indicator.period}</p>
                    <p><span className="text-gray-500">Source:</span> {indicator.source}</p>
                    <p><span className="text-gray-500">Updated:</span> {new Date(indicator.lastUpdated).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredIndicators.length === 0 && !loading && !error && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-lg">No data found matching your criteria</p>
          </div>
        )}

        {/* Raw Data Table */}
        {rawData.length > 0 && (
          <div className="mt-12 bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h2 className="text-xl font-semibold mb-4">Raw API Response Data</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-800">
                    <th className="px-3 py-2 text-left">Cell Value</th>
                    <th className="px-3 py-2 text-left">Time Slot ID</th>
                    <th className="px-3 py-2 text-left">Error Data</th>
                    <th className="px-3 py-2 text-left">Category Code</th>
                    <th className="px-3 py-2 text-left">Seasonally Adj</th>
                    <th className="px-3 py-2 text-left">Data Type Code</th>
                    <th className="px-3 py-2 text-left">Time</th>
                    <th className="px-3 py-2 text-left">US</th>
                  </tr>
                </thead>
                <tbody>
                  {rawData.map((row, index) => (
                    <tr key={index} className={index % 2 === 0 ? "bg-gray-800" : "bg-gray-900"}>
                      <td className="px-3 py-2 font-mono">{row.cellValue}</td>
                      <td className="px-3 py-2 font-mono">{row.timeSlotId}</td>
                      <td className="px-3 py-2">{row.errorData}</td>
                      <td className="px-3 py-2 font-mono">{row.categoryCode}</td>
                      <td className="px-3 py-2">{row.seasonallyAdj}</td>
                      <td className="px-3 py-2 font-mono">{row.dataTypeCode}</td>
                      <td className="px-3 py-2">{row.time}</td>
                      <td className="px-3 py-2">{row.us}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* API Status */}
        <div className="mt-8 bg-green-900/20 border border-green-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-3 text-green-400">Census Bureau API Status</h3>
          <div className="space-y-2 text-sm">
            <p className="text-gray-300">🔗 <span className="text-blue-400">Endpoint:</span> Business Formation Statistics (BFS)</p>
            <p className="text-gray-300">📅 <span className="text-yellow-400">Year:</span> 2024</p>
            <p className="text-gray-300">🎯 <span className="text-purple-400">Scope:</span> National (US) level data</p>
            <p className="text-gray-300">📊 <span className="text-green-400">Status:</span> {loading ? 'Loading...' : error ? 'Error' : 'Loaded'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
