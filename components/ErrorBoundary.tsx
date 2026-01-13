'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to error reporting service
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F5F5F7]">
          <div className="max-w-md w-full bg-white border border-[#E5E5EA] rounded-2xl p-8 text-center shadow-sm">
            <div className="mb-6 flex justify-center">
              <div className="p-4 bg-[#FF3B30]/10 rounded-full">
                <AlertTriangle className="w-12 h-12 text-[#FF3B30]" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-[#1D1D1F] mb-4">
              Something went wrong
            </h2>
            <p className="text-[#424245] mb-6">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-gradient-to-r from-[#5856D6] to-[#AF52DE] text-white font-semibold rounded-lg hover:opacity-90 transition-all"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
