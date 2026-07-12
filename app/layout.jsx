export const metadata = {
  title: "Setpoint",
  description: "Crypto alert terminal. See the alert, the price, and the levels on one card.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
