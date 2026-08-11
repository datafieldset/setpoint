import Providers from "./providers.jsx";

export const metadata = {
  title: "Setpoint",
  description: "Crypto market data and signals, verified against real price history.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
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
