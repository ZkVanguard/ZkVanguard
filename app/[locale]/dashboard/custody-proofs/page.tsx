import { redirect } from '@/i18n/routing';

// Renamed to /dashboard/custody for shorter URLs.
export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  redirect({ href: '/dashboard/custody', locale: params.locale });
}
