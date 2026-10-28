import { useState, useEffect } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, ArrowRight, Lock, Mail, ShieldCheck } from 'lucide-react'

export default function SignUp() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const orgId = searchParams.get('orgId')
    if (orgId) {
      localStorage.setItem('inviteOrgId', orgId)
    }
  }, [searchParams])

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password !== confirmPassword) {
      toast.error('As senhas não coincidem')
      return
    }

    setLoading(true)

    // Using the signUp method from useAuth hook which wraps supabase.auth.signUp
    const { error } = await signUp(email, password)

    if (error) {
      if (error.status === 429 || error.message?.includes('rate limit')) {
        toast.error('Limite de tentativas excedido', {
          description:
            'Muitas tentativas de cadastro. Por favor, tente novamente mais tarde.',
        })
      } else {
        toast.error('Erro ao criar conta', {
          description: error.message,
        })
      }
      setLoading(false)
    } else {
      toast.success('Conta criada com sucesso!', {
        description: 'Você será redirecionado para completar seu perfil.',
      })
      // Auth listener in App/ProtectedRoute will handle the redirect
      // once the session is established and profile check fails
      navigate('/')
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative Background Elements */}
      <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-salmon/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] bg-sage/10 rounded-full blur-[100px] pointer-events-none" />

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

        {/* Signup Card */}
        <div className="bg-white rounded-[32px] shadow-elevation border border-ink/5 p-8 md:p-10 relative overflow-hidden">
          {/* Subtle top highlight */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-sage via-periwinkle to-salmon opacity-50" />

          <div className="text-center mb-8">
            <h1 className="font-instrument text-4xl text-ink mb-2">
              Crie sua conta
            </h1>
            <p className="text-ink/60 text-sm">
              {searchParams.get('orgId')
                ? 'Você foi convidado para participar de uma organização.'
                : 'Comece sua jornada hoje mesmo.'}
            </p>
          </div>

          <form onSubmit={handleSignUp} className="space-y-5">
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
              <Label
                htmlFor="password"
                className="text-xs font-bold uppercase tracking-widest text-ink/50"
              >
                Senha
              </Label>
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
                  minLength={6}
                  disabled={loading}
                  className="pl-10 h-12 rounded-xl border-ink/10 bg-cream/30 focus:bg-white focus:border-salmon/50 focus:ring-salmon/20 transition-all text-ink placeholder:text-ink/30 shadow-none"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="confirmPassword"
                className="text-xs font-bold uppercase tracking-widest text-ink/50"
              >
                Confirmar Senha
              </Label>
              <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30 group-focus-within:text-salmon transition-colors">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="******"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
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
                  Criar Conta
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              )}
            </Button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-ink/50">
              Já tem uma conta?{' '}
              <Link
                to="/login"
                className="text-ink font-semibold hover:text-salmon transition-colors underline decoration-salmon/30 underline-offset-4 hover:decoration-salmon"
              >
                Fazer login
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-xs text-ink/30 font-instrument italic">
            © 2026 Adapta System. Secure Registration.
          </p>
        </div>
      </div>
    </div>
  )
}
