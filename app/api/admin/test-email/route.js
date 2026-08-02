// app/api/admin/test-email/route.js
//
// Sends a real test email to the logged-in admin and returns exactly what
// Resend said back, success or the real failure reason. Built because
// register/route.js sends the welcome email fire-and-forget, which is
// correct for never blocking a real signup, but it also means there was
// no way to actually see why a send failed. This is that visibility.
import { auth } from "../../../../auth.js";
import { sendEmail, welcomeEmailHtml } from "../../../../lib/email.js";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    return Response.json({ error: "not_admin" }, { status: 403 });
  }
  const result = await sendEmail({
    to: session.user.email,
    subject: "Setpoint test email",
    html: welcomeEmailHtml(session.user.email),
  });
  return Response.json(result);
}
