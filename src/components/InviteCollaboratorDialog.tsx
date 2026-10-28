import { Copy, Building, UserPlus, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { useState } from 'react'

interface InviteCollaboratorDialogProps {
  organizationId: string
  organizationName: string | null
  trigger?: React.ReactNode
}

export function InviteCollaboratorDialog({
  organizationId,
  organizationName,
  trigger,
}: InviteCollaboratorDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyInviteLink = () => {
    const link = `${window.location.origin}/signup?orgId=${organizationId}`
    navigator.clipboard.writeText(link)
    setCopied(true)
    toast.success('Link copiado!', {
      description: 'Envie para novos colaboradores se cadastrarem.',
    })

    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" className="w-full gap-2">
            <UserPlus className="h-4 w-4" />
            Convidar Colaboradores
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Building className="h-5 w-5 text-primary" />
            <DialogTitle>Convidar Colaboradores</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            Compartilhe o link abaixo para adicionar membros à{' '}
            <strong className="text-foreground">
              {organizationName || 'sua organização'}
            </strong>
            .
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 py-2">
          <Input
            readOnly
            value={`${window.location.origin}/signup?orgId=${organizationId}`}
            className="bg-muted font-mono text-xs"
          />
          <Button
            size="icon"
            variant="outline"
            onClick={copyInviteLink}
            title="Copiar link"
            className={
              copied
                ? 'text-emerald-600 border-emerald-600 bg-emerald-50 hover:bg-emerald-50 hover:text-emerald-700'
                : ''
            }
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
