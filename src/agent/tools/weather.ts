import { getConfig } from '../../lib/config.js';
import type { ToolDefinition } from './index.js';

interface WeatherItem {
  dt_txt: string;
  main: { temp: number; feels_like: number; humidity: number };
  weather: Array<{ description: string }>;
}

interface ForecastResponse {
  city?: { name?: string; country?: string };
  list?: WeatherItem[];
  cod?: string | number;
  message?: string;
}

export const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description:
    'Get current weather and a 3-day forecast for a location. Defaults to Melbourne, Australia if no location is given.',
  input_schema: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name, optionally with country code e.g. "Melbourne,AU"',
      },
    },
    required: [],
  },
  async run(input) {
    const location = (input['location'] as string | undefined) ?? 'Melbourne,AU';
    const config = getConfig();

    if (!config.OPENWEATHER_API_KEY) {
      return 'Weather is not configured. Add OPENWEATHER_API_KEY to your .env (free key at openweathermap.org/api).';
    }

    const url =
      `https://api.openweathermap.org/data/2.5/forecast` +
      `?q=${encodeURIComponent(location)}&appid=${config.OPENWEATHER_API_KEY}&units=metric&cnt=24`;

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`OpenWeatherMap error ${resp.status}: ${resp.statusText}`);
    }

    const data = (await resp.json()) as ForecastResponse;

    if (data.cod && String(data.cod) !== '200') {
      throw new Error(`Weather API: ${data.message ?? 'unknown error'}`);
    }

    const items = data.list ?? [];
    if (items.length === 0) return 'No forecast data available.';

    const cityName = `${data.city?.name ?? location}${data.city?.country ? ', ' + data.city.country : ''}`;

    // Group by day
    const days: Record<string, WeatherItem[]> = {};
    for (const item of items) {
      const day = item.dt_txt.split(' ')[0]!;
      if (!days[day]) days[day] = [];
      days[day]!.push(item);
    }

    const lines: string[] = [`Weather for ${cityName}:`];
    for (const [day, dayItems] of Object.entries(days).slice(0, 4)) {
      const temps = dayItems.map(i => i.main.temp);
      const minTemp = Math.min(...temps).toFixed(0);
      const maxTemp = Math.max(...temps).toFixed(0);
      const desc = dayItems[Math.floor(dayItems.length / 2)]?.weather[0]?.description ?? '';
      lines.push(`  ${day}: ${minTemp}–${maxTemp}°C, ${desc}`);
    }

    return lines.join('\n');
  },
};
