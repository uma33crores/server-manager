import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type UserRole = 'admin' | 'user' | 'none';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  userRole: UserRole;
  isAdmin: boolean;
  isReadOnly: boolean;
  pendingOtpEmail: string | null;
  reverificationRequired: boolean;
  reverificationOtpLoading: boolean;
  reverificationOtpError: string | null;
  reverificationResendCooldown: boolean;
  requestReverificationOtp: () => Promise<void>;
  verifyReverificationOtp: (token: string) => Promise<{ error: string | null }>;
  resendReverificationOtp: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  resendOtp: (email: string) => Promise<{ error: string | null }>;
  cancelOtp: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const REVERIFICATION_POLL_MS = 10_000;
const RESEND_COOLDOWN_MS = 30_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<UserRole>('none');
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [pendingOtpEmail, setPendingOtpEmail] = useState<string | null>(null);
  const [reverificationRequired, setReverificationRequired] = useState(false);
  const [reverificationOtpLoading, setReverificationOtpLoading] = useState(false);
  const [reverificationOtpError, setReverificationOtpError] = useState<string | null>(null);
  const [reverificationResendCooldown, setReverificationResendCooldown] = useState(false);
  const suppressSessionRef = useRef(false);
  const reverificationRef = useRef(false);

  async function loadRole(userId: string | undefined) {
    if (!userId) {
      setUserRole('none');
      setIsReadOnly(false);
      setReverificationRequired(false);
      reverificationRef.current = false;
      return;
    }
    const { data } = await supabase
      .from('user_roles')
      .select('role, access_type, is_active, reverification_required')
      .eq('user_id', userId)
      .maybeSingle();

    if (data && data.is_active) {
      setUserRole(data.role as UserRole);
      const ro = data.role !== 'admin' && (data as Record<string, unknown>).access_type === 'read_only';
      setIsReadOnly(ro);
      const req = !!data.reverification_required;
      setReverificationRequired(req);
      reverificationRef.current = req;
    } else {
      setUserRole('none');
      setIsReadOnly(false);
      setReverificationRequired(false);
      reverificationRef.current = false;
    }
  }

  async function recordSession(eventType: 'LOGIN' | 'LOGOUT', status: 'SUCCESS' | 'FAILURE' = 'SUCCESS', failureReason?: string) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;
      await supabase.functions.invoke('session-tracker', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          event_type: eventType,
          status,
          failure_reason: failureReason ?? null,
          session_id: sessionData.session?.user?.id ?? null,
        },
      });
    } catch {
      // Session tracking is best-effort; never block login/logout on it
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      await loadRole(session?.user?.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        if (suppressSessionRef.current) return;
        // TOKEN_REFRESHED fires on tab focus — skip all state updates.
        // The Supabase client manages the token internally; no React re-render needed.
        // This prevents page refresh, form data loss, and duplicate OTP sends on tab focus.
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
        setLoading(true);
        setSession(session);
        setUser(session?.user ?? null);
        await loadRole(session?.user?.id);
        setLoading(false);
      })();
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Poll for reverification_required changes (so admin trigger takes effect live)
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      // Skip polling while OTP verification is in progress
      if (reverificationOtpLoading) return;
      const { data } = await supabase
        .from('user_roles')
        .select('reverification_required')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const req = !!data.reverification_required;
        if (req !== reverificationRef.current) {
          setReverificationRequired(req);
          reverificationRef.current = req;
        }
      }
    }, REVERIFICATION_POLL_MS);

    return () => clearInterval(interval);
  }, [user, reverificationOtpLoading]);

  const requestReverificationOtp = async () => {
    if (!user?.email) return;
    setReverificationOtpError(null);
    setReverificationOtpLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: user.email,
        options: { shouldCreateUser: false },
      });
      if (error) {
        setReverificationOtpError(error.message);
      }
    } finally {
      setReverificationOtpLoading(false);
    }
  };

  const verifyReverificationOtp = async (token: string): Promise<{ error: string | null }> => {
    if (!user?.email) return { error: 'No user email found' };
    setReverificationOtpError(null);
    setReverificationOtpLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: user.email,
        token,
        type: 'email',
      });

      if (error) {
        setReverificationOtpError(error.message);
        return { error: error.message };
      }

      // Clear the reverification flag via SECURITY DEFINER function
      const { error: clearError } = await supabase.rpc('clear_reverification', {
        p_user_id: user.id,
      });

      if (clearError) {
        setReverificationOtpError('Verification succeeded but failed to clear status. Please try again.');
        return { error: clearError.message };
      }

      setReverificationRequired(false);
      reverificationRef.current = false;
      return { error: null };
    } finally {
      setReverificationOtpLoading(false);
    }
  };

  const resendReverificationOtp = async () => {
    if (!user?.email) return;
    setReverificationOtpError(null);
    setReverificationResendCooldown(true);
    setTimeout(() => setReverificationResendCooldown(false), RESEND_COOLDOWN_MS);
    const { error } = await supabase.auth.signInWithOtp({
      email: user.email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      setReverificationOtpError(error.message);
    }
  };

  const signIn = async (email: string, password: string) => {
    suppressSessionRef.current = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      suppressSessionRef.current = false;
      return { error: error.message };
    }
    await supabase.auth.signOut();
    suppressSessionRef.current = false;

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (otpError) {
      return { error: otpError.message };
    }
    setPendingOtpEmail(email);
    return { error: null };
  };

  const verifyOtp = async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
      recordSession('LOGIN', 'FAILURE', error.message);
      return { error: error.message };
    }
    // Record reauth timestamp so the 60-minute timer starts at login
    await supabase.rpc('record_own_reauth');
    setPendingOtpEmail(null);
    recordSession('LOGIN', 'SUCCESS');
    return { error: null };
  };

  const resendOtp = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    return { error: error?.message ?? null };
  };

  const cancelOtp = async () => {
    setPendingOtpEmail(null);
  };

  const signOut = async () => {
    recordSession('LOGOUT', 'SUCCESS');
    await supabase.auth.signOut();
    setUserRole('none');
    setIsReadOnly(false);
    setPendingOtpEmail(null);
    setReverificationRequired(false);
    reverificationRef.current = false;
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        userRole,
        isAdmin: userRole === 'admin',
        isReadOnly,
        pendingOtpEmail,
        reverificationRequired,
        reverificationOtpLoading,
        reverificationOtpError,
        reverificationResendCooldown,
        requestReverificationOtp,
        verifyReverificationOtp,
        resendReverificationOtp,
        signIn,
        verifyOtp,
        resendOtp,
        cancelOtp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
