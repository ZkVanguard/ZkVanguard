import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

export async function IntlProvider({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: string;
}) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
