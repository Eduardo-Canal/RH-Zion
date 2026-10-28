import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react'
import { useAuth } from '@/hooks/use-auth'
import { getUserProfile, UserProfile } from '@/services/profile'

interface UserRoleContextType extends UserProfile {
  loading: boolean
  isAdmin: boolean
  isManager: boolean
  isEmployee: boolean
  isVisitor: boolean
  hasProfile: boolean
  refreshProfile: () => Promise<void>
}

const UserRoleContext = createContext<UserRoleContextType | undefined>(
  undefined,
)

export function UserRoleProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [profile, setProfile] = useState<UserProfile>({
    role: null,
    colaboradorId: null,
    organizationId: null,
    organizationName: null,
    employee: null,
  })
  const [loading, setLoading] = useState(true)

  const fetchRole = async () => {
    try {
      if (user) {
        const userProfile = await getUserProfile(user.id)
        setProfile(userProfile)
      } else {
        setProfile({
          role: null,
          colaboradorId: null,
          organizationId: null,
          organizationName: null,
          employee: null,
        })
      }
    } catch (error) {
      console.error('Failed to fetch user role', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading) {
      fetchRole()
    }
  }, [user, authLoading])

  const refreshProfile = async () => {
    setLoading(true)
    await fetchRole()
  }

  const value = {
    ...profile,
    loading: loading || authLoading,
    isAdmin: profile.role === 'Admin',
    isManager: profile.role === 'Gerente',
    isEmployee: profile.role === 'Colaborador',
    isVisitor: profile.role === 'visitante',
    hasProfile: !!profile.employee,
    refreshProfile,
  }

  return (
    <UserRoleContext.Provider value={value}>
      {children}
    </UserRoleContext.Provider>
  )
}

export const useUserRole = () => {
  const context = useContext(UserRoleContext)
  if (context === undefined) {
    throw new Error('useUserRole must be used within a UserRoleProvider')
  }
  return context
}
