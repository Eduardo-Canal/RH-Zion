import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  PlayCircle,
  StopCircle,
  Clock,
  Calendar,
  Plus,
  Trash2,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { TimeLogForm, TimeLogFormValues } from '@/components/forms/TimeLogForm'
import { useToast } from '@/hooks/use-toast'
import {
  getTimeLogs,
  createTimeLog,
  deleteTimeLog,
  clockIn,
  clockOut,
  getTodayLog,
  TimeLog,
} from '@/services/time-logs'
import { getEmployees, Employee } from '@/services/employees'
import { useUserRole } from '@/hooks/use-user-role'

export default function Ponto() {
  const [logs, setLogs] = useState<TimeLog[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [todayLog, setTodayLog] = useState<TimeLog | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())

  const { toast } = useToast()
  const { isAdmin, isManager, isEmployee, colaboradorId, loading } =
    useUserRole()

  const canManage = isAdmin
  const viewAll = isAdmin || isManager

  const fetchData = async () => {
    try {
      if (!colaboradorId && isEmployee && !loading) return

      const logsData = await getTimeLogs(
        isEmployee ? colaboradorId! : undefined,
      )
      setLogs(logsData)

      if (viewAll) {
        const employeesData = await getEmployees()
        setEmployees(employeesData)
      }

      if (isEmployee && colaboradorId) {
        const today = await getTodayLog(colaboradorId)
        setTodayLog(today)
      }
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    if (!loading) fetchData()
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [loading, colaboradorId, isAdmin, isManager])

  const handleClockIn = async () => {
    if (!colaboradorId) return
    try {
      await clockIn(colaboradorId)
      toast({ title: 'Ponto Iniciado', description: 'Bom trabalho!' })
      fetchData()
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const handleClockOut = async () => {
    if (!colaboradorId) return
    try {
      await clockOut(colaboradorId)
      toast({ title: 'Ponto Finalizado', description: 'Até amanhã!' })
      fetchData()
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const handleManualSubmit = async (data: TimeLogFormValues) => {
    try {
      await createTimeLog({
        colaborador_id: data.employee,
        data: format(data.date, 'yyyy-MM-dd'),
        hora_entrada: data.entry,
        hora_saida: data.exit,
      })
      toast({ title: 'Sucesso', description: 'Ponto registrado manualmente.' })
      setIsDialogOpen(false)
      fetchData()
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Falha ao salvar.',
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteTimeLog(id)
      fetchData()
      toast({ title: 'Registro excluído' })
    } catch (error) {
      toast({ title: 'Erro ao excluir', variant: 'destructive' })
    }
  }

  if (loading) return null

  return (
    <div className="min-h-screen bg-cream font-sans text-ink pb-12">
      <nav className="sticky top-0 left-0 w-full z-40 mix-blend-difference text-cream px-6 py-4 flex items-center justify-between pointer-events-none bg-cream/5 backdrop-blur-sm md:bg-transparent">
        <div className="pointer-events-auto">
          <span className="text-xl font-medium tracking-tight font-instrument">
            Ponto Digital.
          </span>
        </div>
      </nav>

      <div className="px-4 md:px-6 lg:px-8 pt-6 max-w-[1600px] mx-auto animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 auto-rows-min">
          {/* Clock In/Out Widget */}
          <div className="col-span-1 md:col-span-6 bg-periwinkle rounded-[24px] p-8 md:p-12 relative overflow-hidden min-h-[400px] flex flex-col justify-between group">
            <div className="relative z-10">
              <h1 className="font-instrument text-4xl md:text-6xl mb-2">
                {format(currentTime, 'HH:mm:ss')}
              </h1>
              <p className="text-ink/60 font-medium text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                {format(currentTime, "EEEE, d 'de' MMMM", { locale: ptBR })}
              </p>
            </div>

            <div className="relative z-10 mt-8">
              {isEmployee ? (
                !todayLog ? (
                  <Button
                    onClick={handleClockIn}
                    className="h-16 px-8 rounded-full bg-ink text-white hover:bg-salmon hover:text-ink text-lg font-medium transition-all w-full md:w-auto"
                  >
                    <PlayCircle className="mr-2 h-6 w-6" /> Registrar Entrada
                  </Button>
                ) : !todayLog.hora_saida ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-white/40 rounded-xl backdrop-blur-sm border border-white/20">
                      <span className="text-sm font-bold uppercase tracking-widest opacity-60">
                        Entrada Registrada
                      </span>
                      <p className="font-instrument text-3xl">
                        {todayLog.hora_entrada}
                      </p>
                    </div>
                    <Button
                      onClick={handleClockOut}
                      className="h-16 px-8 rounded-full bg-salmon text-ink hover:bg-ink hover:text-white text-lg font-medium transition-all w-full md:w-auto"
                    >
                      <StopCircle className="mr-2 h-6 w-6" /> Registrar Saída
                    </Button>
                  </div>
                ) : (
                  <div className="p-6 bg-sage/50 rounded-xl backdrop-blur-sm border border-sage text-center">
                    <h3 className="font-instrument text-2xl mb-2">
                      Dia Finalizado!
                    </h3>
                    <p className="text-sm font-medium opacity-80">
                      {todayLog.hora_entrada} - {todayLog.hora_saida}
                    </p>
                  </div>
                )
              ) : (
                <div className="p-6 bg-white/30 rounded-xl">
                  <p className="font-instrument text-2xl">
                    Visão Administrativa
                  </p>
                  <p className="opacity-70">Gerencie os registros ao lado.</p>
                </div>
              )}
            </div>

            {/* Decorative */}
            <div className="absolute top-1/2 right-[-50px] w-64 h-64 bg-white/20 rounded-full blur-3xl pointer-events-none group-hover:scale-125 transition-transform duration-1000" />
          </div>

          {/* Recent Logs List */}
          <div className="col-span-1 md:col-span-6 bg-white/50 border border-ink/5 rounded-[24px] p-8 flex flex-col h-[400px] md:h-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-instrument text-3xl">Histórico Recente</h2>
              {canManage && (
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full border-ink/20 hover:bg-ink hover:text-white transition-colors"
                    >
                      <Plus className="w-4 h-4 mr-1" /> Manual
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="font-instrument text-2xl">
                        Registro Manual
                      </DialogTitle>
                    </DialogHeader>
                    <TimeLogForm
                      employeesList={employees.map((e) => ({
                        id: e.id,
                        name: e.nome,
                      }))}
                      onSubmit={handleManualSubmit}
                      onCancel={() => setIsDialogOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
              {logs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-ink/40 italic">
                  Sem registros recentes.
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className="group bg-cream p-4 rounded-xl border border-ink/5 hover:border-salmon/50 transition-colors flex justify-between items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-lg leading-none">
                          {format(new Date(log.data), 'dd/MM')}
                        </span>
                        <span className="text-xs uppercase tracking-widest bg-ink/5 px-2 py-0.5 rounded-full">
                          {log.colaboradores?.nome.split(' ')[0]}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm opacity-70">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {log.hora_entrada}
                        </span>
                        <ArrowRight className="w-3 h-3" />
                        <span>{log.hora_saida || '...'}</span>
                      </div>
                    </div>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50"
                        onClick={() => handleDelete(log.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
