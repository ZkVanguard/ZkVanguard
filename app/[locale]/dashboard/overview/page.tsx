import { redirect } from '@/i18n/routing';

// Renamed to /dashboard/portfolio — "overview" collided with the internal
// dashboard tab of the same name and confused users about which was which.
export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  redirect({ href: '/dashboard/portfolio', locale: params.locale });
}
