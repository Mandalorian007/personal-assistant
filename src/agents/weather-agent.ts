import 'dotenv/config';
import { z } from 'zod';
import OpenAI from 'openai';
import { BaseOpenAIAgent, ZodTool } from './base-openai-agent.js';

type Location = {
  city: string;
  region: string;
  country: string;
  loc: string;
};

export class WeatherAgent extends BaseOpenAIAgent {
  private readonly openWeatherKey: string;
  private readonly ipInfoToken: string;

  constructor(client: OpenAI) {
    const openWeatherKey = process.env.OPENWEATHER_API_KEY;
    const ipInfoToken = process.env.IPINFO_TOKEN;

    if (!openWeatherKey || !ipInfoToken) {
      throw new Error('OPENWEATHER_API_KEY and IPINFO_TOKEN environment variables are required');
    }

    const zodTools: ZodTool<any>[] = [
      {
        name: 'getCurrentWeather',
        schema: z.object({
          useCurrentLocation: z.boolean().describe('Whether to use current location'),
          location: z.string().describe('City name or coordinates')
        }).required().describe('Get current weather conditions'),
        implementation: async ({ useCurrentLocation, location }) => {
          if (useCurrentLocation) {
            const loc = await this.getCurrentLocation();
            return await this.getWeather(loc);
          }
          return await this.getWeather({ city: location });
        }
      },
      {
        name: 'getForecast',
        schema: z.object({
          useCurrentLocation: z.boolean().describe('Whether to use current location'),
          location: z.string().describe('City name or coordinates'),
          days: z.number().describe('Number of days to forecast (1-5)')
        }).required().describe('Get weather forecast'),
        implementation: async ({ useCurrentLocation, location, days }) => {
          if (useCurrentLocation) {
            const loc = await this.getCurrentLocation();
            return await this.getForecast(loc, days);
          }
          return await this.getForecast({ city: location }, days);
        }
      }
    ];

    super(client, {
      name: 'Weather',
      description: 'A weather agent that can provide current conditions and forecasts for any location',
      systemPrompt: `You are a weather assistant that provides accurate weather information. 
        Always present weather data in a clear, easy to understand format.
        Temperature is in Fahrenheit (°F), wind speed in mph, and pressure in hPa.
        Include important details like precipitation chance when available.`,
      zodTools
    });

    this.openWeatherKey = openWeatherKey;
    this.ipInfoToken = ipInfoToken;
  }

  private async getCurrentLocation(): Promise<Location> {
    const response = await fetch(`https://ipinfo.io/?token=${this.ipInfoToken}`);
    if (!response.ok) {
      throw new Error('Failed to get location from IP');
    }
    return await response.json();
  }

  private async getWeather(location: Partial<Location>): Promise<any> {
    let lat: string, lon: string;
    
    if (location.city) {
      const geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${location.city}&limit=1&appid=${this.openWeatherKey}`;
      const geoResponse = await fetch(geoUrl);
      if (!geoResponse.ok) {
        throw new Error('Failed to geocode city');
      }
      const [geoData] = await geoResponse.json();
      if (!geoData) {
        throw new Error('City not found');
      }
      lat = geoData.lat;
      lon = geoData.lon;
    } else if (location.loc) {
      [lat, lon] = location.loc.split(',');
    } else {
      throw new Error('No valid location provided');
    }

    // Only get current weather
    const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=hourly,daily,minutely,alerts&units=imperial&appid=${this.openWeatherKey}`;
    console.log('Weather URL:', url);
    
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Weather API error details:', errorText);
      throw new Error(`Weather API error: ${response.statusText}`);
    }
    const data = await response.json();
    
    return {
      location: location.city || `${location.region}, ${location.country}`,
      temperature: {
        value: data.current.temp,
        unit: '°F'
      },
      feels_like: {
        value: data.current.feels_like,
        unit: '°F'
      },
      humidity: {
        value: data.current.humidity,
        unit: '%'
      },
      pressure: {
        value: data.current.pressure,
        unit: 'hPa'
      },
      description: data.current.weather[0].description,
      windSpeed: {
        value: data.current.wind_speed,
        unit: 'mph'
      },
      uvi: {
        value: data.current.uvi,
        unit: 'index'
      },
      visibility: {
        value: data.current.visibility,
        unit: 'meters'
      }
    };
  }

  private async getForecast(location: Partial<Location>, days: number): Promise<any> {
    let lat: string, lon: string;
    
    if (location.city) {
      const geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${location.city}&limit=1&appid=${this.openWeatherKey}`;
      const geoResponse = await fetch(geoUrl);
      if (!geoResponse.ok) {
        throw new Error('Failed to geocode city');
      }
      const [geoData] = await geoResponse.json();
      if (!geoData) {
        throw new Error('City not found');
      }
      lat = geoData.lat;
      lon = geoData.lon;
    } else if (location.loc) {
      [lat, lon] = location.loc.split(',');
    } else {
      throw new Error('No valid location provided');
    }

    // Only get daily forecast
    const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=current,hourly,minutely,alerts&units=imperial&appid=${this.openWeatherKey}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Weather API error details:', errorText);
      throw new Error(`Weather API error: ${response.statusText}`);
    }
    const data = await response.json();
    
    return {
      location: location.city || `${location.region}, ${location.country}`,
      forecast: data.daily.slice(0, days).map((day: any) => ({
        date: new Date(day.dt * 1000).toLocaleDateString(),
        temperature: {
          min: {
            value: day.temp.min,
            unit: '°F'
          },
          max: {
            value: day.temp.max,
            unit: '°F'
          }
        },
        humidity: {
          value: day.humidity,
          unit: '%'
        },
        pressure: {
          value: day.pressure,
          unit: 'hPa'
        },
        description: day.weather[0].description,
        windSpeed: {
          value: day.wind_speed,
          unit: 'mph'
        },
        precipitation: {
          value: day.pop * 100,
          unit: '%'
        }
      }))
    };
  }
} 