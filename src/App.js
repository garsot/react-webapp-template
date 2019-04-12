import React, { lazy, Suspense } from 'react'

import ErrorBoundary from './ErrorBoundary'

// Dynamic load example
const HomePage = lazy(() => System.import('/public/pages/home/index.js')) 

export default function App() {
    return (        
        <ErrorBoundary>           
            <Suspense fallback={'Loading...'}>
                <HomePage />
            </Suspense>
        </ErrorBoundary>
    )
}

