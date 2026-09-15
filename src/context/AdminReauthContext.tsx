import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

type ReauthState = {
  isReauthed: boolean;
  reauthExpired: boolean;
  timeRemainingMs: number;
  loading: boolean;
  otpLoading: boolean;
  otpError: string | null;
  showOtpModal: boolean;
  resendCooldown: boolean;
  checkReauth: () => Promise<boolean>;
  requestOtp: () => Promise<void>;
  verifyOtp: (token: string) => Promise<boolean>;
  resendOtp: () => Promise<void>;
  cancelOtp: () => void;
};

const REAUTH_CONTEXT = createContext<ReauthState | undefined>(undefined);

const REAUTH_WINDOW_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30_000;
const REAUTH_STORAGE_KEY = 'reauth_timestamp';

function getStoredTimestamp(): number | null {
  try {
    const v = localStorage.getItem(REAUTH_STORAGE_KEY);
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

function storeTimestamp(ts: number) {
  try {
    localStorage.setItem(REAUTH_STORAGE_KEY, String(ts));
  } catch {
    // ignore
  }
}

function clearStoredTimestamp() {
  try {
    localStorage.removeItem(REAUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function AdminReauthProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [reauthenticatedAt, setReauthenticatedAt] = useState<number | null>(null);
  const [timeRemainingMs, setTimeRemainingMs] = useState(REAUTH_WINDOW_MS);
  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reauthExpired = reauthenticatedAt !== null && Date.now() - reauthenticatedAt >= REAUTH_WINDOW_MS;
  const isReauthed = reauthenticatedAt !== null && !reauthExpired;

  const checkReauth = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('admin_reauth_sessions')
        .select('reauthenticated_at')
        .eq('admin_id', user.id)
        .maybeSingle();

      if (data?.reauthenticated_at) {
        const ts = new Date(data.reauthenticated_at).getTime();
        setReauthenticatedAt(ts);
        storeTimestamp(ts);
        return Date.now() - ts < REAUTH_WINDOW_MS;
      }
      setReauthenticatedAt(null);
      clearStoredTimestamp();
      return false;
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // On mount: restore from localStorage first (instant, survives refresh), then sync with DB
  // Depends on user?.id (string) not user (object) to avoid re-firing on token refresh
  useEffect(() => {
    if (!user?.id) {
      setReauthenticatedAt(null);
      clearStoredTimestamp();
      return;
    }

    const stored = getStoredTimestamp();
    if (stored && Date.now() - stored < REAUTH_WINDOW_MS) {
      setReauthenticatedAt(stored);
    }
    // Always sync with DB in background
    checkReauth();
  }, [user?.id, checkReauth]);

  // Live countdown timer
  useEffect(() => {
    if (reauthenticatedAt === null) return;

    const update = () => {
      const elapsed = Date.now() - reauthenticatedAt;
      const remaining = REAUTH_WINDOW_MS - elapsed;
      setTimeRemainingMs(remaining);

      if (remaining <= 0) {
        setTimeRemainingMs(0);
        if (tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
      }
    };

    update();
    tickRef.current = setInterval(update, 1000);

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [reauthenticatedAt]);

  // Auto-show OTP modal when timer expires — but only once per expiry
  // to prevent duplicate OTP sends on tab focus or re-renders
  const autoOtpSentRef = useRef(false);
  useEffect(() => {
    if (reauthExpired && user && !showOtpModal && !autoOtpSentRef.current) {
      autoOtpSentRef.current = true;
      requestOtp();
    }
    if (!reauthExpired) {
      autoOtpSentRef.current = false;
    }
  }, [reauthExpired]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestOtp = useCallback(async () => {
    if (!user?.email) return;
    setOtpError(null);
    setOtpLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: user.email,
        options: { shouldCreateUser: false },
      });
      if (error) {
        setOtpError(error.message);
        return;
      }
      setShowOtpModal(true);
    } finally {
      setOtpLoading(false);
    }
  }, [user?.email]);

  const verifyOtp = useCallback(async (token: string): Promise<boolean> => {
    if (!user?.email) return false;
    setOtpError(null);
    setOtpLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: user.email,
        token,
        type: 'email',
      });

      if (error) {
        setOtpError(error.message);
        return false;
      }

      // Record reauth timestamp via SECURITY DEFINER function
      const { error: rpcError } = await supabase.rpc('record_own_reauth');

      if (rpcError) {
        setOtpError('Verification succeeded but failed to persist session. Please try again.');
        return false;
      }

      const now = Date.now();
      setReauthenticatedAt(now);
      storeTimestamp(now);
      setShowOtpModal(false);
      return true;
    } finally {
      setOtpLoading(false);
    }
  }, [user?.email]);

  const resendOtp = useCallback(async () => {
    if (!user?.email) return;
    setOtpError(null);
    setResendCooldown(true);
    setTimeout(() => setResendCooldown(false), RESEND_COOLDOWN_MS);
    const { error } = await supabase.auth.signInWithOtp({
      email: user.email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      setOtpError(error.message);
    }
  }, [user?.email]);

  const cancelOtp = useCallback(() => {
    setShowOtpModal(false);
    setOtpError(null);
  }, []);

  return (
    <REAUTH_CONTEXT.Provider
      value={{
        isReauthed,
        reauthExpired,
        timeRemainingMs,
        loading,
        otpLoading,
        otpError,
        showOtpModal,
        resendCooldown,
        checkReauth,
        requestOtp,
        verifyOtp,
        resendOtp,
        cancelOtp,
      }}
    >
      {children}
    </REAUTH_CONTEXT.Provider>
  );
}

export function useAdminReauth() {
  const ctx = useContext(REAUTH_CONTEXT);
  if (!ctx) throw new Error('useAdminReauth must be used within AdminReauthProvider');
  return ctx;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
