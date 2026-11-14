import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'
import OperatorDashboard from './OperatorDashboard.tsx'
import DemoControl from './DemoControl.tsx'

const path = window.location.pathname.replace(/\/+$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {path === '/operator/dashboard' ? <OperatorDashboard /> : path === '/rekam' ? <DemoControl /> : <App operator={path === '/operator'} />}
  </StrictMode>,
)
