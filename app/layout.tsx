// Root layout - now delegates to [locale]/layout.tsx
// This file should not import styles or providers

// This is now just a simple redirect handler
// Actual layout is in [locale]/layout.tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
