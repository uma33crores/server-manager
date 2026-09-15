import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Server, ShieldAlert, ArrowLeft } from 'lucide-react';

export default function ReverificationPage() {
  const {
    user,
    reverificationOtpLoading,
    reverificationOtpError,
    reverificationResendCooldown,
    requestReverificationOtp,
    verifyReverificationOtp,
    resendReverificationOtp,
    signOut,
  } = useAuth();

  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // Automatically send OTP when the page loads
  useEffect(() => {
    if (!otpSent) {
      setOtpSent(true);
      requestReverificationOtp();
    }
  }, [otpSent, requestReverificationOtp]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    await verifyReverificationOtp(otp);
  };

  const handleResend = async () => {
    if (reverificationResendCooldown) return;
    await resendReverificationOtp();
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-lg bg-amber-600 flex items-center justify-center">
            <ShieldAlert className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Re-Verification Required</h1>
            <p className="text-sm text-text-muted">Server Manager</p>
          </div>
        </div>

        <div className="bg-surface-2 border border-amber-500/30 rounded-lg p-6">
          <div className="flex items-start gap-3 mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-text-secondary font-medium">
                Your account requires re-verification
              </p>
              <p className="text-xs text-text-muted mt-1">
                An administrator has requested that you verify your identity. You cannot access
                the application until you enter the verification code sent to your email.
              </p>
            </div>
          </div>

          <p className="text-sm text-text-muted mb-4">
            We sent an 8-digit code to{' '}
            <span className="text-text-secondary font-medium">{user?.email}</span>
          </p>

          <form onSubmit={handleVerify} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{8}"
              maxLength={8}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
              placeholder="12345678"
              className="w-full px-3 py-3 bg-surface border border-border rounded-md text-text-primary text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            {reverificationOtpError && (
              <div className="alert-error justify-center">
                {reverificationOtpError}
              </div>
            )}
            <button
              type="submit"
              disabled={reverificationOtpLoading || otp.length !== 8}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-md font-medium transition-colors"
            >
              {reverificationOtpLoading ? 'Verifying...' : 'Verify & Continue'}
            </button>
          </form>

          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Sign Out
            </button>
            <button
              onClick={handleResend}
              disabled={reverificationResendCooldown || reverificationOtpLoading}
              className="text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {reverificationResendCooldown ? 'Resend in 30s' : 'Resend Code'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-text-faint">
          <Server className="w-3.5 h-3.5" />
          Server Manager — Secure Infrastructure Access
        </div>
      </div>
    </div>
  );
}
