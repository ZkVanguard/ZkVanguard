/**
 * Loading skeleton components for better perceived performance
 */

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  animation?: 'pulse' | 'wave' | 'none';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ 
  className = '', 
  variant = 'rectangular',
  animation = 'pulse',
  width,
  height 
}: SkeletonProps) {
  const baseClass = 'bg-gray-200 dark:bg-gray-700';
  
  const variantClass = {
    text: 'rounded h-4',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
  }[variant];

  const animationClass = {
    pulse: 'animate-pulse',
    wave: 'animate-shimmer',
    none: '',
  }[animation];

  const style = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };

  return (
    <div 
      className={`${baseClass} ${variantClass} ${animationClass} ${className}`}
      style={style}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-xl space-y-4">
      <Skeleton variant="text" width="60%" />
      <Skeleton variant="rectangular" height={100} />
      <div className="flex gap-2">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="80%" />
          <Skeleton variant="text" width="60%" />
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 items-center">
          <Skeleton variant="circular" width={40} height={40} />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="70%" />
            <Skeleton variant="text" width="50%" />
          </div>
          <Skeleton variant="rectangular" width={80} height={32} />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton variant="text" width="40%" />
      <Skeleton variant="rectangular" height={200} />
      <div className="flex gap-2 justify-center">
        <Skeleton variant="rectangular" width={60} height={24} />
        <Skeleton variant="rectangular" width={60} height={24} />
        <Skeleton variant="rectangular" width={60} height={24} />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <ChartSkeleton />
      <TableSkeleton rows={8} />
    </div>
  );
}

/**
 * Portfolio Overview skeleton - matches PortfolioOverview.tsx dimensions
 */
export function PortfolioOverviewSkeleton() {
  return (
    <div className="bg-white rounded-[16px] sm:rounded-[24px] shadow-sm border border-black/5 p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-5">
        <Skeleton className="w-10 h-10 sm:w-12 sm:h-12 rounded-[12px]" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="w-10 h-10 rounded-full" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[#f5f5f7] rounded-xl p-3 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Hedge List skeleton - matches ActiveHedges.tsx dimensions
 */
export function HedgeListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl p-4 border border-black/5">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="text-right space-y-2">
              <Skeleton className="h-4 w-16 ml-auto" />
              <Skeleton className="h-3 w-12 ml-auto" />
            </div>
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Positions List skeleton - matches PositionsList.tsx dimensions
 */
export function PositionsListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-xl border border-black/5 overflow-hidden">
      <div className="p-4 border-b border-black/5 flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <div className="divide-y divide-black/5">
        {[...Array(rows)].map((_, i) => (
          <div key={i} className="p-4 flex items-center gap-4">
            <Skeleton className="w-10 h-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="text-right space-y-2">
              <Skeleton className="h-4 w-16 ml-auto" />
              <Skeleton className="h-3 w-12 ml-auto" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Risk Metrics skeleton - matches RiskMetrics.tsx dimensions
 */
export function RiskMetricsSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-black/5 p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <Skeleton className="h-5 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Performance Chart skeleton - matches PerformanceChart.tsx dimensions  
 */
export function PerformanceChartSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-black/5 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="flex gap-2">
          {['1D', '1W', '1M', '3M'].map((t) => (
            <Skeleton key={t} className="h-8 w-10 rounded-lg" />
          ))}
        </div>
      </div>
      <Skeleton className="h-[200px] sm:h-[300px] w-full rounded-lg" />
    </div>
  );
}

