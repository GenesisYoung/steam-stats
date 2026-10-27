export interface AuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string | undefined;
  /** Seconds since epoch of the last interactive sign-in. */
  authTime: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
