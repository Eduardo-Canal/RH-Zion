import { useEffect, useState } from 'react'
import { useUserRole } from '@/hooks/use-user-role'
import { getDashboardStats, DashboardStats } from '@/services/dashboard'
import {
  Users,
  Briefcase,
  UserPlus,
  Clock,
  ArrowUpRight,
  TrendingUp,
  Activity,
  CalendarCheck,
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'

export default function Index() {
  const { user } = useUserRole() // Assuming name is available if we extend the hook, otherwise use default
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    async function loadStats() {
      try {
        const data = await getDashboardStats()
        setStats(data)
      } catch (error) {
        console.error(error)
        toast.error('Erro ao carregar dados do dashboard')
      } finally {
        setLoading(false)
      }
    }
    loadStats()
  }, [])

  const greeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Bom dia'
    if (hour < 18) return 'Boa tarde'
    return 'Boa noite'
  }

  // Skeleton loading state
  if (loading) {
    return (
      <div className="p-6 md:p-8 space-y-6 animate-pulse">
        <div className="h-40 bg-gray-200 rounded-3xl w-full"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-64 bg-gray-200 rounded-3xl"></div>
          <div className="h-64 bg-gray-200 rounded-3xl"></div>
          <div className="h-64 bg-gray-200 rounded-3xl"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in bg-[#F9FAFB] dark:bg-zinc-950 min-h-screen">
      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 auto-rows-min">
        {/* 1. Hero Card - Salmon */}
        <div className="col-span-1 md:col-span-12 lg:col-span-8 bg-salmon rounded-[32px] p-8 md:p-10 relative overflow-hidden min-h-[300px] flex flex-col justify-between group transition-all duration-500 hover:shadow-xl">
          {/* Background Elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-ink/5 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />

          <div className="relative z-10">
            <h1 className="font-instrument text-4xl md:text-6xl text-ink leading-tight mb-2">
              {greeting()}, <br />
              <span className="italic opacity-80">Bem-vindo de volta.</span>
            </h1>
            <p className="text-ink/70 text-lg font-medium max-w-lg mt-4">
              Aqui está o resumo operacional da sua organização para hoje,{' '}
              {format(new Date(), "d 'de' MMMM", { locale: ptBR })}.
            </p>
          </div>

          <div className="relative z-10 flex gap-4 mt-8">
            <button
              onClick={() => navigate('/colaboradores')}
              className="bg-ink text-cream px-6 py-3 rounded-full text-sm font-medium hover:bg-ink/90 transition-colors flex items-center gap-2"
            >
              Gerenciar Equipe
              <ArrowUpRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate('/recrutamento')}
              className="bg-white/30 backdrop-blur-sm text-ink px-6 py-3 rounded-full text-sm font-medium hover:bg-white/40 transition-colors border border-ink/10"
            >
              Ver Recrutamento
            </button>
          </div>
        </div>

        {/* 2. Clock/Date Card - Ink */}
        <div className="col-span-1 md:col-span-6 lg:col-span-4 bg-ink rounded-[32px] p-8 text-cream flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-50" />

          <div className="relative z-10 flex justify-between items-start">
            <Clock className="w-8 h-8 opacity-80" />
            <div className="animate-pulse w-2 h-2 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
          </div>

          <div className="relative z-10 mt-8 text-center">
            <span className="font-instrument text-6xl md:text-7xl block leading-none">
              {format(new Date(), 'HH:mm')}
            </span>
            <span className="text-cream/60 uppercase tracking-widest text-xs font-medium mt-2 block">
              Horário de Brasília
            </span>
          </div>

          <div className="relative z-10 mt-8 pt-6 border-t border-white/10 flex justify-between items-center">
            <div>
              <span className="block text-2xl font-bold">
                {stats?.presentToday || 0}
              </span>
              <span className="text-xs text-cream/50">
                Colaboradores Presentes
              </span>
            </div>
            <div className="h-10 w-10 rounded-full bg-cream/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-cream" />
            </div>
          </div>
        </div>

        {/* 3. Metrics Row */}

        {/* Employees Metric - Cream */}
        <div
          onClick={() => navigate('/colaboradores')}
          className="col-span-1 md:col-span-4 bg-cream border border-ink/5 rounded-[32px] p-6 flex flex-col justify-between min-h-[200px] cursor-pointer hover:border-salmon/50 transition-all hover:shadow-lg group"
        >
          <div className="flex justify-between items-start">
            <div className="p-3 bg-salmon/20 rounded-2xl text-ink group-hover:bg-salmon group-hover:text-cream transition-colors">
              <Users className="w-6 h-6" />
            </div>
            <ArrowUpRight className="w-5 h-5 text-ink/30 group-hover:text-ink transition-colors" />
          </div>
          <div>
            <span className="font-instrument text-5xl block text-ink group-hover:scale-105 transition-transform origin-left">
              {stats?.totalEmployees || 0}
            </span>
            <span className="text-ink/60 font-medium text-sm">
              Total de Colaboradores
            </span>
          </div>
        </div>

        {/* Vacancies Metric - Periwinkle */}
        <div
          onClick={() => navigate('/recrutamento/vagas')}
          className="col-span-1 md:col-span-4 bg-periwinkle rounded-[32px] p-6 flex flex-col justify-between min-h-[200px] cursor-pointer hover:brightness-95 transition-all hover:shadow-lg group"
        >
          <div className="flex justify-between items-start">
            <div className="p-3 bg-white/40 rounded-2xl text-ink">
              <Briefcase className="w-6 h-6" />
            </div>
            <ArrowUpRight className="w-5 h-5 text-ink/30 group-hover:text-ink transition-colors" />
          </div>
          <div>
            <span className="font-instrument text-5xl block text-ink group-hover:scale-105 transition-transform origin-left">
              {stats?.activeVacancies || 0}
            </span>
            <span className="text-ink/60 font-medium text-sm">
              Vagas Abertas
            </span>
          </div>
        </div>

        {/* Candidates Metric - Sage */}
        <div
          onClick={() => navigate('/recrutamento/candidatos')}
          className="col-span-1 md:col-span-4 bg-sage rounded-[32px] p-6 flex flex-col justify-between min-h-[200px] cursor-pointer hover:brightness-95 transition-all hover:shadow-lg group"
        >
          <div className="flex justify-between items-start">
            <div className="p-3 bg-white/40 rounded-2xl text-ink">
              <UserPlus className="w-6 h-6" />
            </div>
            <ArrowUpRight className="w-5 h-5 text-ink/30 group-hover:text-ink transition-colors" />
          </div>
          <div>
            <span className="font-instrument text-5xl block text-ink group-hover:scale-105 transition-transform origin-left">
              {stats?.totalCandidates || 0}
            </span>
            <span className="text-ink/60 font-medium text-sm">
              Candidatos no Pipeline
            </span>
          </div>
        </div>

        {/* 4. Activity Feed - White/Cream */}
        <div className="col-span-1 md:col-span-12 lg:col-span-12 bg-white dark:bg-zinc-900 border border-ink/5 rounded-[32px] p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-salmon" />
              <h2 className="font-instrument text-2xl text-ink dark:text-cream">
                Atividade Recente
              </h2>
            </div>
            <button className="text-xs font-bold uppercase tracking-widest text-ink/50 hover:text-ink transition-colors">
              Ver Tudo
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stats?.recentActivities && stats.recentActivities.length > 0 ? (
              stats.recentActivities.slice(0, 3).map((activity) => (
                <div
                  key={activity.id}
                  className="bg-cream/30 dark:bg-white/5 border border-ink/5 p-4 rounded-2xl flex items-start gap-3 hover:bg-cream/60 transition-colors"
                >
                  <div
                    className={`p-2 rounded-xl shrink-0 ${
                      activity.type === 'admission'
                        ? 'bg-sage/20 text-green-700'
                        : activity.type === 'application'
                          ? 'bg-periwinkle/20 text-blue-700'
                          : 'bg-salmon/20 text-orange-700'
                    }`}
                  >
                    {activity.type === 'admission' && (
                      <Users className="w-4 h-4" />
                    )}
                    {activity.type === 'application' && (
                      <UserPlus className="w-4 h-4" />
                    )}
                    {activity.type === 'evaluation' && (
                      <TrendingUp className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-ink dark:text-cream">
                      {activity.description}
                    </h3>
                    <p className="text-xs text-ink/60 dark:text-cream/60 mt-0.5 line-clamp-1">
                      {activity.details}
                    </p>
                    <p className="text-[10px] text-ink/40 dark:text-cream/40 mt-2 font-medium uppercase tracking-wide">
                      {format(new Date(activity.date), 'd MMM, HH:mm', {
                        locale: ptBR,
                      })}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-3 text-center py-8 text-ink/40 italic">
                Nenhuma atividade recente registrada.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
