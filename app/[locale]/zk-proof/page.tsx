import { redirect } from '@/i18n/routing';

export default function Page({ params }: { params: { locale: string } }) {
  redirect({ href: '/zk/proof', locale: params.locale });
}
