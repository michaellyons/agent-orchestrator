import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WeatherCard from './WeatherCard';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('WeatherCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without errors', () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        current: {
          time: '2024-01-01T12:00:00',
          temperature_2m: 15.5,
          wind_speed_10m: 12.3
        }
      })
    });

    render(<WeatherCard />);
    expect(screen.getByText('Loading weather data...')).toBeInTheDocument();
  });

  it('displays weather data correctly after fetching', async () => {
    // 15.5°C = 60°F (rounded), 12.3 km/h = 8 mph (rounded)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        current: {
          time: '2024-01-01T12:00:00',
          temperature_2m: 15.5,
          wind_speed_10m: 12.3
        }
      })
    });

    render(<WeatherCard />);

    await waitFor(() => {
      expect(screen.getByText('San Francisco')).toBeInTheDocument();
      expect(screen.getByText('60°F')).toBeInTheDocument();
      expect(screen.getByText('8 mph')).toBeInTheDocument();
    });
  });

  it('shows loading state while fetching', async () => {
    // Delay the fetch to test loading state
    mockFetch.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        json: () => Promise.resolve({
          current: {
            time: '2024-01-01T12:00:00',
            temperature_2m: 20,
            wind_speed_10m: 10
          }
        })
      }), 100))
    );

    render(<WeatherCard />);

    expect(screen.getByText('Loading weather data...')).toBeInTheDocument();
    
    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('San Francisco')).toBeInTheDocument();
    }, { timeout: 200 });
  });

  it('displays error state when API fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<WeatherCard />);

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('displays error state when API returns non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500
    });

    render(<WeatherCard />);

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('HTTP error! status: 500')).toBeInTheDocument();
    });
  });

  it('has a refresh button', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        current: {
          time: '2024-01-01T12:00:00',
          temperature_2m: 15.5,
          wind_speed_10m: 12.3
        }
      })
    });

    render(<WeatherCard />);

    await waitFor(() => {
      const refreshButton = screen.getByLabelText('Refresh weather data');
      expect(refreshButton).toBeInTheDocument();
    });
  });

  it('refreshes data when refresh button is clicked', async () => {
    // First fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        current: {
          time: '2024-01-01T12:00:00',
          temperature_2m: 15.5,
          wind_speed_10m: 12.3
        }
      })
    });

    render(<WeatherCard />);

    await waitFor(() => {
      expect(screen.getByText('60°F')).toBeInTheDocument();
    });

    // Second fetch (after refresh)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        current: {
          time: '2024-01-01T13:00:00',
          temperature_2m: 18.0,
          wind_speed_10m: 15.0
        }
      })
    });

    const refreshButton = screen.getByLabelText('Refresh weather data');
    fireEvent.click(refreshButton);

    await waitFor(() => {
      // 18.0°C = 64°F, 15.0 km/h = 9 mph
      expect(screen.getByText('64°F')).toBeInTheDocument();
      expect(screen.getByText('9 mph')).toBeInTheDocument();
    });

    // Verify fetch was called twice
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('correctly converts Celsius to Fahrenheit', async () => {
    // 0°C = 32°F
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        current: {
          time: '2024-01-01T12:00:00',
          temperature_2m: 0,
          wind_speed_10m: 10
        }
      })
    });

    render(<WeatherCard />);

    await waitFor(() => {
      expect(screen.getByText('32°F')).toBeInTheDocument();
    });
  });

  it('correctly converts km/h to mph', async () => {
    // 16.09 km/h ≈ 10 mph
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        current: {
          time: '2024-01-01T12:00:00',
          temperature_2m: 20,
          wind_speed_10m: 16.09
        }
      })
    });

    render(<WeatherCard />);

    await waitFor(() => {
      expect(screen.getByText('10 mph')).toBeInTheDocument();
    });
  });

  it('shows try again button in error state', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<WeatherCard />);

    await waitFor(() => {
      const tryAgainButton = screen.getByText('Try Again');
      expect(tryAgainButton).toBeInTheDocument();
    });
  });

  it('retries fetch when try again button is clicked', async () => {
    // First fetch fails
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<WeatherCard />);

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    // Second fetch succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        current: {
          time: '2024-01-01T12:00:00',
          temperature_2m: 20,
          wind_speed_10m: 10
        }
      })
    });

    const tryAgainButton = screen.getByText('Try Again');
    fireEvent.click(tryAgainButton);

    await waitFor(() => {
      expect(screen.getByText('San Francisco')).toBeInTheDocument();
      expect(screen.getByText('68°F')).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
