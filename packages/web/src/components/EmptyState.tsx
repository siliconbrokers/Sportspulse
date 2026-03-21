export function EmptyState() {
  return (
    <div
      data-testid="empty-state"
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: 300,
        color: 'var(--sp-text-40)',
        fontSize: 16,
      }}
    >
      No teams available for this date
    </div>
  );
}
