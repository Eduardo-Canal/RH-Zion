import { supabase } from '@/lib/supabase/client'
import { format } from 'date-fns'

export interface PerformanceMetric {
  department: string
  pontualidade: number
  qualidade: number
  trabalho_equipe: number
}

export interface PayrollMetric {
  department: string
  cost: number
  fill: string
}

export interface RecruitmentMetric {
  status: string
  count: number
  fill: string
}

export interface VacationMetric {
  employeeName: string
  startDate: string
  endDate: string
  days: number
  department?: string
}

export interface ReportsData {
  performance: PerformanceMetric[]
  payroll: PayrollMetric[]
  recruitment: RecruitmentMetric[]
  upcomingVacations: VacationMetric[]
  stats: {
    totalPayroll: number
    totalEmployees: number
    totalCandidates: number
  }
}

export const getReportsData = async (): Promise<ReportsData> => {
  try {
    // 1. Fetch Performance Data (Evaluations + Department)
    const { data: evaluations, error: evalError } = await supabase.from(
      'avaliacoes',
    ).select(`
        nota_pontualidade,
        nota_qualidade,
        nota_trabalho_equipe,
        colaboradores!fk_avaliacoes_colaborador (
          departamento
        )
      `)

    if (evalError) throw evalError

    // Process Performance
    const perfMap = new Map<
      string,
      { p: number; q: number; t: number; count: number }
    >()

    evaluations?.forEach((ev: any) => {
      // Skip if collaborator is null
      if (!ev.colaboradores) return

      const dept = ev.colaboradores.departamento || 'Sem Departamento'
      const curr = perfMap.get(dept) || { p: 0, q: 0, t: 0, count: 0 }

      perfMap.set(dept, {
        p: curr.p + ev.nota_pontualidade,
        q: curr.q + ev.nota_qualidade,
        t: curr.t + ev.nota_trabalho_equipe,
        count: curr.count + 1,
      })
    })

    const performance: PerformanceMetric[] = Array.from(perfMap.entries()).map(
      ([dept, data]) => ({
        department: dept,
        pontualidade: Number((data.p / data.count).toFixed(1)),
        qualidade: Number((data.q / data.count).toFixed(1)),
        trabalho_equipe: Number((data.t / data.count).toFixed(1)),
      }),
    )

    // 2. Fetch Payroll Data (Active Employees)
    const { data: employees, error: empError } = await supabase
      .from('colaboradores')
      .select('salario, departamento')
      .eq('status', 'Ativo')

    if (empError) throw empError

    // Process Payroll
    const payrollMap = new Map<string, number>()
    let totalPayroll = 0
    let totalEmployees = 0

    employees?.forEach((emp) => {
      totalEmployees++
      const salary = Number(emp.salario) || 0
      totalPayroll += salary
      const dept = emp.departamento || 'Outros'
      payrollMap.set(dept, (payrollMap.get(dept) || 0) + salary)
    })

    const payroll: PayrollMetric[] = Array.from(payrollMap.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by cost desc
      .map(([dept, cost], index) => ({
        department: dept,
        cost,
        fill: `hsl(var(--chart-${(index % 5) + 1}))`,
      }))

    // 3. Fetch Recruitment Data
    const { data: candidates, error: recError } = await supabase
      .from('recrutamento')
      .select('status')

    if (recError) throw recError

    // Process Recruitment
    const recMap = new Map<string, number>()
    let totalCandidates = 0

    candidates?.forEach((c) => {
      totalCandidates++
      const status = c.status
      recMap.set(status, (recMap.get(status) || 0) + 1)
    })

    // Define funnel order
    const funnelOrder = [
      'Triagem',
      'Entrevista',
      'Aprovado',
      'Contratado',
      'Reprovado',
      'Recusado',
      'Inscrito',
    ]

    const recruitment: RecruitmentMetric[] = Array.from(recMap.entries())
      .sort((a, b) => {
        const idxA = funnelOrder.indexOf(a[0])
        const idxB = funnelOrder.indexOf(b[0])
        // If not found in order, put at the end
        const valA = idxA === -1 ? 999 : idxA
        const valB = idxB === -1 ? 999 : idxB
        return valA - valB
      })
      .map(([status, count], index) => ({
        status,
        count,
        fill: `hsl(var(--chart-${(index % 5) + 1}))`,
      }))

    // 4. Fetch Upcoming Vacations
    const todayStr = format(new Date(), 'yyyy-MM-dd')
    const { data: vacations, error: vacError } = await supabase
      .from('ferias')
      .select('data_inicio, data_fim, colaboradores(nome, departamento)')
      .gte('data_inicio', todayStr)
      .eq('status', 'Aprovada')
      .order('data_inicio', { ascending: true })
      .limit(5)

    if (vacError) throw vacError

    const upcomingVacations: VacationMetric[] =
      vacations?.map((v: any) => {
        const start = new Date(v.data_inicio)
        const end = new Date(v.data_fim)
        const diffTime = Math.abs(end.getTime() - start.getTime())
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
        return {
          employeeName: v.colaboradores?.nome || 'Colaborador',
          department: v.colaboradores?.departamento || 'Geral',
          startDate: v.data_inicio,
          endDate: v.data_fim,
          days: diffDays,
        }
      }) || []

    return {
      performance,
      payroll,
      recruitment,
      upcomingVacations,
      stats: {
        totalPayroll,
        totalEmployees,
        totalCandidates,
      },
    }
  } catch (error) {
    console.error('Error fetching reports data:', error)
    throw error
  }
}
