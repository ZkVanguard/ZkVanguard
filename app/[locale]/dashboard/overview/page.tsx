import { redirect } from 'next/navigation';
// Renamed to /dashboard/portfolio — "overview" collided with the internal
// dashboard tab of the same name and confused users about which was which.
export default function Page() { redirect('/dashboard/portfolio'); }
