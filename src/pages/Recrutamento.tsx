import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  Briefcase,
  Users,
  Plus,
  ArrowRight,
  Loader2,
  Search,
} from 'lucide-react'
import { useUserRole } from '@/hooks/use-user-role'
import { useToast } from '@/hooks/use-toast'
import { getJobs, Job } from '@/services/jobs'
import { getCandidates, Candidate } from '@/services/recruitment'
import { Button } from '@/components/ui/button'

export default function Recrutamento() {
  const navigate = useNavigate()
  const { isEmployee, loading: roleLoading } = useUserRole()
  const { toast } = useToast()

  const [jobs, setJobs] = useState<Job[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loadingData, setLoadingData] = useState(true)

  useEffect(() => {
    if (!roleLoading && isEmployee) {
      toast({
        title: 'Acesso Negado',
        description:
          'Você não tem permissão para acessar o módulo de recrutamento.',
        variant: 'destructive',
      })
      navigate('/')
    }
  }, [isEmployee, roleLoading, navigate, toast])

  useEffect(() => {
    const loadData = async () => {
      try {
        const [jobsData, candidatesData] = await Promise.all([
          getJobs(),
          getCandidates(),
        ])
        setJobs(jobsData)
        setCandidates(candidatesData)
      } catch (error) {
        console.error('Failed to load recruitment data', error)
        toast({
          title: 'Erro',
          description: 'Não foi possível carregar os dados.',
          variant: 'destructive',
        })
      } finally {
        setLoadingData(false)
      }
    }

    if (!roleLoading && !isEmployee) {
      loadData()
    }
  }, [roleLoading, isEmployee, toast])

  if (roleLoading || isEmployee) {
    return null
  }

  // Stats Calculation
  const activeJobs = jobs.filter((j) => j.status === 'Aberta')
  const totalCandidates = candidates.length
  const triagemCandidates = candidates.filter(
    (c) => c.status === 'Triagem',
  ).length
  const interviewCandidates = candidates.filter(
    (c) => c.status === 'Entrevista',
  ).length

  return (
    <div className="min-h-screen bg-cream font-sans text-ink selection:bg-salmon selection:text-ink pb-12">
      {/* Sticky Minimalist Navigation - Adapted for Dashboard context */}
      <nav className="sticky top-0 left-0 w-full z-40 mix-blend-difference text-cream px-6 py-4 flex items-center justify-between pointer-events-none bg-cream/5 backdrop-blur-sm md:bg-transparent">
        <div className="pointer-events-auto">
          <span className="text-xl font-medium tracking-tight font-instrument">
            Recrutamento.
          </span>
        </div>
        <div className="flex items-center gap-6 pointer-events-auto font-medium">
          <Button
            variant="ghost"
            className="text-cream hover:text-salmon hover:bg-transparent px-0 hidden md:flex"
            onClick={() => navigate('/')}
          >
            Voltar ao Dashboard
          </Button>
        </div>
      </nav>

      {/* Main Content */}
      <div className="px-4 md:px-6 lg:px-8 pt-6 md:pt-10 max-w-[1600px] mx-auto animate-fade-in">
        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 auto-rows-min">
          {/* Quick Actions - Ink (Remains at top) */}
          <div className="col-span-1 md:col-span-12 bg-ink text-cream rounded-[24px] p-8 md:p-12 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-8 group">
            <div className="relative z-10 max-w-xl">
              <h2 className="font-instrument text-4xl md:text-5xl mb-4">
                Pronto para crescer?
              </h2>
              <p className="text-cream/60 text-lg">
                Publique novas oportunidades ou adicione talentos manualmente ao
                seu banco de dados.
              </p>
            </div>

            <div className="relative z-10 flex flex-wrap gap-4 justify-center md:justify-end">
              <Button
                onClick={() => navigate('/recrutamento/vagas')}
                className="bg-cream text-ink hover:bg-salmon hover:text-ink h-14 px-8 rounded-full font-medium text-base transition-all duration-300"
              >
                <Plus className="w-5 h-5 mr-2" />
                Nova Vaga
              </Button>
              <Button
                onClick={() => navigate('/recrutamento/candidatos')}
                variant="outline"
                className="border-cream text-cream hover:bg-cream hover:text-ink h-14 px-8 rounded-full font-medium text-base transition-all duration-300 bg-transparent"
              >
                <Search className="w-5 h-5 mr-2" />
                Buscar Candidato
              </Button>
            </div>

            {/* Background Texture */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <svg
                width="100%"
                height="100%"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <pattern
                    id="grid-rec"
                    width="40"
                    height="40"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx="2" cy="2" r="1" fill="#F5F2EA" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid-rec)" />
              </svg>
            </div>
          </div>

          {/* Jobs List - Periwinkle (Moved to top position) */}
          <div
            className="col-span-1 md:col-span-6 bg-periwinkle rounded-[24px] p-8 md:p-10 min-h-[400px] flex flex-col relative overflow-hidden group cursor-pointer transition-all hover:brightness-95"
            onClick={() => navigate('/recrutamento/vagas')}
          >
            <div className="flex justify-between items-start mb-6 relative z-10">
              <h2 className="font-instrument text-4xl">Vagas em Aberto</h2>
              <div className="bg-ink text-periwinkle p-2 rounded-full transform group-hover:rotate-45 transition-transform duration-300">
                <ArrowUpRight className="w-6 h-6" />
              </div>
            </div>

            <div className="relative z-10 flex-1 flex flex-col gap-3">
              {loadingData ? (
                <div className="space-y-3">
                  <div className="h-16 bg-ink/5 rounded-xl animate-pulse" />
                  <div className="h-16 bg-ink/5 rounded-xl animate-pulse" />
                  <div className="h-16 bg-ink/5 rounded-xl animate-pulse" />
                </div>
              ) : activeJobs.length > 0 ? (
                activeJobs.slice(0, 3).map((job) => (
                  <div
                    key={job.id}
                    className="bg-white/40 backdrop-blur-sm p-4 rounded-xl border border-white/20 hover:bg-white/60 transition-colors flex justify-between items-center group/item"
                  >
                    <div>
                      <h3 className="font-semibold text-lg leading-tight">
                        {job.titulo}
                      </h3>
                      <p className="text-sm opacity-70 font-medium">
                        {job.departamento} • {job.tipo_contrato}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover/item:opacity-100 group-hover/item:translate-x-0 transition-all" />
                  </div>
                ))
              ) : (
                <div className="flex-1 flex items-center justify-center text-ink/50 font-medium italic">
                  Nenhuma vaga aberta no momento.
                </div>
              )}
            </div>

            <div className="mt-6 relative z-10">
              <span className="text-sm font-bold uppercase tracking-widest border-b border-ink pb-0.5 group-hover:border-transparent transition-colors">
                Gerenciar todas as vagas
              </span>
            </div>

            {/* Decorative Element */}
            <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/20 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700 pointer-events-none" />
          </div>

          {/* Candidates Pipeline - Sage (Moved to top position) */}
          <div
            className="col-span-1 md:col-span-6 bg-sage rounded-[24px] p-8 md:p-10 min-h-[400px] flex flex-col relative overflow-hidden group cursor-pointer transition-all hover:brightness-95"
            onClick={() => navigate('/recrutamento/candidatos')}
          >
            <div className="flex justify-between items-start mb-6 relative z-10">
              <h2 className="font-instrument text-4xl">
                Pipeline de Candidatos
              </h2>
              <div className="bg-ink text-sage p-2 rounded-full transform group-hover:rotate-45 transition-transform duration-300">
                <ArrowUpRight className="w-6 h-6" />
              </div>
            </div>

            <div className="relative z-10 grid grid-cols-2 gap-4">
              <div className="bg-ink/5 p-4 rounded-2xl flex flex-col justify-between h-32 hover:bg-ink/10 transition-colors">
                <Users className="w-6 h-6 opacity-50" />
                <div>
                  <span className="block text-3xl font-instrument">
                    {triagemCandidates}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wide opacity-70">
                    Em Triagem
                  </span>
                </div>
              </div>
              <div className="bg-ink/5 p-4 rounded-2xl flex flex-col justify-between h-32 hover:bg-ink/10 transition-colors">
                <Briefcase className="w-6 h-6 opacity-50" />
                <div>
                  <span className="block text-3xl font-instrument">
                    {interviewCandidates}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wide opacity-70">
                    Em Entrevista
                  </span>
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-6 text-ink/80 max-w-sm">
              <p className="text-sm font-medium leading-relaxed">
                Acompanhe o progresso dos candidatos, agende entrevistas e
                gerencie documentação em um fluxo contínuo.
              </p>
            </div>

            {/* Interactive SVG Hover Effects */}
            <div className="absolute -right-12 top-1/2 -translate-y-1/2 opacity-30 group-hover:opacity-60 transition-opacity duration-700 pointer-events-none">
              <svg width="250" height="250" viewBox="0 0 300 300">
                <path
                  d="M0,150 Q75,50 150,150 T300,150"
                  fill="none"
                  stroke="#1A1A18"
                  strokeWidth="0.8"
                  className="animate-[pulse_4s_ease-in-out_infinite]"
                />
                <path
                  d="M0,150 Q75,250 150,150 T300,150"
                  fill="none"
                  stroke="#1A1A18"
                  strokeWidth="0.8"
                  className="animate-[pulse_4s_ease-in-out_infinite_1s]"
                />
              </svg>
            </div>
          </div>

          {/* Hero Card - Salmon (Moved to bottom) */}
          <div className="col-span-1 md:col-span-8 bg-salmon rounded-[24px] p-8 md:p-12 relative overflow-hidden min-h-[400px] flex flex-col justify-between group transition-all duration-500 hover:shadow-elevation">
            {/* Drifting Background Lines */}
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
                  d="M0,50 Q50,110 100,50 T200,50"
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
                Talentos & <br />
                <span className="italic">Oportunidades</span>
              </h1>
              <p className="text-ink/80 text-lg max-w-md font-medium">
                Gerencie todo o ciclo de vida do recrutamento em um único lugar
                visual e intuitivo.
              </p>
            </div>

            <div className="relative z-10 flex flex-wrap gap-8 mt-12 md:mt-0">
              {loadingData ? (
                <Loader2 className="h-8 w-8 animate-spin text-ink" />
              ) : (
                <>
                  <div className="group/stat cursor-default">
                    <span className="block font-instrument text-4xl md:text-5xl group-hover/stat:scale-110 transition-transform origin-left">
                      {activeJobs.length}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-widest opacity-80">
                      Vagas Abertas
                    </span>
                  </div>
                  <div className="group/stat cursor-default">
                    <span className="block font-instrument text-4xl md:text-5xl group-hover/stat:scale-110 transition-transform origin-left">
                      {totalCandidates}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-widest opacity-80">
                      Total Candidatos
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="absolute top-8 right-8 animate-spin-slow hidden md:block opacity-60">
              <svg viewBox="0 0 100 100" width="120" height="120">
                <path
                  id="curve"
                  d="M 50, 50 m -37, 0 a 37,37 0 1,1 74,0 a 37,37 0 1,1 -74,0"
                  fill="transparent"
                />
                <text fontSize="11" letterSpacing="2" fontWeight="bold">
                  <textPath xlinkHref="#curve" fill="currentColor">
                    RECRUITMENT • HR • SYSTEM •
                  </textPath>
                </text>
              </svg>
            </div>
          </div>

          {/* Visual Blob Card - Cream (Moved to bottom) */}
          <div className="col-span-1 md:col-span-4 bg-cream border border-ink/10 rounded-[24px] relative overflow-hidden min-h-[300px] md:min-h-[400px] flex items-center justify-center group transition-all duration-500 hover:shadow-subtle">
            <div className="absolute inset-0 bg-ink/5" />
            <div className="relative w-full h-full flex items-center justify-center animate-float">
              <svg
                viewBox="0 0 200 200"
                className="w-[85%] h-[85%] drop-shadow-2xl"
              >
                <defs>
                  <clipPath id="blob-mask-rec">
                    <path
                      d="M42.7,-72.3C54.9,-66.3,64.1,-55.3,72.6,-43.3C81.1,-31.3,87.8,-18.3,86.9,-5.6C85.9,7.1,77.3,19.5,68.5,31.2C59.7,42.9,50.7,53.9,39.7,62.3C28.7,70.7,15.7,76.5,2.5,77.6C-10.7,78.7,-24.1,75.1,-36.8,68.7C-49.5,62.3,-61.5,53.1,-71.2,41.5C-80.9,29.9,-88.3,15.9,-88.8,1.6C-89.3,-12.7,-82.9,-27.3,-72.9,-38.8C-62.9,-50.3,-49.3,-58.7,-35.8,-65.4C-22.3,-72.1,-8.9,-77.1,3.3,-75.8L15.5,-74.5"
                      transform="translate(100 100)"
                    />
                  </clipPath>
                </defs>
                <image
                  href="https://img.usecurling.com/ppl/large?gender=female&seed=recruiter"
                  width="200"
                  height="200"
                  clipPath="url(#blob-mask-rec)"
                  preserveAspectRatio="xMidYMid slice"
                  className="grayscale contrast-125"
                />
                <path
                  d="M42.7,-72.3C54.9,-66.3,64.1,-55.3,72.6,-43.3C81.1,-31.3,87.8,-18.3,86.9,-5.6C85.9,7.1,77.3,19.5,68.5,31.2C59.7,42.9,50.7,53.9,39.7,62.3C28.7,70.7,15.7,76.5,2.5,77.6C-10.7,78.7,-24.1,75.1,-36.8,68.7C-49.5,62.3,-61.5,53.1,-71.2,41.5C-80.9,29.9,-88.3,15.9,-88.8,1.6C-89.3,-12.7,-82.9,-27.3,-72.9,-38.8C-62.9,-50.3,-49.3,-58.7,-35.8,-65.4C-22.3,-72.1,-8.9,-77.1,3.3,-75.8L15.5,-74.5"
                  transform="translate(100 100)"
                  fill="none"
                  stroke="#1A1A18"
                  strokeWidth="0.8"
                />
              </svg>
            </div>
            <div className="absolute bottom-6 left-6 bg-cream/80 backdrop-blur-md px-4 py-2 rounded-full border border-ink/10">
              <span className="font-instrument text-xl italic flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                Recruiting Now
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Text */}
      <div className="text-center mt-12 mb-6 text-ink/40 font-instrument text-sm italic">
        Adapta Recruitment System • v2.6
      </div>
    </div>
  )
}
