import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { AuthGate } from './AuthGate.tsx'
import { AuthProvider } from './state/AuthProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
