export type CalendarWeather = {
  city: string;
  temperature: number;
  min: number;
  max: number;
  code: number;
  label: string;
  emoji: string;
};

const CITY_KEY = 'polaris:calendar-city:v1';
const WEATHER_CACHE_PREFIX = 'polaris:calendar-weather:v1:';
const DEFAULT_CITY = '上海';

export function readCalendarCity() {
  if (typeof window === 'undefined') return DEFAULT_CITY;
  return window.localStorage.getItem(CITY_KEY)?.trim() || DEFAULT_CITY;
}

export function writeCalendarCity(city: string) {
  if (typeof window === 'undefined') return;
  const normalized = city.trim() || DEFAULT_CITY;
  window.localStorage.setItem(CITY_KEY, normalized);
  window.dispatchEvent(new CustomEvent('polaris:calendar-city-updated', { detail: normalized }));
}

export function calendarWeatherMetaFromCode(code: number) {
  if (code === 0) return { label: '晴', emoji: '☀️' };
  if (code <= 3) return { label: '多云', emoji: '⛅' };
  if (code === 45 || code === 48) return { label: '有雾', emoji: '🌫️' };
  if (code >= 51 && code <= 57) return { label: '毛毛雨', emoji: '🌦️' };
  if (code >= 61 && code <= 67) return { label: '雨', emoji: '🌧️' };
  if (code >= 71 && code <= 77) return { label: '雪', emoji: '🌨️' };
  if (code >= 80 && code <= 82) return { label: '阵雨', emoji: '🌦️' };
  if (code >= 85 && code <= 86) return { label: '阵雪', emoji: '🌨️' };
  if (code >= 95) return { label: '雷雨', emoji: '⛈️' };
  return { label: '天气', emoji: '🌤️' };
}

export type CalendarWeatherOverride = {
  code: number;
  label: string;
  emoji: string;
  temperature?: number;
};

const WEATHER_OVERRIDE_PREFIX = 'polaris:calendar-weather-override:v1:';

function weatherOverrideKey(city: string, date: string) {
  return `${WEATHER_OVERRIDE_PREFIX}${city.trim() || DEFAULT_CITY}:${date}`;
}

export function readCalendarWeatherOverride(city: string, date: string) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(weatherOverrideKey(city, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CalendarWeatherOverride>;
    const code = typeof parsed.code === 'number' ? parsed.code : 0;
    const meta = calendarWeatherMetaFromCode(code);
    return {
      code,
      label: parsed.label?.trim() || meta.label,
      emoji: parsed.emoji?.trim() || meta.emoji,
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : undefined
    } satisfies CalendarWeatherOverride;
  } catch {
    return null;
  }
}

export function writeCalendarWeatherOverride(
  city: string,
  date: string,
  patch: Partial<CalendarWeatherOverride>
) {
  if (typeof window === 'undefined') return;
  const current = readCalendarWeatherOverride(city, date) ?? {
    code: 0,
    ...calendarWeatherMetaFromCode(0)
  };
  const next: CalendarWeatherOverride = {
    ...current,
    ...patch,
    code: typeof patch.code === 'number' ? patch.code : current.code
  };
  const meta = calendarWeatherMetaFromCode(next.code);
  next.label = patch.label?.trim() || meta.label;
  next.emoji = patch.emoji?.trim() || meta.emoji;
  window.localStorage.setItem(weatherOverrideKey(city, date), JSON.stringify(next));
}

function localDateIso(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchTodayWeather(cityInput: string, now = new Date()): Promise<CalendarWeather> {
  const city = cityInput.trim() || DEFAULT_CITY;
  const date = localDateIso(now);
  const cacheKey = `${WEATHER_CACHE_PREFIX}${city}:${date}`;
  if (typeof window !== 'undefined') {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached) as CalendarWeather;
    } catch {
      // Ignore malformed cache.
    }
  }

  const geocode = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`
  ) as { results?: Array<{ latitude: number; longitude: number; name: string }> };
  const location = geocode.results?.[0];
  if (!location) throw new Error('没有找到这个城市。');

  const forecast = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}` +
    '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code' +
    '&timezone=auto&forecast_days=1'
  ) as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; weather_code?: number[] };
  };
  const code = Number(forecast.current?.weather_code ?? forecast.daily?.weather_code?.[0] ?? 0);
  const meta = calendarWeatherMetaFromCode(code);
  const weather: CalendarWeather = {
    city: location.name || city,
    temperature: Number(forecast.current?.temperature_2m ?? 0),
    min: Number(forecast.daily?.temperature_2m_min?.[0] ?? 0),
    max: Number(forecast.daily?.temperature_2m_max?.[0] ?? 0),
    code,
    label: meta.label,
    emoji: meta.emoji
  };

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify(weather));
    } catch {
      // Best effort cache.
    }
  }
  return weather;
}
