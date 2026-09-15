import { useState } from 'react';
import Modal from '@/components/Modal';
import { ArrowLeft } from 'lucide-react';

type Props = {
  open: boolean;
  email: string;
  loading: boolean;
  error: string | null;
  resendCooldown: boolean;
  onSubmit: (otp: string) => void;
  onClose: () => void;
  onResend: () => void;
};

const OTP_LENGTH = 8;

export default function OtpModal({ open, email, loading, error, resendCooldown, onSubmit, onClose, onResend }: Props) {
  const [otp, setOtp] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== OTP_LENGTH) return;
    onSubmit(otp);
  };

  const handleClose = () => {
    setOtp('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Admin Re-Verification Required" size="sm">
      <p className="text-sm text-text-muted mb-4">
        For security, please enter the 8-digit code sent to{' '}
        <span className="text-text-secondary font-medium">{email}</span>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          inputMode="numeric"
          pattern={`\\d{${OTP_LENGTH}}`}
          maxLength={OTP_LENGTH}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          required
          autoFocus
          placeholder="12345678"
          className="w-full px-3 py-3 bg-surface border border-border rounded-md text-text-primary text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-sky-500"
        />

        {error && (
          <div className="alert-error justify-center">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || otp.length !== OTP_LENGTH}
          className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-md font-medium transition-colors"
        >
          {loading ? 'Verifying...' : 'Verify'}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <button
          onClick={handleClose}
          className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Cancel
        </button>
        <button
          onClick={onResend}
          disabled={resendCooldown}
          className="text-sky-600 dark:text-sky-400 hover:text-sky-500 dark:hover:text-sky-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {resendCooldown ? 'Resend in 30s' : 'Resend Code'}
        </button>
      </div>
    </Modal>
  );
}
