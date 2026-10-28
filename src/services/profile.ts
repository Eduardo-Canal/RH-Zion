import { supabase } from '@/lib/supabase/client'
import { Employee } from './employees'

export interface UserProfile {
  role: 'Admin' | 'Gerente' | 'Colaborador' | 'visitante' | null
  colaboradorId: string | null
  organizationId: string | null
  organizationName: string | null
  employee: Employee | null
}

export const getUserProfile = async (userId: string): Promise<UserProfile> => {
  const { data, error } = await supabase
    .from('colaboradores')
    .select('*, organizations(nome)')
    .eq('user_id', userId)
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 is "Row not found"
    console.error('Error fetching user profile:', error)
  }

  if (!data) {
    return {
      role: null, // No role assigned yet (needs profile completion)
      colaboradorId: null,
      organizationId: null,
      organizationName: null,
      employee: null,
    }
  }

  return {
    role:
      (data.role as 'Admin' | 'Gerente' | 'Colaborador' | 'visitante') ||
      'visitante',
    colaboradorId: data.id,
    organizationId: data.organization_id,
    organizationName: data.organizations?.nome || null,
    employee: data as Employee,
  }
}
