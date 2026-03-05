interface LoadingSkeletonProps {
  width: number;
  height: number;
}

export function LoadingSkeleton({ width, height }: LoadingSkeletonProps) {
  return (
    <div
      data-testid="loading-skeleton"
      style={{ position: 'relative', width, height, margin: '0 auto' }}
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: (i % 3) * (width / 3) + 4,
            top: Math.floor(i / 3) * (height / 2) + 4,
            width: width / 3 - 8,
            height: height / 2 - 8,
            backgroundColor: 'rgba(255,255,255,0.08)',
            borderRadius: 4,
            animation: 'pulse 1.5s ease-in-out infinite',
            animationDelay: `${i * 100}ms`,
          }}
        />
      ))}
    </div>
  );
}
