import { useAuth } from '@/hooks/use-auth'
import { useUserRole } from '@/hooks/use-user-role'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

export default function ProtectedRoute({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, loading: authLoading } = useAuth()
  const { loading: roleLoading, hasProfile, isVisitor } = useUserRole()
  const location = useLocation()

  if (authLoading || roleLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // Not logged in
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  const isCompleteProfilePage = location.pathname === '/complete-profile'
  const isVisitorPage = location.pathname === '/visitor'

  // Logged in but no profile -> Go to Complete Profile
  if (!hasProfile) {
    if (!isCompleteProfilePage) {
      return <Navigate to="/complete-profile" replace />
    }
    return <>{children}</>
  }

  // Has profile but tries to access Complete Profile -> Go Home/Visitor
  if (hasProfile && isCompleteProfilePage) {
    if (isVisitor) return <Navigate to="/visitor" replace />
    return <Navigate to="/" replace />
  }

  // Is Visitor
  if (isVisitor) {
    if (!isVisitorPage) {
      return <Navigate to="/visitor" replace />
    }
    return <>{children}</>
  }

  // Not Visitor (Normal User) but tries to access Visitor Page
  if (!isVisitor && isVisitorPage) {
    return <Navigate to="/" replace />
  }

  // Normal User accessing Normal Pages
  return <>{children}</>
}
