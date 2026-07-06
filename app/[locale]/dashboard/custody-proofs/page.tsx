import { redirect } from 'next/navigation';
// Renamed to /dashboard/custody for shorter URLs.
export default function Page() { redirect('/dashboard/custody'); }
