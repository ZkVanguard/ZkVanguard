import { redirect } from '@/i18n/routing';

// Renamed to /dashboard/custody for shorter URLs.
export default function Page({ params }: { params: { locale: string } }) {
  redirect({ href: '/dashboard/custody', locale: params.locale });
}
