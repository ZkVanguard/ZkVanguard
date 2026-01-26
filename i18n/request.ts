import { getRequestConfig } from 'next-intl/server';
import { routing, locales, defaultLocale, localeNames } from './routing';
import type { Locale } from './routing';

// Re-export from routing for backward compatibility
export { locales, defaultLocale, localeNames };
export type { Locale };

export default getRequestConfig(async ({ requestLocale }) => {
  // Get the locale from the request
  let locale = await requestLocale;
  
  // Validate and fallback to default
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
