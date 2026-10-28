import { useEffect, useState } from 'react'
import { getReportsData, ReportsData } from '@/services/reports'
import { toast } from 'sonner'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import {
  TrendingUp,
  DollarSign,
  Users,
  Briefcase,
  Plane,
  Download,
  Filter,
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export default function Relatorios() {
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const result = await getReportsData()
        setData(result)
      } catch (error) {
        console.error(error)
        toast.error('Erro ao carregar dados dos relatórios.')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-salmon"></div>
      </div>
    )
  }

  if (!data) return null

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(value)
  }

  // Custom Tooltip for Charts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-ink text-cream text-xs p-3 rounded-lg shadow-xl border border-white/10">
          <p className="font-bold mb-1">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.fill }}>
              {entry.name}: {entry.value}
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  const COLORS = ['#FF9678', '#CCD7E4', '#C8DFA8', '#F5F2EA', '#1A1A18']

  return (
    <>
      <style type="text/css" media="print">
        {`
          @page { size: portrait; margin: 8mm; }
          html, body, #root { height: auto !important; overflow: visible !important; }
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            background-color: white !important;
          }
          aside, nav, header { display: none !important; }
          main { padding: 0 !important; margin: 0 !important; width: 100% !important; max-width: 100% !important; overflow: visible !important; height: auto !important; }
          ::-webkit-scrollbar { display: none; }
        `}
      </style>
      <div className="p-6 md:p-8 space-y-6 animate-fade-in bg-[#F9FAFB] dark:bg-zinc-950 min-h-screen print:bg-white print:p-0 print:m-0 print:min-h-0">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 print:mb-4">
          <div>
            <h1 className="font-instrument text-4xl md:text-5xl text-ink dark:text-cream print:text-3xl">
              Relatórios & <span className="italic text-salmon">Insights</span>
            </h1>
            <p className="text-ink/60 dark:text-cream/60 mt-2 max-w-lg print:hidden">
              Análise estratégica de performance, custos e capital humano.
            </p>
          </div>
          <div className="flex gap-3 print:hidden">
            <button className="bg-white border border-ink/10 px-4 py-2 rounded-full text-sm font-medium text-ink hover:bg-gray-50 flex items-center gap-2 transition-all">
              <Filter className="w-4 h-4" /> Filtrar
            </button>
            <button
              onClick={() => window.print()}
              className="bg-ink text-cream px-4 py-2 rounded-full text-sm font-medium hover:bg-ink/90 flex items-center gap-2 transition-all shadow-lg hover:shadow-xl"
            >
              <Download className="w-4 h-4" /> Exportar PDF
            </button>
          </div>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 print:grid-cols-12 gap-6 auto-rows-min print:gap-3">
          {/* KPI Cards Row */}
          <div className="col-span-1 md:col-span-4 print:col-span-4 bg-white dark:bg-zinc-900 border border-ink/5 rounded-[24px] print:rounded-2xl p-6 print:p-3 flex items-center gap-4 print:gap-2 hover:shadow-md transition-all">
            <div className="p-4 print:p-2 bg-salmon/20 rounded-full text-salmon">
              <DollarSign className="w-6 h-6 print:w-4 print:h-4" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-ink/50 font-bold print:text-[10px]">
                Custo Folha
              </p>
              <p className="text-2xl font-bold text-ink dark:text-cream font-instrument mt-1 print:text-lg">
                {formatCurrency(data.stats.totalPayroll)}
              </p>
            </div>
          </div>

          <div className="col-span-1 md:col-span-4 print:col-span-4 bg-white dark:bg-zinc-900 border border-ink/5 rounded-[24px] print:rounded-2xl p-6 print:p-3 flex items-center gap-4 print:gap-2 hover:shadow-md transition-all">
            <div className="p-4 print:p-2 bg-periwinkle/20 rounded-full text-blue-600">
              <Users className="w-6 h-6 print:w-4 print:h-4" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-ink/50 font-bold print:text-[10px]">
                Headcount
              </p>
              <p className="text-2xl font-bold text-ink dark:text-cream font-instrument mt-1 print:text-lg">
                {data.stats.totalEmployees}{' '}
                <span className="text-sm print:text-xs font-sans font-normal text-ink/40">
                  ativos
                </span>
              </p>
            </div>
          </div>

          <div className="col-span-1 md:col-span-4 print:col-span-4 bg-white dark:bg-zinc-900 border border-ink/5 rounded-[24px] print:rounded-2xl p-6 print:p-3 flex items-center gap-4 print:gap-2 hover:shadow-md transition-all">
            <div className="p-4 print:p-2 bg-sage/20 rounded-full text-green-700">
              <Briefcase className="w-6 h-6 print:w-4 print:h-4" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-ink/50 font-bold print:text-[10px]">
                Pipeline
              </p>
              <p className="text-2xl font-bold text-ink dark:text-cream font-instrument mt-1 print:text-lg">
                {data.stats.totalCandidates}{' '}
                <span className="text-sm print:text-xs font-sans font-normal text-ink/40">
                  candidatos
                </span>
              </p>
            </div>
          </div>

          {/* Performance Chart - Cream */}
          <div className="col-span-1 md:col-span-8 print:col-span-8 bg-cream border border-ink/5 rounded-[32px] p-8 print:p-4 min-h-[400px] print:min-h-[260px] flex flex-col">
            <div className="flex items-center gap-2 mb-6 print:mb-2">
              <TrendingUp className="w-5 h-5 text-ink" />
              <h3 className="font-instrument text-2xl text-ink print:text-xl">
                Performance por Departamento
              </h3>
            </div>
            <div className="h-[300px] print:h-[180px] w-full flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.performance}
                  margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="rgba(0,0,0,0.05)"
                  />
                  <XAxis
                    dataKey="department"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#1A1A18', fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#1A1A18', fontSize: 12 }}
                    domain={[0, 5]}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                  />
                  <Bar
                    dataKey="pontualidade"
                    name="Pontualidade"
                    fill="#FF9678"
                    radius={[4, 4, 0, 0]}
                    barSize={20}
                  />
                  <Bar
                    dataKey="qualidade"
                    name="Qualidade"
                    fill="#C8DFA8"
                    radius={[4, 4, 0, 0]}
                    barSize={20}
                  />
                  <Bar
                    dataKey="trabalho_equipe"
                    name="Equipe"
                    fill="#CCD7E4"
                    radius={[4, 4, 0, 0]}
                    barSize={20}
                  />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ paddingTop: '20px' }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Upcoming Vacations - Ink */}
          <div className="col-span-1 md:col-span-4 print:col-span-4 bg-ink rounded-[32px] p-8 print:p-4 text-cream flex flex-col relative overflow-hidden print:min-h-[260px]">
            <div className="absolute top-0 right-0 w-32 h-32 bg-salmon rounded-full blur-[80px] opacity-20" />

            <div className="flex items-center gap-2 mb-6 print:mb-2 relative z-10">
              <Plane className="w-5 h-5 text-salmon" />
              <h3 className="font-instrument text-2xl print:text-xl">
                Próximas Férias
              </h3>
            </div>

            <div className="flex-1 space-y-4 print:space-y-2 overflow-y-auto print:overflow-hidden pr-2 relative z-10 custom-scrollbar">
              {data.upcomingVacations.length > 0 ? (
                data.upcomingVacations.map((vacation, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-4 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                  >
                    <div className="h-10 w-10 rounded-full bg-cream text-ink flex items-center justify-center font-bold text-xs shrink-0">
                      {vacation.employeeName.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">
                        {vacation.employeeName}
                      </p>
                      <p className="text-xs text-cream/50 truncate">
                        {vacation.department}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-salmon">
                        {vacation.days} dias
                      </p>
                      <p className="text-[10px] text-cream/40">
                        {format(new Date(vacation.startDate), 'dd/MM')}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-cream/30 italic text-sm">
                  Sem férias agendadas.
                </div>
              )}
            </div>
          </div>

          {/* Recruitment Funnel - Periwinkle */}
          <div className="col-span-1 md:col-span-6 print:col-span-6 bg-periwinkle rounded-[32px] p-8 print:p-4 min-h-[350px] print:min-h-[240px] flex flex-col">
            <div className="flex items-center gap-2 mb-6 print:mb-2">
              <Briefcase className="w-5 h-5 text-ink" />
              <h3 className="font-instrument text-2xl text-ink print:text-xl">
                Funil de Recrutamento
              </h3>
            </div>
            <div className="h-[250px] print:h-[180px] w-full flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.recruitment}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="rgba(0,0,0,0.1)"
                  />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="status"
                    type="category"
                    width={80}
                    tick={{ fill: '#1A1A18', fontSize: 11, fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: 'rgba(255,255,255,0.2)' }}
                  />
                  <Bar
                    dataKey="count"
                    name="Candidatos"
                    fill="#1A1A18"
                    radius={[0, 4, 4, 0]}
                    barSize={24}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Payroll Distribution - Sage */}
          <div className="col-span-1 md:col-span-6 print:col-span-6 bg-sage rounded-[32px] p-8 print:p-4 min-h-[350px] print:min-h-[240px] flex flex-col">
            <div className="flex items-center gap-2 mb-6 print:mb-2">
              <DollarSign className="w-5 h-5 text-ink" />
              <h3 className="font-instrument text-2xl text-ink print:text-xl">
                Distribuição Salarial
              </h3>
            </div>
            <div className="h-[250px] print:h-[180px] w-full flex items-center justify-center flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.payroll}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="cost"
                    nameKey="department"
                  >
                    {data.payroll.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          index === 0
                            ? '#1A1A18'
                            : index === 1
                              ? '#FF9678'
                              : index === 2
                                ? '#CCD7E4'
                                : '#F5F2EA'
                        }
                        strokeWidth={0}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ borderRadius: '8px' }}
                  />
                  <Legend
                    verticalAlign="middle"
                    align="right"
                    layout="vertical"
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
