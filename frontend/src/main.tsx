import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'
import OperatorDashboard from './OperatorDashboard.tsx'

const path = window.location.pathname.replace(/\/+$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{path === '/operator/dashboard' ? <OperatorDashboard /> : <App operator={path === '/operator'} />}</StrictMode>,
)
