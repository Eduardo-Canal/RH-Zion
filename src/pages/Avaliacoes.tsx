import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target, Search, Plus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { EvaluationForm } from '@/components/forms/EvaluationForm'
import { type EvaluationFormValues } from '@/components/forms/evaluation-schema'
import { useUserRole } from '@/hooks/use-user-role'
import { useToast } from '@/hooks/use-toast'
import { getEmployees } from '@/services/employees'
import {
  getEvaluations,
  createEvaluation,
  deleteEvaluation,
  type Evaluation,
} from '@/services/evaluations'
import { EvaluationCard } from '@/components/EvaluationCard'
import { ViewSwitcher } from '@/components/ViewSwitcher'
import { cn } from '@/lib/utils'

export default function Avaliacoes() {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [employees, setEmployees] = useState<{ id: string; nome: string }[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [loadingData, setLoadingData] = useState(false)
  const [view, setView] = useState<'cards' | 'table'>('cards')

  const { isEmployee, isAdmin, isManager, loading, organizationId } =
    useUserRole()
  const { toast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && isEmployee) {
      toast({
        title: 'Acesso Negado',
        description: 'Você não tem permissão para acessar esta página.',
        variant: 'destructive',
      })
      navigate('/')
    }
  }, [isEmployee, loading, navigate, toast])

  const fetchData = async () => {
    setLoadingData(true)
    try {
      // Fetch employees for dropdowns
      const emps = await getEmployees()
      setEmployees(emps.map((e) => ({ id: e.id, nome: e.nome })))

      // Admin/Manager fetches list
      if (isAdmin || isManager) {
        const data = await getEvaluations()
        setEvaluations(data)
      }
    } catch (error) {
      console.error(error)
      toast({
        title: 'Erro',
        description: 'Falha ao carregar dados.',
        variant: 'destructive',
      })
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => {
    if (!loading && !isEmployee) {
      fetchData()
    }
  }, [loading, isAdmin, isManager, isEmployee])

  const handleSubmit = async (data: EvaluationFormValues) => {
    if (!organizationId) {
      toast({
        title: 'Erro',
        description: 'Organização não identificada.',
        variant: 'destructive',
      })
      return
    }

    try {
      await createEvaluation({
        colaborador_id: data.colaboradorId,
        avaliador_id: data.avaliadorId,
        periodo: data.periodo,
        nota_pontualidade: data.notaPontualidade,
        nota_qualidade: data.notaQualidade,
        nota_trabalho_equipe: data.notaTrabalhoEquipe,
        observacoes: data.observacoes,
        organization_id: organizationId,
      })

      toast({ title: 'Sucesso', description: 'Avaliação registrada.' })
      setIsDialogOpen(false)
      fetchData()
    } catch (error) {
      console.error(error)
      toast({
        title: 'Erro',
        description: 'Erro ao salvar avaliação.',
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta avaliação?')) return
    try {
      await deleteEvaluation(id)
      toast({ title: 'Sucesso', description: 'Avaliação removida.' })
      fetchData()
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Erro ao remover.',
        variant: 'destructive',
      })
    }
  }

  const filteredEvaluations = evaluations.filter(
    (e) =>
      e.colaborador?.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.periodo.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  // Stats Calculation
  const totalEvaluations = evaluations.length
  const avgScore =
    totalEvaluations > 0
      ? (
          evaluations.reduce(
            (acc, curr) =>
              acc +
              curr.nota_qualidade +
              curr.nota_pontualidade +
              curr.nota_trabalho_equipe,
            0,
          ) /
          (totalEvaluations * 3)
        ).toFixed(1)
      : '0.0'

  if (loading || isEmployee) return null

  const getScoreColor = (score: number) => {
    if (score >= 4.5) return 'text-emerald-600 bg-emerald-50 border-emerald-200'
    if (score >= 3.5) return 'text-blue-600 bg-blue-50 border-blue-200'
    if (score >= 2.5) return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    return 'text-red-600 bg-red-50 border-red-200'
  }

  return (
    <div className="min-h-screen bg-cream font-sans text-ink pb-12">
      {/* Navigation */}
      <nav className="sticky top-0 left-0 w-full z-40 mix-blend-difference text-cream px-6 py-4 flex items-center justify-between pointer-events-none bg-cream/5 backdrop-blur-sm md:bg-transparent">
        <div className="pointer-events-auto">
          <span className="text-xl font-medium tracking-tight font-instrument">
            Performance.
          </span>
        </div>
      </nav>

      <div className="px-4 md:px-6 lg:px-8 pt-6 max-w-[1600px] mx-auto animate-fade-in">
        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 auto-rows-min">
          {/* 1. Hero Card - Salmon */}
          <div className="col-span-1 md:col-span-8 bg-salmon rounded-[24px] p-8 md:p-12 relative overflow-hidden min-h-[300px] flex flex-col justify-between group">
            <div className="absolute inset-0 opacity-20 pointer-events-none">
              <svg
                className="w-[200%] h-full animate-drift"
                viewBox="0 0 200 100"
                preserveAspectRatio="none"
              >
                <path
                  d="M0,20 Q50,80 100,20 T200,20"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="0.5"
                />
                <path
                  d="M0,80 Q50,140 100,80 T200,80"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="0.5"
                />
              </svg>
            </div>

            <div className="relative z-10 space-y-4">
              <h1 className="font-instrument text-5xl md:text-7xl leading-[0.9] tracking-tight text-ink max-w-2xl">
                Performance & <br />
                <span className="italic">Evolução</span>
              </h1>
              <p className="text-ink/80 text-lg max-w-md font-medium mt-4">
                Monitore o desenvolvimento da equipe através de avaliações
                contínuas e feedback estruturado.
              </p>
            </div>

            <div className="relative z-10 flex gap-8 mt-8">
              <div>
                <span className="block font-instrument text-4xl md:text-5xl">
                  {totalEvaluations}
                </span>
                <span className="text-xs font-bold uppercase tracking-widest opacity-70">
                  Avaliações Totais
                </span>
              </div>
              <div>
                <span className="block font-instrument text-4xl md:text-5xl">
                  {avgScore}
                </span>
                <span className="text-xs font-bold uppercase tracking-widest opacity-70">
                  Média Geral
                </span>
              </div>
            </div>
          </div>

          {/* 2. Actions & Filters - Periwinkle & Ink */}
          <div className="col-span-1 md:col-span-4 flex flex-col gap-4">
            {/* New Evaluation Card */}
            <div className="bg-ink text-cream rounded-[24px] p-8 flex flex-col justify-between flex-1 group relative overflow-hidden">
              <div className="relative z-10">
                <h2 className="font-instrument text-3xl mb-2">
                  Nova Avaliação
                </h2>
                <p className="text-cream/60 text-sm">
                  Registre um novo ciclo de feedback para um colaborador.
                </p>
              </div>

              <div className="relative z-10 mt-6">
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="w-full h-12 rounded-full bg-cream text-ink hover:bg-salmon hover:text-ink font-medium text-base transition-all">
                      <Plus className="mr-2 h-5 w-5" /> Iniciar
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="font-instrument text-3xl">
                        Registrar Avaliação
                      </DialogTitle>
                    </DialogHeader>
                    <EvaluationForm
                      employees={employees}
                      onSubmit={handleSubmit}
                      onCancel={() => setIsDialogOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>

              <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform" />
            </div>

            {/* Search Card */}
            <div className="bg-periwinkle rounded-[24px] p-6 h-32 flex flex-col justify-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-ink/40" />
                <Input
                  placeholder="Buscar por colaborador..."
                  className="pl-10 bg-white/50 border-ink/5 h-10 rounded-xl focus:ring-ink/20 placeholder:text-ink/40"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <span className="text-[10px] font-bold uppercase tracking-widest text-ink/40">
                  {filteredEvaluations.length} Resultados
                </span>
              </div>
            </div>
          </div>

          {/* View Switcher */}
          <div className="col-span-1 md:col-span-12 flex justify-end">
            <ViewSwitcher view={view} setView={setView} />
          </div>

          {/* 3. Evaluations Grid/Table */}
          <div className="col-span-1 md:col-span-12">
            {loadingData ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-salmon" />
              </div>
            ) : filteredEvaluations.length === 0 ? (
              <div className="text-center py-24 bg-ink/5 rounded-[24px] border border-dashed border-ink/20">
                <Target className="h-12 w-12 text-ink/20 mx-auto mb-4" />
                <p className="font-instrument text-3xl text-ink/40 italic">
                  Nenhuma avaliação encontrada.
                </p>
                <p className="text-ink/30 mt-2">
                  Comece adicionando uma nova avaliação.
                </p>
              </div>
            ) : view === 'cards' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
                {filteredEvaluations.map((evaluation) => (
                  <div key={evaluation.id} className="h-full">
                    <EvaluationCard
                      evaluation={evaluation}
                      onDelete={handleDelete}
                      isAdmin={isAdmin}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-ink/5 bg-white/50 backdrop-blur-sm overflow-hidden">
                <Table>
                  <TableHeader className="bg-ink/5">
                    <TableRow className="hover:bg-transparent border-ink/5">
                      <TableHead className="text-ink font-medium">
                        Colaborador
                      </TableHead>
                      <TableHead className="text-ink font-medium">
                        Avaliador
                      </TableHead>
                      <TableHead className="text-ink font-medium">
                        Período
                      </TableHead>
                      <TableHead className="text-center text-ink font-medium">
                        Pontualidade
                      </TableHead>
                      <TableHead className="text-center text-ink font-medium">
                        Qualidade
                      </TableHead>
                      <TableHead className="text-center text-ink font-medium">
                        Equipe
                      </TableHead>
                      {isAdmin && (
                        <TableHead className="text-right text-ink font-medium">
                          Ações
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEvaluations.map((evaluation) => (
                      <TableRow
                        key={evaluation.id}
                        className="border-ink/5 hover:bg-white/60"
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9 border border-white shadow-sm">
                              <AvatarImage
                                src={`https://img.usecurling.com/ppl/thumbnail?gender=${evaluation.colaborador?.image_gender || 'male'}&seed=${evaluation.colaborador_id}`}
                              />
                              <AvatarFallback>
                                {evaluation.colaborador?.nome.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <span className="font-medium text-ink block">
                                {evaluation.colaborador?.nome}
                              </span>
                              <span className="text-xs text-ink/50">
                                {evaluation.colaborador?.cargo}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-ink/70">
                          {evaluation.avaliador?.nome}
                        </TableCell>
                        <TableCell className="text-ink/70">
                          {evaluation.periodo}
                        </TableCell>
                        <TableCell className="text-center">
                          <div
                            className={cn(
                              'inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold border',
                              getScoreColor(evaluation.nota_pontualidade),
                            )}
                          >
                            {evaluation.nota_pontualidade}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div
                            className={cn(
                              'inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold border',
                              getScoreColor(evaluation.nota_qualidade),
                            )}
                          >
                            {evaluation.nota_qualidade}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div
                            className={cn(
                              'inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold border',
                              getScoreColor(evaluation.nota_trabalho_equipe),
                            )}
                          >
                            {evaluation.nota_trabalho_equipe}
                          </div>
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full"
                              onClick={() => handleDelete(evaluation.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
