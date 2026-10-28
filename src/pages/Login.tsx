import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, ArrowRight, Lock, Mail } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // @ts-expect-error - location state type
  const from = location.state?.from?.pathname || '/'

  const fillDemoCredentials = () => {
    setEmail('teste@adapta.org')
    setPassword('Template@123')
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()

    if (loading) return

    setLoading(true)

    try {
      const { error } = await signIn(email, password)

      if (error) {
        let errorMessage = 'Verifique suas credenciais e tente novamente.'

        if (
          error.message.includes('Invalid login credentials') ||
          error.status === 400
        ) {
          errorMessage =
            'E-mail ou senha incorretos. Verifique as informações digitadas.'
        } else if (error.message) {
          errorMessage = error.message
        }

        toast.error('Erro ao fazer login', {
          description: errorMessage,
        })
      } else {
        toast.success('Login realizado com sucesso')
        navigate(from, { replace: true })
      }
    } catch (err) {
      toast.error('Erro ao fazer login', {
        description: 'Ocorreu um erro inesperado. Tente novamente mais tarde.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative Background Elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-salmon/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-sage/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Texture Overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <filter id="noise">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.6"
              stitchTiles="stitch"
            />
          </filter>
          <rect width="100%" height="100%" filter="url(#noise)" />
        </svg>
      </div>

      <div className="w-full max-w-[440px] relative z-10 animate-fade-in-up">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-block">
            <span className="font-instrument text-3xl text-ink">Adapta.</span>
          </Link>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-[32px] shadow-elevation border border-ink/5 p-8 md:p-10 relative overflow-hidden">
          {/* Subtle top highlight */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-salmon via-periwinkle to-sage opacity-50" />

          <div className="text-center mb-8">
            <h1 className="font-instrument text-4xl text-ink mb-2">
              Bem-vindo
            </h1>
            <p className="text-ink/60 text-sm">
              Entre com suas credenciais para acessar.
            </p>
          </div>

          <div className="mb-5 p-3 rounded-xl bg-cream/50 border border-ink/10 flex items-center justify-between gap-3">
            <div className="text-xs text-ink/60">
              <span className="font-semibold text-ink/80">Demo:</span>{' '}
              teste@adapta.org
            </div>
            <button
              type="button"
              onClick={fillDemoCredentials}
              disabled={loading}
              className="text-xs font-semibold text-salmon hover:text-ink transition-colors underline decoration-salmon/30 underline-offset-4 hover:decoration-ink"
            >
              Preencher
            </button>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-xs font-bold uppercase tracking-widest text-ink/50"
              >
                Email
              </Label>
              <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30 group-focus-within:text-salmon transition-colors">
                  <Mail className="w-5 h-5" />
                </div>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="pl-10 h-12 rounded-xl border-ink/10 bg-cream/30 focus:bg-white focus:border-salmon/50 focus:ring-salmon/20 transition-all text-ink placeholder:text-ink/30 shadow-none"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label
                  htmlFor="password"
                  className="text-xs font-bold uppercase tracking-widest text-ink/50"
                >
                  Senha
                </Label>
                <a
                  href="#"
                  className="text-xs text-ink/50 hover:text-salmon transition-colors"
                >
                  Esqueceu a senha?
                </a>
              </div>
              <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30 group-focus-within:text-salmon transition-colors">
                  <Lock className="w-5 h-5" />
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="******"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="pl-10 h-12 rounded-xl border-ink/10 bg-cream/30 focus:bg-white focus:border-salmon/50 focus:ring-salmon/20 transition-all text-ink placeholder:text-ink/30 shadow-none"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 rounded-full bg-ink text-cream hover:bg-salmon hover:text-ink transition-all duration-300 font-medium text-base group mt-2"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <span className="flex items-center gap-2">
                  Entrar{' '}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              )}
            </Button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-ink/50">
              Ainda não tem conta?{' '}
              <Link
                to="/signup"
                className="text-ink font-semibold hover:text-salmon transition-colors underline decoration-salmon/30 underline-offset-4 hover:decoration-salmon"
              >
                Cadastre-se
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-xs text-ink/30 font-instrument italic">
            © 2026 Adapta System. Secure Login.
          </p>
        </div>
      </div>
    </div>
  )
}
