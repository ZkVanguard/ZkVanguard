import { redirect } from 'next/navigation';
// Legacy route: consolidated under /zk. Preserved as a redirect so bookmarks
// and external inbound links still resolve.
export default function Page() { redirect('/zk/authenticity'); }
