import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import Layout from '@/components/Layout'
import Index from '@/pages/Index'
import NotFound from '@/pages/NotFound'
import Colaboradores from '@/pages/Colaboradores'
import Recrutamento from '@/pages/Recrutamento'
import Vagas from '@/pages/recrutamento/Vagas'
import Candidatos from '@/pages/recrutamento/Candidatos'
import Ponto from '@/pages/Ponto'
import Ferias from '@/pages/Ferias'
import Avaliacoes from '@/pages/Avaliacoes'
import Relatorios from '@/pages/Relatorios'
import Login from '@/pages/Login'
import SignUp from '@/pages/SignUp'
import CompleteProfile from '@/pages/CompleteProfile'
import VisitorDashboard from '@/pages/VisitorDashboard'
import PublicJob from '@/pages/PublicJob'
import AdaptaLanding from '@/pages/AdaptaLanding' // Import the new landing page
import { AuthProvider } from '@/hooks/use-auth'
import { UserRoleProvider } from '@/hooks/use-user-role'
import ProtectedRoute from '@/components/ProtectedRoute'

const App = () => (
  <BrowserRouter
    future={{ v7_startTransition: false, v7_relativeSplatPath: false }}
  >
    <AuthProvider>
      <UserRoleProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<SignUp />} />

            {/* Public Landing Page */}
            <Route path="/adapta" element={<AdaptaLanding />} />

            {/* Public Job Route */}
            <Route path="/vagas/publica/:id" element={<PublicJob />} />

            {/* Initial Profile Completion Step */}
            <Route
              path="/complete-profile"
              element={
                <ProtectedRoute>
                  <CompleteProfile />
                </ProtectedRoute>
              }
            />

            {/* Visitor View */}
            <Route
              path="/visitor"
              element={
                <ProtectedRoute>
                  <VisitorDashboard />
                </ProtectedRoute>
              }
            />

            {/* Main App Routes */}
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Index />} />
              <Route path="/colaboradores" element={<Colaboradores />} />

              {/* Recruitment Routes */}
              <Route path="/recrutamento" element={<Recrutamento />} />
              <Route path="/recrutamento/vagas" element={<Vagas />} />
              <Route path="/recrutamento/candidatos" element={<Candidatos />} />

              <Route path="/ponto" element={<Ponto />} />
              <Route path="/ferias" element={<Ferias />} />
              <Route path="/avaliacoes" element={<Avaliacoes />} />
              <Route path="/relatorios" element={<Relatorios />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TooltipProvider>
      </UserRoleProvider>
    </AuthProvider>
  </BrowserRouter>
)

export default App
