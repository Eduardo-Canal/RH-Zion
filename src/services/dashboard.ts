import { supabase } from '@/lib/supabase/client'
import { format } from 'date-fns'

export interface DashboardStats {
  totalEmployees: number
  activeVacancies: number
  totalCandidates: number
  presentToday: number
  recentActivities: {
    id: string
    type: 'admission' | 'application' | 'vacation' | 'evaluation'
    description: string
    date: string
    details?: string
  }[]
}

export const getDashboardStats = async (): Promise<DashboardStats> => {
  const today = format(new Date(), 'yyyy-MM-dd')

  // Parallel requests for counts and recent data
  const [
    { count: employeesCount, data: recentEmployees },
    { count: vacanciesCount },
    { count: candidatesCount, data: recentCandidates },
    { count: attendanceCount },
    { data: recentEvaluations },
  ] = await Promise.all([
    supabase
      .from('colaboradores')
      .select('nome, created_at', { count: 'exact' })
      .eq('status', 'Ativo')
      .order('created_at', { ascending: false })
      .limit(3),
    supabase
      .from('vagas')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Aberta'),
    supabase
      .from('recrutamento')
      .select('nome_candidato, created_at, vaga', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(3),
    supabase
      .from('ponto')
      .select('*', { count: 'exact', head: true })
      .eq('data', today),
    supabase
      .from('avaliacoes')
      .select(
        'created_at, colaborador:colaboradores!fk_avaliacoes_colaborador(nome)',
      )
      .order('created_at', { ascending: false })
      .limit(3),
  ])

  // Combine and format recent activities
  const activities = [
    ...(recentEmployees?.map((e) => ({
      id: `emp-${e.created_at}`,
      type: 'admission' as const,
      description: 'Novo Colaborador',
      details: e.nome,
      date: e.created_at,
    })) || []),
    ...(recentCandidates?.map((c) => ({
      id: `cand-${c.created_at}`,
      type: 'application' as const,
      description: 'Nova Candidatura',
      details: `${c.nome_candidato} - ${c.vaga}`,
      date: c.created_at,
    })) || []),
    ...(recentEvaluations?.map((e: any) => ({
      id: `eval-${e.created_at}`,
      type: 'evaluation' as const,
      description: 'Avaliação Realizada',
      details: e.colaborador?.nome || 'Colaborador',
      date: e.created_at,
    })) || []),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5)

  return {
    totalEmployees: employeesCount || 0,
    activeVacancies: vacanciesCount || 0,
    totalCandidates: candidatesCount || 0,
    presentToday: attendanceCount || 0,
    recentActivities: activities,
  }
}
