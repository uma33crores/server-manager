import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Server, ShieldCheck, ArrowLeft } from 'lucide-react';

export default function Login() {
  const { signIn, verifyOtp, resendOtp, cancelOtp, pendingOtpEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) setError(error);
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await verifyOtp(pendingOtpEmail!, otp);
    setLoading(false);
    if (error) setError(error);
  };

  const handleResend = async () => {
    if (resendCooldown) return;
    setError(null);
    setResendCooldown(true);
    setTimeout(() => setResendCooldown(false), 30000);
    const { error } = await resendOtp(pendingOtpEmail!);
    if (error) setError(error);
  };

  const handleBack = async () => {
    setError(null);
    setOtp('');
    await cancelOtp();
  };

  if (pendingOtpEmail) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <div className="w-12 h-12 rounded-lg bg-sky-600 flex items-center justify-center">
              <Server className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary">Server Manager</h1>
              <p className="text-sm text-text-muted">Infrastructure management</p>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-2">Enter Verification Code</h2>
            <p className="text-sm text-text-muted mb-4">
              We sent an 8-digit code to <span className="text-text-secondary font-medium">{pendingOtpEmail}</span>
            </p>

            <form onSubmit={handleOtpSubmit} className="space-y-4">
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
                className="w-full px-3 py-3 bg-surface-2 border border-border rounded-lg text-text-primary text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/50 transition-all duration-150"
              />
              {error && (
                <div className="alert-error justify-center">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading || otp.length !== 8}
                className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 disabled:opacity-50 text-white rounded-lg font-medium transition-all duration-150 shadow-sm shadow-sky-600/20"
              >
                {loading ? 'Verifying...' : 'Verify & Sign In'}
              </button>
            </form>

            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                onClick={handleBack}
                className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                onClick={handleResend}
                disabled={resendCooldown}
                className="text-sky-600 dark:text-sky-400 hover:text-sky-500 dark:hover:text-sky-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {resendCooldown ? 'Resend in 30s' : 'Resend Code'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-lg bg-sky-600 flex items-center justify-center">
            <Server className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Server Manager</h1>
            <p className="text-sm text-text-muted">Infrastructure management</p>
          </div>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="form-label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="form-input"
              />
            </div>
            {error && (
              <div className="alert-error justify-center">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 disabled:opacity-50 text-white rounded-lg font-medium transition-all duration-150 shadow-sm shadow-sky-600/20"
            >
              {loading ? 'Please wait...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-xs text-text-faint text-center">
              Don't have an account? Contact your administrator.
            </p>
          </div>
        </div>

        <div className="mt-4 text-center">
          <a
            href="/?bootstrap=admin"
            className="inline-flex items-center gap-1.5 text-xs text-text-faint hover:text-text-muted transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            First-time admin setup
          </a>
        </div>
      </div>
    </div>
  );
}
