import { redirect } from '@/i18n/routing';

// Legacy route: consolidated under /zk. Preserved as a redirect so bookmarks
// and external inbound links still resolve.
export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  redirect({ href: '/zk/authenticity', locale: params.locale });
}
