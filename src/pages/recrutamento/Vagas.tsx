import { useState, useEffect } from 'react'
import {
  Plus,
  ArrowLeft,
  Search,
  Briefcase,
  Loader2,
  Inbox,
  MoreVertical,
  Pencil,
  Link as LinkIcon,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { JobForm, JobFormValues } from '@/components/forms/JobForm'
import { useToast } from '@/hooks/use-toast'
import { getJobs, createJob, updateJob, Job } from '@/services/jobs'
import { useNavigate } from 'react-router-dom'
import { JobCard } from '@/components/JobCard'
import { ViewSwitcher } from '@/components/ViewSwitcher'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export default function Vagas() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'cards' | 'table'>('cards')

  const { toast } = useToast()
  const navigate = useNavigate()

  const fetchJobs = async () => {
    setLoading(true)
    try {
      const data = await getJobs()
      setJobs(data)
      setFilteredJobs(data)
    } catch (error) {
      console.error(error)
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar as vagas.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
  }, [])

  useEffect(() => {
    const results = jobs.filter(
      (job) =>
        job.titulo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.departamento.toLowerCase().includes(searchTerm.toLowerCase()),
    )
    setFilteredJobs(results)
  }, [searchTerm, jobs])

  const handleSubmit = async (data: JobFormValues) => {
    try {
      if (editingJob) {
        await updateJob(editingJob.id, data)
        toast({ title: 'Sucesso', description: 'Vaga atualizada.' })
      } else {
        await createJob(data)
        toast({ title: 'Sucesso', description: 'Nova vaga criada.' })
      }
      setIsDialogOpen(false)
      setEditingJob(null)
      fetchJobs()
    } catch (error) {
      console.error(error)
      toast({
        title: 'Erro',
        description: 'Erro ao salvar vaga.',
        variant: 'destructive',
      })
    }
  }

  const copyPublicLink = (id: string) => {
    const link = `${window.location.origin}/vagas/publica/${id}`
    navigator.clipboard.writeText(link)
    toast({
      title: 'Link copiado!',
      description:
        'O link público da vaga foi copiado para a área de transferência.',
    })
  }

  return (
    <div className="min-h-screen bg-cream font-sans text-ink pb-12">
      <nav className="sticky top-0 left-0 w-full z-40 mix-blend-difference text-cream px-6 py-4 flex items-center justify-between pointer-events-none bg-cream/5 backdrop-blur-sm md:bg-transparent">
        <div className="pointer-events-auto flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/recrutamento')}
            className="hover:bg-ink/10 text-ink"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="text-xl font-medium tracking-tight font-instrument text-ink">
            Vagas.
          </span>
        </div>
      </nav>

      <div className="px-4 md:px-6 lg:px-8 pt-6 max-w-[1600px] mx-auto animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 auto-rows-min">
          {/* Hero Section */}
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
            <div className="relative z-10">
              <h1 className="font-instrument text-5xl md:text-7xl leading-[0.9] tracking-tight text-ink max-w-2xl">
                Oportunidades & <br />
                <span className="italic">Carreiras</span>
              </h1>
              <p className="text-ink/80 text-lg mt-4 max-w-md font-medium">
                Defina o futuro da organização abrindo portas para novos
                talentos.
              </p>
            </div>
            <div className="relative z-10 flex gap-8 mt-8">
              <div>
                <span className="block font-instrument text-4xl">
                  {jobs.filter((j) => j.status === 'Aberta').length}
                </span>
                <span className="text-xs font-bold uppercase tracking-widest opacity-70">
                  Abertas
                </span>
              </div>
              <div>
                <span className="block font-instrument text-4xl">
                  {jobs.length}
                </span>
                <span className="text-xs font-bold uppercase tracking-widest opacity-70">
                  Total
                </span>
              </div>
            </div>
          </div>

          {/* Actions Section */}
          <div className="col-span-1 md:col-span-4 flex flex-col gap-4">
            <div className="bg-white/50 backdrop-blur-sm border border-ink/5 rounded-[24px] p-6 flex-1 flex flex-col justify-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-ink/40" />
                <Input
                  placeholder="Buscar por título ou departamento..."
                  className="pl-10 bg-cream/50 border-ink/10 h-10 rounded-xl focus:ring-salmon"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <Dialog
                open={isDialogOpen}
                onOpenChange={(open) => {
                  setIsDialogOpen(open)
                  if (!open) setEditingJob(null)
                }}
              >
                <DialogTrigger asChild>
                  <Button className="w-full h-12 rounded-xl bg-ink text-cream hover:bg-salmon hover:text-ink transition-all font-medium text-base">
                    <Plus className="mr-2 h-5 w-5" /> Criar Nova Vaga
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="font-instrument text-3xl">
                      {editingJob ? 'Editar Vaga' : 'Nova Vaga'}
                    </DialogTitle>
                  </DialogHeader>
                  <JobForm
                    initialData={editingJob}
                    onSubmit={handleSubmit}
                    onCancel={() => setIsDialogOpen(false)}
                  />
                </DialogContent>
              </Dialog>
            </div>

            {/* Decorative Stat */}
            <div className="bg-periwinkle rounded-[24px] p-6 flex items-center justify-between relative overflow-hidden h-32">
              <div className="relative z-10">
                <span className="block font-instrument text-2xl">
                  Visualizações
                </span>
                <span className="text-xs font-bold uppercase tracking-widest opacity-60">
                  Página Pública
                </span>
              </div>
              <Briefcase className="w-16 h-16 opacity-20 absolute right-[-10px] bottom-[-10px]" />
            </div>
          </div>

          {/* View Switcher */}
          <div className="col-span-1 md:col-span-12 flex justify-end">
            <ViewSwitcher view={view} setView={setView} />
          </div>

          {/* Grid of Jobs or Table */}
          <div className="col-span-1 md:col-span-12 mt-4">
            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-salmon" />
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="text-center py-20 bg-ink/5 rounded-[24px] flex flex-col items-center justify-center gap-4">
                <Inbox className="h-12 w-12 text-ink/20" />
                <p className="font-instrument text-2xl text-ink/40 italic">
                  Nenhuma vaga encontrada.
                </p>
              </div>
            ) : view === 'cards' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
                {filteredJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onEdit={(j) => {
                      setEditingJob(j)
                      setIsDialogOpen(true)
                    }}
                    onCopyLink={copyPublicLink}
                    onViewPublic={(id) =>
                      window.open(`/vagas/publica/${id}`, '_blank')
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-ink/5 bg-white/50 backdrop-blur-sm overflow-hidden">
                <Table>
                  <TableHeader className="bg-ink/5">
                    <TableRow className="hover:bg-transparent border-ink/5">
                      <TableHead className="text-ink font-medium">
                        Título
                      </TableHead>
                      <TableHead className="text-ink font-medium">
                        Departamento
                      </TableHead>
                      <TableHead className="text-ink font-medium">
                        Tipo de Contrato
                      </TableHead>
                      <TableHead className="text-ink font-medium">
                        Salário
                      </TableHead>
                      <TableHead className="text-ink font-medium">
                        Status
                      </TableHead>
                      <TableHead className="text-right text-ink font-medium">
                        Ações
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredJobs.map((job) => (
                      <TableRow
                        key={job.id}
                        className="border-ink/5 hover:bg-white/60"
                      >
                        <TableCell className="font-medium text-ink">
                          {job.titulo}
                        </TableCell>
                        <TableCell className="text-ink/70">
                          {job.departamento}
                        </TableCell>
                        <TableCell className="text-ink/70">
                          {job.tipo_contrato}
                        </TableCell>
                        <TableCell className="text-ink/70">
                          {job.salario > 0
                            ? `R$ ${job.salario.toLocaleString('pt-BR')}`
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              job.status === 'Fechada' ? 'secondary' : 'default'
                            }
                            className={cn(
                              job.status !== 'Fechada' &&
                                'bg-emerald-600 hover:bg-emerald-700',
                            )}
                          >
                            {job.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 hover:bg-ink/5"
                              >
                                <MoreVertical className="h-4 w-4 text-ink/50" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingJob(job)
                                  setIsDialogOpen(true)
                                }}
                              >
                                <Pencil className="mr-2 h-4 w-4" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => copyPublicLink(job.id)}
                              >
                                <LinkIcon className="mr-2 h-4 w-4" /> Copiar
                                Link
                              </DropdownMenuItem>
                              {job.status !== 'Fechada' && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    window.open(
                                      `/vagas/publica/${job.id}`,
                                      '_blank',
                                    )
                                  }
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" /> Ver
                                  Pública
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
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
