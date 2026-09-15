import Modal from './Modal';
import { AlertCircle } from 'lucide-react';

type Props = {
  open: boolean;
  title?: string;
  message: string;
  itemName?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title = 'Confirm Delete',
  message,
  itemName,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <div>
        <div className="flex items-start gap-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500/10 flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div className="pt-0.5">
            <p className="text-sm text-text-secondary">
              {message}
            </p>
            {itemName && (
              <p className="text-sm font-semibold text-text-primary mt-1">
                {itemName}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="btn-ghost"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn-danger"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
