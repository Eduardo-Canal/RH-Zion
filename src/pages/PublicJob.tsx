import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getJobById, Job } from '@/services/jobs'
import { submitPublicApplication } from '@/services/recruitment'
import {
  PublicCandidateForm,
  PublicCandidateFormValues,
} from '@/components/forms/PublicCandidateForm'
import { Button } from '@/components/ui/button'
import {
  Briefcase,
  Building2,
  CheckCircle2,
  MapPin,
  Banknote,
  Clock,
  ArrowLeft,
  Share2,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export default function PublicJob() {
  const { id } = useParams<{ id: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const fetchJob = async () => {
      if (!id) return
      try {
        const data = await getJobById(id)
        if (data.status !== 'Aberta') {
          toast.error('Esta vaga não está mais disponível.')
          // We can show a specific state instead of redirecting immediately
          setLoading(false)
          return
        }
        setJob(data)
      } catch (error) {
        console.error('Error fetching job:', error)
        toast.error('Vaga não encontrada.')
      } finally {
        setLoading(false)
      }
    }
    fetchJob()
  }, [id])

  const handleSubmit = async (data: PublicCandidateFormValues, file: File) => {
    if (!job) return

    setSubmitting(true)
    try {
      await submitPublicApplication(
        {
          nome_candidato: data.name,
          email: data.email,
          telefone: data.phone || '',
          vaga_id: job.id,
          vaga: job.titulo,
          organization_id: job.organization_id,
        },
        file,
      )
      setSuccess(true)
      toast.success('Candidatura enviada com sucesso!')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      console.error('Error submitting application:', error)
      toast.error('Erro ao enviar candidatura. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(value)
  }

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-cream gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-salmon" />
        <p className="text-ink/60 font-medium font-instrument text-lg italic">
          Carregando oportunidade...
        </p>
      </div>
    )
  }

  // Error/Not Found State
  if (!job) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-20 h-20 bg-salmon/10 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="h-10 w-10 text-salmon" />
          </div>
          <h1 className="font-instrument text-4xl text-ink">
            Vaga não disponível
          </h1>
          <p className="text-ink/60 text-lg">
            A vaga que você está procurando pode ter sido preenchida ou não
            existe mais.
          </p>
          <Button
            onClick={() => navigate('/adapta')}
            className="rounded-full bg-ink text-cream hover:bg-salmon hover:text-ink transition-colors h-12 px-8 text-base"
          >
            Voltar ao Início
          </Button>
        </div>
      </div>
    )
  }

  // Success State
  if (success) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-4 animate-fade-in">
        <div className="max-w-lg w-full bg-white rounded-[32px] p-8 md:p-12 text-center shadow-elevation border border-ink/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-sage/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

          <div className="w-24 h-24 bg-sage/20 rounded-full flex items-center justify-center mx-auto mb-8 relative z-10">
            <CheckCircle2 className="h-12 w-12 text-green-700" />
          </div>

          <h2 className="font-instrument text-4xl md:text-5xl text-ink mb-4 relative z-10">
            Candidatura Recebida!
          </h2>

          <p className="text-ink/70 text-lg mb-8 relative z-10">
            Agradecemos seu interesse na vaga de{' '}
            <strong className="text-ink">{job.titulo}</strong>. Nossa equipe de
            RH analisará seu perfil em breve.
          </p>

          <Button
            onClick={() => navigate('/adapta')}
            variant="outline"
            className="rounded-full border-ink/10 h-12 px-8 text-base hover:bg-ink hover:text-cream relative z-10"
          >
            Voltar ao site
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream font-sans text-ink selection:bg-salmon selection:text-ink">
      {/* Navigation */}
      <nav className="w-full px-6 py-6 flex items-center justify-between max-w-7xl mx-auto">
        <div
          onClick={() => navigate('/adapta')}
          className="font-instrument text-2xl font-medium tracking-tight cursor-pointer hover:opacity-70 transition-opacity"
        >
          Adapta.
        </div>
        <div className="flex gap-4">
          {/* Placeholder for future nav items */}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 pb-20">
        {/* Hero Section */}
        <div className="py-12 md:py-20 space-y-8 animate-fade-in-up">
          <div className="flex flex-wrap items-center gap-3 text-sm font-medium uppercase tracking-wider text-ink/60">
            <span className="bg-white px-4 py-1.5 rounded-full shadow-subtle border border-ink/5 flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5" />
              {job.departamento}
            </span>
            <span className="bg-white px-4 py-1.5 rounded-full shadow-subtle border border-ink/5 flex items-center gap-2">
              <Briefcase className="w-3.5 h-3.5" />
              {job.tipo_contrato}
            </span>
          </div>

          <h1 className="font-instrument text-5xl md:text-7xl lg:text-8xl leading-[0.9] text-ink max-w-4xl tracking-tight">
            {job.titulo}
          </h1>

          <div className="flex flex-wrap items-center gap-6 md:gap-8 text-lg text-ink/70 pt-2">
            {job.salario > 0 && (
              <span className="flex items-center gap-2">
                <Banknote className="w-5 h-5 text-salmon" />
                {formatCurrency(job.salario)}
              </span>
            )}
            <span className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-salmon" />
              Presencial / Híbrido
            </span>
            <span className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-salmon" />
              Vaga Aberta
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20">
          {/* Left Column - Content */}
          <div className="lg:col-span-7 space-y-16 animate-fade-in-up delay-100">
            <section className="space-y-6">
              <h3 className="font-instrument text-3xl md:text-4xl text-ink relative inline-block">
                Sobre a vaga
                <span className="absolute -bottom-2 left-0 w-1/3 h-1 bg-salmon/30 rounded-full" />
              </h3>
              <div className="prose prose-lg prose-gray max-w-none text-ink/80 leading-relaxed whitespace-pre-wrap font-sans">
                {job.descricao || 'Nenhuma descrição detalhada disponível.'}
              </div>
            </section>

            {job.requisitos && (
              <section className="space-y-6">
                <h3 className="font-instrument text-3xl md:text-4xl text-ink relative inline-block">
                  Requisitos
                  <span className="absolute -bottom-2 left-0 w-1/3 h-1 bg-sage/50 rounded-full" />
                </h3>
                <div className="prose prose-lg prose-gray max-w-none text-ink/80 leading-relaxed whitespace-pre-wrap font-sans">
                  {job.requisitos}
                </div>
              </section>
            )}
          </div>

          {/* Right Column - Application Form */}
          <div className="lg:col-span-5 relative animate-fade-in-up delay-200">
            <div className="sticky top-8">
              <div className="bg-white rounded-[32px] p-8 md:p-10 shadow-elevation border border-ink/5 relative overflow-hidden">
                {/* Decorative blob */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-salmon/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />

                <div className="relative z-10 mb-8">
                  <h3 className="font-instrument text-3xl mb-3">
                    Candidate-se agora
                  </h3>
                  <p className="text-ink/60">
                    Preencha os campos abaixo para participar do processo
                    seletivo.
                  </p>
                </div>

                <div className="relative z-10">
                  <PublicCandidateForm
                    onSubmit={handleSubmit}
                    isLoading={submitting}
                  />
                </div>
              </div>

              <div className="mt-8 flex justify-center text-ink/40 text-sm font-medium">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Processo Seletivo Ativo
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-ink/5 mt-20 py-12 bg-white/50">
        <div className="max-w-7xl mx-auto px-6 text-center text-ink/40 font-instrument italic">
          © 2026 Adapta Recruitment System. All rights reserved.
        </div>
      </footer>
    </div>
  )
}
