# WeatherCard Component

A React component that fetches and displays weather data from the Open-Meteo API for San Francisco, showing temperature in Fahrenheit and wind speed in miles per hour.

## Features

- 🌡️ **Temperature Display**: Shows current temperature in Fahrenheit (°F)
- 💨 **Wind Speed**: Displays wind speed in miles per hour (mph)
- ⏳ **Loading State**: Animated loading indicator while fetching data
- ⚠️ **Error Handling**: User-friendly error messages with retry option
- 🔄 **Refresh Button**: Manual refresh to get the latest weather data
- 🎨 **Tailwind Styling**: Beautiful gradient design with responsive layout

## Installation

### Prerequisites

- React 16.8+ (uses hooks)
- Tailwind CSS configured in your project
- Vitest and React Testing Library (for testing)

### Setup

1. Copy `WeatherCard.jsx` and `WeatherCard.test.jsx` to your project

2. Ensure you have the required dependencies:

```bash
npm install react react-dom
npm install -D vitest @testing-library/react @testing-library/jest-dom
```

3. Make sure Tailwind CSS is configured in your project

## Usage

### Basic Usage

```jsx
import WeatherCard from './WeatherCard';

function App() {
  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <WeatherCard />
    </div>
  );
}
```

### Multiple Locations

To use the component with different locations, you can modify the `LATITUDE` and `LONGITUDE` constants in the component:

```jsx
// Example: New York City
const LATITUDE = 40.7128;
const LONGITUDE = -74.0060;
```

## Component Structure

```
WeatherCard/
├── WeatherCard.jsx         # Main component
├── WeatherCard.test.jsx    # Test suite
└── README.md               # Documentation
```

## API Reference

The component uses the Open-Meteo API:

```
https://api.open-meteo.com/v1/forecast?latitude=37.7749&longitude=-122.4194&current=temperature_2m,wind_speed_10m
```

### Response Format

```json
{
  "current": {
    "time": "2024-01-01T12:00",
    "temperature_2m": 15.5,
    "wind_speed_10m": 12.3
  }
}
```

### Unit Conversions

- **Temperature**: Celsius to Fahrenheit using `Math.round((celsius * 9/5) + 32)`
- **Wind Speed**: km/h to mph using `Math.round(kmh * 0.621371)`

## Testing

Run the tests using Vitest:

```bash
# Run tests once
npx vitest run

# Run tests in watch mode
npx vitest

# Run with coverage
npx vitest run --coverage
```

### Test Coverage

The test suite covers:
- Component rendering
- Loading state display
- Successful data fetching and display
- Error state handling
- API error responses
- Unit conversions (temperature and wind speed)
- Refresh functionality
- Retry functionality

## State Management

The component uses React's built-in `useState` and `useEffect` hooks:

- `weather`: Stores the converted weather data
- `loading`: Boolean indicating fetch status
- `error`: Error message string or null

## Styling

The component uses Tailwind CSS classes for styling:

- **Container**: `bg-gradient-to-br from-blue-400 to-blue-600`
- **Shadow**: `shadow-lg`
- **Rounded corners**: `rounded-lg`
- **Padding**: `p-6`
- **Text**: `text-white` with `text-blue-100` for secondary text

## Accessibility

- Refresh button has `aria-label="Refresh weather data"`
- Error messages are clearly displayed
- Loading state is visually indicated
- Color contrast meets accessibility standards

## Browser Support

Works in all modern browsers that support:
- Fetch API
- ES6+ JavaScript features
- Tailwind CSS (requires PostCSS/autoprefixer)

## License

MIT License - feel free to use and modify as needed.

## Troubleshooting

### Common Issues

1. **CORS errors**: The Open-Meteo API supports CORS, but if you encounter issues, ensure your development server is configured correctly.

2. **Tests failing**: Make sure you have all required testing dependencies installed and configured.

3. **Tailwind styles not applying**: Verify Tailwind CSS is properly configured in your project.

## Future Enhancements

- [ ] Add support for multiple locations via props
- [ ] Add 7-day forecast display
- [ ] Add weather icons based on conditions
- [ ] Add auto-refresh interval
- [ ] Add temperature unit toggle (°F/°C)
