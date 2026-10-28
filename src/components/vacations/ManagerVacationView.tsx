import { useState, useEffect } from 'react'
import { format, differenceInDays } from 'date-fns'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { getVacations, updateVacation, Vacation } from '@/services/vacations'
import { ViewSwitcher } from '@/components/ViewSwitcher'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export function ManagerVacationView() {
  const [requests, setRequests] = useState<Vacation[]>([])
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const { toast } = useToast()

  const fetchRequests = async () => {
    const data = await getVacations()
    setRequests(data)
  }

  useEffect(() => {
    fetchRequests()
  }, [])

  const handleStatusUpdate = async (
    id: string,
    newStatus: 'Aprovada' | 'Reprovada',
  ) => {
    try {
      await updateVacation(id, { status: newStatus })
      toast({ title: 'Status atualizado' })
      fetchRequests()
    } catch (error) {
      toast({ title: 'Erro', variant: 'destructive' })
    }
  }

  return (
    <div className="bg-periwinkle rounded-[24px] p-8 md:p-12 min-h-[500px] relative overflow-hidden">
      <div className="relative z-10 mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="font-instrument text-4xl mb-2">
            Central de Aprovação
          </h2>
          <p className="text-ink/60 font-medium">
            Gerencie as solicitações da equipe.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ViewSwitcher view={view} setView={setView} />
          <div className="bg-white/30 backdrop-blur-sm px-4 py-2 rounded-full border border-white/20">
            <span className="font-instrument text-lg">
              {requests.filter((r) => r.status === 'Pendente').length} Pendentes
            </span>
          </div>
        </div>
      </div>

      {requests.length === 0 ? (
        <p className="relative z-10 text-ink/40 italic text-lg text-center py-10">
          Tudo limpo! Nenhuma solicitação.
        </p>
      ) : view === 'cards' ? (
        <div className="relative z-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {requests.map((req) => {
            const days =
              differenceInDays(
                new Date(req.data_fim),
                new Date(req.data_inicio),
              ) + 1
            return (
              <div
                key={req.id}
                className="bg-white/60 backdrop-blur-md p-6 rounded-2xl border border-white/40 hover:scale-[1.02] transition-transform duration-300 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-instrument text-2xl leading-none mb-1">
                        {req.colaboradores?.nome}
                      </h3>
                      <span className="text-xs font-bold uppercase tracking-widest opacity-60">
                        {days} Dias
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest border
                                       ${req.status === 'Aprovada' ? 'bg-sage text-ink border-transparent' : ''}
                                       ${req.status === 'Reprovada' ? 'bg-salmon text-ink border-transparent' : ''}
                                       ${req.status === 'Pendente' ? 'bg-ink/5 border-ink/10 text-ink' : ''}
                                   `}
                    >
                      {req.status}
                    </span>
                  </div>
                  <div className="mb-4 space-y-1">
                    <p className="text-sm font-medium">
                      {format(new Date(req.data_inicio), 'dd/MM/yyyy')} -{' '}
                      {format(new Date(req.data_fim), 'dd/MM/yyyy')}
                    </p>
                    {req.observacoes && (
                      <p className="text-sm text-ink/70 italic line-clamp-2">
                        "{req.observacoes}"
                      </p>
                    )}
                  </div>
                </div>

                {req.status === 'Pendente' && (
                  <div className="flex gap-2 pt-4 border-t border-ink/5">
                    <Button
                      className="flex-1 bg-sage text-ink hover:bg-ink hover:text-white rounded-xl"
                      onClick={() => handleStatusUpdate(req.id, 'Aprovada')}
                    >
                      <Check className="w-4 h-4 mr-1" /> Aprovar
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 border-salmon text-salmon hover:bg-salmon hover:text-ink rounded-xl bg-transparent"
                      onClick={() => handleStatusUpdate(req.id, 'Reprovada')}
                    >
                      <X className="w-4 h-4 mr-1" /> Reprovar
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="relative z-10 rounded-2xl border border-white/20 bg-white/40 backdrop-blur-md overflow-hidden">
          <Table>
            <TableHeader className="bg-white/20">
              <TableRow className="hover:bg-transparent border-white/20">
                <TableHead className="text-ink font-medium">
                  Colaborador
                </TableHead>
                <TableHead className="text-ink font-medium">
                  Data Início
                </TableHead>
                <TableHead className="text-ink font-medium">Data Fim</TableHead>
                <TableHead className="text-ink font-medium">Status</TableHead>
                <TableHead className="text-right text-ink font-medium">
                  Ações
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((req) => (
                <TableRow
                  key={req.id}
                  className="border-white/20 hover:bg-white/40"
                >
                  <TableCell className="font-medium text-ink">
                    {req.colaboradores?.nome}
                  </TableCell>
                  <TableCell className="text-ink/80">
                    {format(new Date(req.data_inicio), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell className="text-ink/80">
                    {format(new Date(req.data_fim), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest border',
                        req.status === 'Aprovada' &&
                          'bg-sage text-ink border-transparent',
                        req.status === 'Reprovada' &&
                          'bg-salmon text-ink border-transparent',
                        req.status === 'Pendente' &&
                          'bg-ink/5 border-ink/10 text-ink',
                      )}
                    >
                      {req.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {req.status === 'Pendente' && (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          className="h-8 bg-sage text-ink hover:bg-ink hover:text-white rounded-lg"
                          onClick={() => handleStatusUpdate(req.id, 'Aprovada')}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 border-salmon text-salmon hover:bg-salmon hover:text-ink rounded-lg bg-transparent"
                          onClick={() =>
                            handleStatusUpdate(req.id, 'Reprovada')
                          }
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Background Shapes */}
      <div className="absolute top-[-100px] right-[-100px] w-[300px] h-[300px] bg-white/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-50px] left-[20%] w-[200px] h-[200px] bg-sage/20 rounded-full blur-3xl pointer-events-none" />
    </div>
  )
}
