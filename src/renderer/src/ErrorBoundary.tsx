import React, { Component, ReactNode } from 'react'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught:', error, errorInfo)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100vh',
                    background: '#0f172a',
                    color: 'white',
                    padding: '2rem',
                    textAlign: 'center'
                }}>
                    <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</h1>
                    <h2 style={{ marginBottom: '1rem' }}>Something went wrong</h2>
                    <p style={{ color: '#94a3b8', marginBottom: '2rem', maxWidth: '500px' }}>
                        The application encountered an error. Please refresh the page to continue.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '0.75rem 2rem',
                            background: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '1rem',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                        }}
                    >
                        Refresh Page
                    </button>
                    {this.state.error && (
                        <details style={{ marginTop: '2rem', color: '#64748b', fontSize: '0.875rem' }}>
                            <summary style={{ cursor: 'pointer' }}>Error Details</summary>
                            <pre style={{ marginTop: '1rem', textAlign: 'left', background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '4px', overflow: 'auto' }}>
                                {this.state.error.toString()}
                            </pre>
                        </details>
                    )}
                </div>
            )
        }

        return this.props.children
    }
}
