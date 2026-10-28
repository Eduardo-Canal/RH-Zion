import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { LogOut, Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function VisitorDashboard() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md text-center shadow-lg">
        <CardHeader>
          <div className="mx-auto bg-amber-100 p-4 rounded-full mb-4">
            <Clock className="h-10 w-10 text-amber-600" />
          </div>
          <CardTitle className="text-xl">Aprovação Pendente</CardTitle>
          <CardDescription>Olá! Recebemos o seu cadastro.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-lg font-medium text-gray-800">
            Seu cadastro está em aprovação, aguarde algumas horas.
          </p>
          <p className="text-sm text-muted-foreground">
            Você receberá acesso assim que um administrador revisar suas
            informações.
          </p>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
