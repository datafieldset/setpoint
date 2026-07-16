// auth.js (project root, required location for Auth.js v5)
//
// Email/password only, so no OAuth adapter is needed. Auth.js just manages
// the signed session cookie; our own `users` table in Neon is the source of
// truth for accounts. Auth.js does not hash or verify passwords for you,
// that part is ours, done with bcryptjs in the authorize() callback below.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

async function findUserByEmail(email) {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  const sql = neon(conn);
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'watch',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  const rows = await sql`SELECT id, email, password_hash, plan FROM users WHERE email = ${email.toLowerCase()}`;
  return rows[0] || null;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days of no activity before a real logout
    updateAge: 24 * 60 * 60,   // refresh the session on any visit within 24h,
                                // so normal use keeps you signed in indefinitely
  },
  pages: {
    signIn: "/", // Setpoint has its own in-app auth screens, not a separate route
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        try {
          const user = await findUserByEmail(credentials.email);
          if (!user) return null;
          const ok = await bcrypt.compare(credentials.password, user.password_hash);
          if (!ok) return null;
          return { id: String(user.id), email: user.email, plan: user.plan };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.plan = user.plan; }
      return token;
    },
    async session({ session, token }) {
      if (session.user) { session.user.plan = token.plan || "watch"; }
      return session;
    },
  },
});
