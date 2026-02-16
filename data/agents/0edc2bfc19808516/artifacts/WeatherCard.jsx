import React, { useState, useEffect, useCallback } from 'react';

// Open-Meteo API response types
// {
//   "current": {
//     "time": "2024-01-01T12:00",
//     "temperature_2m": 15.5,
//     "wind_speed_10m": 12.3
//   }
// }

const WeatherCard = () => {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // San Francisco coordinates (default)
  const LATITUDE = 37.7749;
  const LONGITUDE = -122.4194;

  // Convert Celsius to Fahrenheit
  const celsiusToFahrenheit = (celsius) => {
    return Math.round((celsius * 9 / 5) + 32);
  };

  // Convert km/h to mph
  const kmhToMph = (kmh) => {
    return Math.round(kmh * 0.621371);
  };

  const fetchWeather = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${LATITUDE}&longitude=${LONGITUDE}&current=temperature_2m,wind_speed_10m`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Convert units
      const weatherData = {
        temperature: celsiusToFahrenheit(data.current.temperature_2m),
        windSpeed: kmhToMph(data.current.wind_speed_10m),
        timestamp: data.current.time
      };

      setWeather(weatherData);
    } catch (err) {
      setError(err.message || 'Failed to fetch weather data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch weather on component mount
  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  // Loading state
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 max-w-sm mx-auto">
        <div className="flex items-center justify-center space-x-2">
          <div className="w-4 h-4 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
          <div className="w-4 h-4 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
          <div className="w-4 h-4 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
        </div>
        <p className="text-center text-gray-600 mt-3">Loading weather data...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 max-w-sm mx-auto border-l-4 border-red-500">
        <div className="flex items-center mb-4">
          <svg className="w-6 h-6 text-red-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-lg font-semibold text-gray-800">Error</h3>
        </div>
        <p className="text-gray-600 mb-4">{error}</p>
        <button
          onClick={fetchWeather}
          className="w-full bg-red-500 hover:bg-red-600 text-white font-medium py-2 px-4 rounded transition duration-200"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Success state with weather data
  return (
    <div className="bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg shadow-lg p-6 max-w-sm mx-auto text-white">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-2xl font-bold">San Francisco</h2>
          <p className="text-blue-100 text-sm">Current Weather</p>
        </div>
        <button
          onClick={fetchWeather}
          disabled={loading}
          className="p-2 bg-white/20 hover:bg-white/30 rounded-full transition duration-200 disabled:opacity-50"
          aria-label="Refresh weather data"
        >
          <svg 
            className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {weather && (
        <div className="space-y-4">
          {/* Temperature */}
          <div className="flex items-center">
            <svg className="w-12 h-12 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <div>
              <p className="text-4xl font-bold">{weather.temperature}°F</p>
              <p className="text-blue-100 text-sm">Temperature</p>
            </div>
          </div>

          {/* Wind Speed */}
          <div className="flex items-center">
            <svg className="w-10 h-10 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-2xl font-semibold">{weather.windSpeed} mph</p>
              <p className="text-blue-100 text-sm">Wind Speed</p>
            </div>
          </div>

          {/* Last Updated */}
          <p className="text-blue-200 text-xs mt-4 text-center">
            Last updated: {new Date(weather.timestamp).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
};

export default WeatherCard;
