import GoogleProvider from 'next-auth/providers/google';
import { upsertUser } from './db-server';

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || 'mock-google-client-id',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'mock-google-client-secret',
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account && account.provider === 'google') {
        try {
          const userId = user.id || profile?.sub || emailToId(user.email);
          // Sync user to database (Postgres or fallback JSON)
          await upsertUser({
            id: userId,
            name: user.name || '',
            email: user.email || '',
            image: user.image || '',
          });
          return true;
        } catch (e) {
          console.error('Error syncing user in sign-in callback:', e);
          return true; // Proceed with login anyway
        }
      }
      return true;
    },
    async jwt({ token, user, account, profile }) {
      if (user) {
        token.id = user.id || profile?.sub || emailToId(user.email);
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET || 'manga2novel-nextauth-session-secret-change-me-in-production',
  pages: {
    signIn: '/', // Redirect back to homepage
    error: '/',
  }
};

function emailToId(email) {
  if (!email) return 'unknown';
  return 'usr_' + email.replace(/[^a-zA-Z0-9]/g, '_');
}
export default authOptions;
