import { ConflictError, NotFoundError } from '../../utils/app-error'
import { Business } from './business.model'
import type { UpdateMyBusinessInput } from './business.schemas'

const BUSINESS_NOT_FOUND_MESSAGE = 'No tienes un negocio registrado'

export async function getMyBusiness(ownerId: string) {
  const business = await Business.findOne({ owner: ownerId })
  if (!business) throw new NotFoundError(BUSINESS_NOT_FOUND_MESSAGE)
  return business
}

function toUpdate(input: UpdateMyBusinessInput) {
  const $set: Record<string, unknown> = {}
  const $unset: Record<string, 1> = {}

  const { contact, ...fields } = input
  const entries = [
    ...Object.entries(fields),
    ...Object.entries(contact ?? {}).map(([key, value]) => [`contact.${key}`, value] as const),
  ]

  for (const [path, value] of entries) {
    if (value === undefined) continue
    if (value === null) $unset[path] = 1
    else $set[path] = value
  }

  return { $set, $unset }
}

const MAX_UPDATE_ATTEMPTS = 3

// Cambiar el nombre o el tipo de un negocio aprobado lo devuelve a revisión.
function changesVerifiedData(
  current: { name: string; type: string },
  input: UpdateMyBusinessInput,
) {
  return (
    (input.name !== undefined && input.name !== current.name) ||
    (input.type !== undefined && input.type !== current.type)
  )
}

export async function updateMyBusiness(ownerId: string, input: UpdateMyBusinessInput) {
  const update = toUpdate(input)

  for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
    const current = await getMyBusiness(ownerId)
    const needsReview =
      current.verificationStatus === 'approved' && changesVerifiedData(current, input)

    // El filtro incluye los valores leídos: si otra petición cambia el nombre, el tipo o el estado
    // entre la lectura y la escritura, no se aplica nada y se reintenta con los datos nuevos.
    const business = await Business.findOneAndUpdate(
      {
        _id: current._id,
        name: current.name,
        type: current.type,
        verificationStatus: current.verificationStatus,
      },
      needsReview
        ? {
            $set: { ...update.$set, verificationStatus: 'pending' },
            $unset: { ...update.$unset, verifiedAt: 1, verifiedBy: 1 },
          }
        : update,
      { returnDocument: 'after', runValidators: true },
    )
    if (business) return business
  }

  throw new ConflictError('El negocio cambió mientras lo editabas, intenta de nuevo')
}

export async function requestReview(ownerId: string) {
  const business = await Business.findOneAndUpdate(
    { owner: ownerId, verificationStatus: 'rejected' },
    {
      $set: { verificationStatus: 'pending' },
      $unset: { rejectionReason: 1, verifiedAt: 1, verifiedBy: 1 },
    },
    { returnDocument: 'after' },
  )
  if (business) return business

  const current = await getMyBusiness(ownerId)
  if (current.verificationStatus === 'pending') {
    throw new ConflictError('Tu negocio ya está en revisión')
  }
  throw new ConflictError('Tu negocio ya está verificado')
}
