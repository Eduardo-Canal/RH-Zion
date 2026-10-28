import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { useUserRole } from '@/hooks/use-user-role'
import { CompleteProfileForm } from '@/components/forms/CompleteProfileForm'
import { CompleteProfileFormValues } from '@/components/forms/complete-profile-schema'
import {
  createEmployee,
  getEmployees,
  updateEmployee,
} from '@/services/employees'
import { createOrganization } from '@/services/organization'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { useState, useEffect } from 'react'

export default function CompleteProfile() {
  const { user } = useAuth()
  const { refreshProfile } = useUserRole()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [inviteOrgId, setInviteOrgId] = useState<string | null>(null)

  useEffect(() => {
    const storedOrgId = localStorage.getItem('inviteOrgId')
    if (storedOrgId) {
      setInviteOrgId(storedOrgId)
    }
  }, [])

  const handleSubmit = async (data: CompleteProfileFormValues) => {
    if (!user) return

    setLoading(true)
    try {
      let finalOrgId = inviteOrgId
      let finalRole = inviteOrgId ? 'visitante' : 'Admin'
      let existingEmployee = null

      // Check if employee record already exists for this user (to handle update properly)
      try {
        const employees = await getEmployees(user.id)
        if (employees && employees.length > 0) {
          existingEmployee = employees[0]
          finalOrgId = existingEmployee.organization_id // Use existing org if linked
        }
      } catch (err) {
        console.warn(
          'Could not fetch existing employees, proceeding to create',
          err,
        )
      }

      if (!finalOrgId && !existingEmployee) {
        // User is creating a new organization (Admin Flow)
        try {
          const orgName = `Organização de ${data.name}`
          const newOrg = await createOrganization(orgName)
          finalOrgId = newOrg.id
        } catch (orgError: any) {
          console.error('Error creating organization:', orgError)
          throw new Error(
            `Erro ao criar organização: ${orgError.message || 'Erro desconhecido'}`,
          )
        }
      }

      if (!finalOrgId && !existingEmployee) {
        throw new Error('ID da organização não foi gerado.')
      }

      const employeeData = {
        nome: data.name,
        email: data.email || user.email || '',
        cpf: data.cpf,
        telefone: data.phone,
        endereco: data.address,
        data_nascimento: format(data.birthDate, 'yyyy-MM-dd'),
        image_gender: data.image_gender,
        // Preserve or set defaults
        status: 'Ativo',
        user_id: user.id,
      }

      if (existingEmployee) {
        // Update existing record
        await updateEmployee(existingEmployee.id, {
          ...employeeData,
          // Ensure we don't overwrite critical role/org data if not intended, or strictly follow update logic
          // Ideally we just update personal info
        })
        toast.success('Perfil atualizado com sucesso!')
      } else {
        // Create new record
        await createEmployee({
          ...employeeData,
          rg: '', // Default
          role: finalRole as 'Admin' | 'visitante',
          cargo: inviteOrgId ? 'A definir' : 'Administrador',
          departamento: 'Gestão',
          data_admissao: format(new Date(), 'yyyy-MM-dd'),
          salario: 0,
          tipo_contrato: 'CLT',
          documentos_urls: [],
          organization_id: finalOrgId!,
        })
        toast.success('Perfil completado com sucesso!')
      }

      // Clean up invite
      if (inviteOrgId) {
        localStorage.removeItem('inviteOrgId')
      }

      await refreshProfile()

      // Redirect logic based on role
      if (finalRole === 'visitante') {
        navigate('/visitor', { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    } catch (error: any) {
      console.error(error)
      toast.error('Erro ao salvar perfil', {
        description: error.message || 'Verifique os dados e tente novamente.',
      })
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-4 py-8 relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[800px] h-[800px] bg-salmon/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[800px] h-[800px] bg-sage/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Noise Texture */}
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

      <div className="w-full max-w-2xl relative z-10 animate-fade-in-up">
        <div className="text-center mb-8">
          <h1 className="font-instrument text-4xl md:text-5xl text-ink mb-2">
            Complete seu Perfil
          </h1>
          <p className="text-ink/60 text-lg">
            {inviteOrgId
              ? 'Finalize seu cadastro para entrar na organização.'
              : 'Vamos configurar sua conta e organização.'}
          </p>
        </div>

        <div className="bg-white rounded-[32px] shadow-elevation border border-ink/5 p-8 md:p-12 relative overflow-hidden">
          {/* Gradient Line */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-salmon via-periwinkle to-sage opacity-50" />

          <CompleteProfileForm
            defaultEmail={user.email || ''}
            onSubmit={handleSubmit}
            isLoading={loading}
          />
        </div>

        <div className="text-center mt-8">
          <p className="text-sm text-ink/30 font-instrument italic">
            Adapta System • Safe & Secure
          </p>
        </div>
      </div>
    </div>
  )
}
