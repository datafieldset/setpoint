import Providers from "./providers.jsx";

export const metadata = {
  title: "Setpoint",
  description: "Crypto moves fast. Setpoint watches it for you and sends an alert the second something real happens, with the entry, stop, and target already drawn on it.",
  manifest: "/manifest.json",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Setpoint" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A0F0D",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
