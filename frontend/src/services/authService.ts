import {
  EmailAuthProvider, createUserWithEmailAndPassword, reauthenticateWithCredential, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile, type User,
} from 'firebase/auth';
import { auth } from './firebase';

const actionSettings = () => ({ url: `${window.location.origin}/login` });

export const authService = {
  async register(email: string, password: string, displayName: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    await sendEmailVerification(cred.user, actionSettings());
    return cred.user;
  },
  login: (email: string, password: string) => signInWithEmailAndPassword(auth, email, password),
  logout: () => signOut(auth),
  resetPassword: (email: string) => sendPasswordResetEmail(auth, email, actionSettings()),
  resendVerification: (user: User) => sendEmailVerification(user, actionSettings()),
  /** Required before account deletion (backend checks auth_time). */
  async reauthenticate(password: string) {
    const user = auth.currentUser;
    if (!user?.email) throw new Error('Not signed in');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    await user.getIdToken(true);
  },
};

/** Map Firebase Auth error codes to i18n keys. */
export function authErrorKey(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'auth.errors.invalidCredential',
    'auth/wrong-password': 'auth.errors.invalidCredential',
    'auth/user-not-found': 'auth.errors.invalidCredential',
    'auth/invalid-email': 'auth.errors.invalidEmail',
    'auth/email-already-in-use': 'auth.errors.emailInUse',
    'auth/weak-password': 'auth.errors.weakPassword',
    'auth/too-many-requests': 'auth.errors.tooManyRequests',
    'auth/network-request-failed': 'errors.network',
    'auth/requires-recent-login': 'auth.errors.recentLogin',
  };
  return map[code] ?? 'errors.generic';
}
