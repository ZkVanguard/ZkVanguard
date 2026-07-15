import { redirect } from '@/i18n/routing';

// Legacy route: consolidated under /zk. Preserved as a redirect so bookmarks
// and external inbound links still resolve.
export default function Page({ params }: { params: { locale: string } }) {
  redirect({ href: '/zk/authenticity', locale: params.locale });
}
