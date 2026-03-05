export function EmptyState() {
  return (
    <div
      data-testid="empty-state"
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: 300,
        color: '#94a3b8',
        fontSize: 16,
      }}
    >
      No teams available for this date
    </div>
  );
}
