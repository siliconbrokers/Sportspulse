interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      data-testid="error-state"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: 300,
        gap: 12,
      }}
    >
      <p style={{ color: '#fca5a5', fontSize: 16, margin: 0 }}>{message}</p>
      <button
        onClick={onRetry}
        style={{
          backgroundColor: '#3b82f6',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '8px 16px',
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        Retry
      </button>
    </div>
  );
}
