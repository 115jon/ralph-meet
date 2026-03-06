import { cn } from '@/lib/utils';
import React from 'react';

export interface SafeAreaViewProps extends React.HTMLAttributes<HTMLDivElement> {
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export const SafeAreaView = React.forwardRef<HTMLDivElement, SafeAreaViewProps>(({
  children,
  className,
  edges = ['top', 'bottom', 'left', 'right'],
  style,
  ...props
}, ref) => {
  return (
    <div
      ref={ref}
      style={{
        paddingTop: edges.includes('top') ? 'var(--safe-area-top, env(safe-area-inset-top, 0px))' : undefined,
        paddingBottom: edges.includes('bottom') ? 'var(--safe-area-bottom, env(safe-area-inset-bottom, 0px))' : undefined,
        paddingLeft: edges.includes('left') ? 'var(--safe-area-left, env(safe-area-inset-left, 0px))' : undefined,
        paddingRight: edges.includes('right') ? 'var(--safe-area-right, env(safe-area-inset-right, 0px))' : undefined,
        ...style
      }}
      className={cn('w-full h-full flex flex-col', className)}
      {...props}
    >
      {children}
    </div>
  );
});

SafeAreaView.displayName = 'SafeAreaView';
