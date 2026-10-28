import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

export default function AdaptaLanding() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-cream font-sans text-ink selection:bg-salmon selection:text-ink">
      {/* Sticky Minimalist Navigation */}
      <nav className="fixed top-0 left-0 w-full z-50 mix-blend-difference text-cream px-6 py-4 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto">
          <Link
            to="/"
            className="text-xl font-medium tracking-tight font-instrument"
          >
            Adapta.
          </Link>
        </div>
        <div className="flex items-center gap-6 pointer-events-auto font-medium">
          {user ? (
            <Link to="/" className="hover:opacity-70 transition-opacity">
              Dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="hover:opacity-70 transition-opacity">
                Log in
              </Link>
              <Link
                to="/signup"
                className="hidden sm:inline-block border border-cream rounded-full px-4 py-1 hover:bg-cream hover:text-ink transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Main Content with increased padding top for desktop to avoid overlap with fixed header */}
      <div className="p-4 md:p-6 lg:p-8 pt-32 md:pt-48 max-w-[1600px] mx-auto">
        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 auto-rows-min">
          {/* 1. Hero Card - Salmon */}
          <div className="col-span-1 md:col-span-8 bg-salmon rounded-[24px] p-8 md:p-12 lg:p-16 relative overflow-hidden min-h-[400px] md:min-h-[500px] flex flex-col justify-between group">
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
              <h1 className="font-instrument text-5xl md:text-7xl lg:text-8xl leading-[0.9] tracking-tight text-ink max-w-4xl">
                Gestão de RH que <br />
                <span className="italic">aprende</span> com o <br />
                seu negócio.
              </h1>
            </div>

            <div className="relative z-10 flex flex-wrap gap-4 md:gap-8 mt-12 md:mt-0">
              <div>
                <span className="block font-instrument text-3xl md:text-4xl">
                  23x
                </span>
                <span className="text-sm font-medium uppercase tracking-wide opacity-80">
                  Eficiência Operacional
                </span>
              </div>
              <div>
                <span className="block font-instrument text-3xl md:text-4xl">
                  100%
                </span>
                <span className="text-sm font-medium uppercase tracking-wide opacity-80">
                  Processos Digitais
                </span>
              </div>
              <div>
                <span className="block font-instrument text-3xl md:text-4xl">
                  0
                </span>
                <span className="text-sm font-medium uppercase tracking-wide opacity-80">
                  Uso de Papel
                </span>
              </div>
            </div>

            <div className="absolute top-8 right-8 animate-spin-slow hidden md:block">
              <svg viewBox="0 0 100 100" width="100" height="100">
                <path
                  id="curve"
                  d="M 50, 50 m -37, 0 a 37,37 0 1,1 74,0 a 37,37 0 1,1 -74,0"
                  fill="transparent"
                />
                <text fontSize="12" letterSpacing="2">
                  <textPath xlinkHref="#curve" fill="currentColor">
                    SYSTEM ONLINE • ADAPTA RH •
                  </textPath>
                </text>
              </svg>
            </div>
          </div>

          {/* 2. Organic Blob Card - Cream */}
          <div className="col-span-1 md:col-span-4 bg-cream border border-ink/10 rounded-[24px] relative overflow-hidden min-h-[400px] md:min-h-[500px] flex items-center justify-center">
            <div className="absolute inset-0 bg-ink/5" />
            <div className="relative w-full h-full flex items-center justify-center animate-float">
              <svg
                viewBox="0 0 200 200"
                className="w-[80%] h-[80%] drop-shadow-xl"
              >
                <defs>
                  <clipPath id="blob-mask">
                    <path
                      d="M45.7,-76.3C58.9,-69.3,69.1,-58.3,77.6,-46.3C86.1,-34.3,92.8,-21.3,91.9,-8.6C90.9,4.1,82.3,16.5,73.5,28.2C64.7,39.9,55.7,50.9,44.7,59.3C33.7,67.7,20.7,73.5,7.5,74.6C-5.7,75.7,-19.1,72.1,-31.8,65.7C-44.5,59.3,-56.5,50.1,-66.2,38.5C-75.9,26.9,-83.3,12.9,-83.8,-1.4C-84.3,-15.7,-77.9,-30.3,-67.9,-41.8C-57.9,-53.3,-44.3,-61.7,-30.8,-68.4C-17.3,-75.1,-3.9,-80.1,8.3,-78.8L20.5,-77.5"
                      transform="translate(100 100)"
                    />
                  </clipPath>
                </defs>
                <image
                  href="https://img.usecurling.com/p/1000/1000?q=woman%20working&color=black"
                  width="200"
                  height="200"
                  clipPath="url(#blob-mask)"
                  preserveAspectRatio="xMidYMid slice"
                />
                <path
                  d="M45.7,-76.3C58.9,-69.3,69.1,-58.3,77.6,-46.3C86.1,-34.3,92.8,-21.3,91.9,-8.6C90.9,4.1,82.3,16.5,73.5,28.2C64.7,39.9,55.7,50.9,44.7,59.3C33.7,67.7,20.7,73.5,7.5,74.6C-5.7,75.7,-19.1,72.1,-31.8,65.7C-44.5,59.3,-56.5,50.1,-66.2,38.5C-75.9,26.9,-83.3,12.9,-83.8,-1.4C-84.3,-15.7,-77.9,-30.3,-67.9,-41.8C-57.9,-53.3,-44.3,-61.7,-30.8,-68.4C-17.3,-75.1,-3.9,-80.1,8.3,-78.8L20.5,-77.5"
                  transform="translate(100 100)"
                  fill="none"
                  stroke="#1A1A18"
                  strokeWidth="0.5"
                />
              </svg>
            </div>
            <div className="absolute bottom-8 left-8">
              <span className="font-instrument text-2xl italic">
                Human-Centric
              </span>
            </div>
          </div>

          {/* 3. Performance & Analytics - Periwinkle */}
          <div className="col-span-1 md:col-span-6 bg-periwinkle rounded-[24px] p-8 md:p-12 min-h-[400px] flex flex-col relative overflow-hidden group">
            <h2 className="font-instrument text-4xl mb-6 relative z-10">
              Performance e Análises
            </h2>
            <div className="relative z-10 text-ink/80 max-w-sm space-y-4">
              <p className="text-lg">
                Transforme dados brutos em insights acionáveis. Nosso loop de
                feedback contínuo garante que sua organização evolua.
              </p>
              <ul className="text-sm font-medium space-y-2 border-l border-ink/20 pl-4 mt-4">
                <li>KPIs em Tempo Real</li>
                <li>Avaliações 360 Graus</li>
                <li>Relatórios Estratégicos</li>
                <li>Segurança RLS & Escalabilidade</li>
              </ul>
            </div>

            {/* SVG Flow Diagram */}
            <div className="absolute right-0 bottom-0 w-full h-1/2 md:w-1/2 md:h-full opacity-60 group-hover:opacity-100 transition-opacity duration-500">
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 300 200"
                preserveAspectRatio="none"
              >
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="10"
                    markerHeight="7"
                    refX="0"
                    refY="3.5"
                    orient="auto"
                  >
                    <polygon points="0 0, 10 3.5, 0 7" fill="#1A1A18" />
                  </marker>
                </defs>
                <path
                  d="M50,150 C50,100 100,100 150,100"
                  fill="none"
                  stroke="#1A1A18"
                  strokeWidth="1"
                  markerEnd="url(#arrowhead)"
                  className="animate-[dash_3s_linear_infinite]"
                  strokeDasharray="5,5"
                />
                <path
                  d="M150,100 C200,100 250,50 250,50"
                  fill="none"
                  stroke="#1A1A18"
                  strokeWidth="1"
                  markerEnd="url(#arrowhead)"
                  className="animate-[dash_3s_linear_infinite]"
                  strokeDasharray="5,5"
                />

                <circle cx="50" cy="150" r="4" fill="#1A1A18" />
                <text
                  x="50"
                  y="170"
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="Inter"
                >
                  DATA IN
                </text>

                <circle cx="150" cy="100" r="20" fill="none" stroke="#1A1A18" />
                <text
                  x="150"
                  y="104"
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="Inter"
                >
                  PROCESS
                </text>

                <circle cx="250" cy="50" r="4" fill="#1A1A18" />
                <text
                  x="250"
                  y="40"
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="Inter"
                >
                  SCALE
                </text>
              </svg>
            </div>
          </div>

          {/* 4. Capabilities / Operations - Sage */}
          <div className="col-span-1 md:col-span-6 bg-sage rounded-[24px] p-8 md:p-12 min-h-[400px] flex flex-col relative overflow-hidden group">
            <h2 className="font-instrument text-4xl mb-6 relative z-10">
              Ferramentas Operacionais
            </h2>
            <div className="relative z-10 text-ink/80 max-w-sm space-y-6">
              <div>
                <h3 className="font-bold mb-1 uppercase text-xs tracking-widest">
                  Recrutamento
                </h3>
                <p className="text-sm">
                  Gestão completa de vagas, pipeline de candidatos e portal
                  público de carreiras.
                </p>
              </div>
              <div>
                <h3 className="font-bold mb-1 uppercase text-xs tracking-widest">
                  Colaboradores
                </h3>
                <p className="text-sm">
                  Banco de dados seguro, documentos, ponto digital e gestão de
                  férias simplificada.
                </p>
              </div>
              <div>
                <h3 className="font-bold mb-1 uppercase text-xs tracking-widest">
                  Administração
                </h3>
                <p className="text-sm">
                  Controle de acesso RBAC, múltiplas organizações e gestão de
                  visitantes.
                </p>
              </div>
            </div>

            {/* Interactive SVG Hover Effects */}
            <div className="absolute -right-12 top-1/2 -translate-y-1/2 opacity-40 group-hover:opacity-80 transition-opacity duration-700">
              <svg width="300" height="300" viewBox="0 0 300 300">
                <path
                  d="M0,150 Q75,50 150,150 T300,150"
                  fill="none"
                  stroke="#1A1A18"
                  strokeWidth="0.5"
                  className="animate-[pulse_4s_ease-in-out_infinite]"
                />
                <path
                  d="M0,150 Q75,250 150,150 T300,150"
                  fill="none"
                  stroke="#1A1A18"
                  strokeWidth="0.5"
                  className="animate-[pulse_4s_ease-in-out_infinite_1s]"
                />
                <ellipse
                  cx="150"
                  cy="150"
                  rx="100"
                  ry="50"
                  fill="none"
                  stroke="#1A1A18"
                  strokeWidth="0.5"
                  className="animate-spin-slow origin-center"
                />
                <ellipse
                  cx="150"
                  cy="150"
                  rx="50"
                  ry="100"
                  fill="none"
                  stroke="#1A1A18"
                  strokeWidth="0.5"
                  className="animate-spin-slow origin-center"
                  style={{ animationDirection: 'reverse' }}
                />
              </svg>
            </div>
          </div>

          {/* 5. CTA - Ink */}
          <div className="col-span-1 md:col-span-12 bg-ink text-cream rounded-[24px] p-16 md:p-24 text-center relative overflow-hidden flex flex-col items-center justify-center">
            <h2 className="font-instrument text-5xl md:text-7xl mb-8 relative z-10">
              Pare de adivinhar.
            </h2>
            <p className="text-cream/60 max-w-md text-lg md:text-xl mb-12 relative z-10">
              Junte-se a organizações que automatizam a burocracia do RH para
              focar no talento humano.
            </p>

            <Link to="/signup">
              <button className="bg-cream text-ink px-8 py-4 rounded-full font-medium hover:bg-salmon transition-colors duration-300 relative z-10 flex items-center gap-2 group">
                Criar Conta Agora
                <ArrowUpRight className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            </Link>

            {/* Background Texture */}
            <div className="absolute inset-0 opacity-10">
              <svg
                width="100%"
                height="100%"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <pattern
                    id="grid"
                    width="40"
                    height="40"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx="2" cy="2" r="1" fill="#F5F2EA" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Rotating Fixed Button */}
      <div className="fixed bottom-8 right-8 z-50 hidden md:block">
        <Link to="/signup" className="group relative block w-32 h-32">
          <div className="absolute inset-0 animate-spin-slow group-hover:pause">
            <svg viewBox="0 0 100 100" width="100%" height="100%">
              <path
                id="circlePath"
                d="M 50, 50 m -37, 0 a 37,37 0 1,1 74,0 a 37,37 0 1,1 -74,0"
                fill="none"
              />
              <text fontSize="11" fontWeight="bold" letterSpacing="2">
                <textPath xlinkHref="#circlePath" fill="#1A1A18">
                  START NOW • START NOW • START NOW •
                </textPath>
              </text>
            </svg>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 bg-salmon rounded-full group-hover:scale-110 transition-transform duration-300 flex items-center justify-center">
              <ArrowUpRight className="w-6 h-6 text-ink" />
            </div>
          </div>
        </Link>
      </div>

      <footer className="px-6 py-8 md:py-12 border-t border-ink/5 mt-12 bg-cream text-ink text-sm font-medium flex flex-col md:flex-row justify-between items-center gap-4">
        <div>© 2026 Adapta System.</div>
        <div className="flex gap-6 opacity-60">
          <span>Terms</span>
          <span>Privacy</span>
          <span>Status</span>
        </div>
      </footer>
    </div>
  )
}
