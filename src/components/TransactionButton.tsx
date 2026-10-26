import { useEffect } from 'react'
import { useWaitForTransactionReceipt } from 'wagmi'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'

interface TransactionButtonProps {
  onClick: () => void
  disabled?: boolean
  isPending: boolean
  hash?: `0x${string}`
  onSuccess?: () => void
  onError?: (err: unknown) => void
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  className?: string
  fullWidth?: boolean
}

const VARIANT_STYLES = {
  primary: {
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
  },
  secondary: {
    background: 'transparent',
    color: 'var(--accent)',
    border: '1.5px solid var(--border-strong)',
  },
  danger: {
    background: 'var(--danger)',
    color: '#fff',
    border: 'none',
  },
  ghost: {
    background: 'var(--surface-muted)',
    color: 'var(--ink)',
    border: '1px solid var(--border)',
  },
}

export default function TransactionButton({
  onClick,
  disabled = false,
  isPending,
  hash,
  onSuccess,
  onError,
  children,
  variant = 'primary',
  fullWidth = true,
}: TransactionButtonProps) {
  const { isLoading: isConfirming, isSuccess, isError } = useWaitForTransactionReceipt({
    hash,
  })

  useEffect(() => {
    if (isSuccess && onSuccess) { onSuccess() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, onSuccess])

  useEffect(() => {
    if (isError && onError) { onError(new Error('Transaction failed')) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError, onError])

  const isDisabled = disabled || isPending || isConfirming
  const styles = VARIANT_STYLES[variant]

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className="flex items-center justify-center gap-2 rounded-xl font-semibold text-sm"
      style={{
        ...styles,
        width: fullWidth ? '100%' : undefined,
        padding: '14px 20px',
        minHeight: '48px',
        opacity: isDisabled ? 0.65 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        transition: 'opacity 0.15s, background 0.15s',
      }}
    >
      {isPending || isConfirming ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          {isConfirming ? 'Confirming...' : 'Pending...'}
        </>
      ) : isSuccess ? (
        <>
          <CheckCircle size={16} style={{ color: variant === 'primary' ? '#fff' : 'var(--success)' }} />
          Done
        </>
      ) : isError ? (
        <>
          <XCircle size={16} />
          Failed — Retry
        </>
      ) : (
        children
      )}
    </button>
  )
}
