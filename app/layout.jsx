import Providers from "./providers.jsx";

export const metadata = {
  title: "Setpoint Alerts",
  description: "Crypto alert terminal. See the alert, the price, and the levels on one card.",
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
