import { isValidObjectId } from 'mongoose'
import type { VerificationStatus } from '@parche/shared'
import { ConflictError, NotFoundError } from '../../utils/app-error'
import { Business } from './business.model'
import type { ListBusinessesQuery } from './business.schemas'

const BUSINESS_NOT_FOUND_MESSAGE = 'Negocio no encontrado'
const OWNER_FIELDS = 'name email'

const ALREADY_DECIDED_MESSAGE: Record<Exclude<VerificationStatus, 'pending'>, string> = {
  approved: 'El negocio ya está aprobado',
  rejected: 'El negocio ya fue rechazado; debe corregirlo y solicitar revisión de nuevo',
}

// Los que llevan más tiempo esperando salen primero.
export async function listBusinesses({ status, page, limit }: ListBusinessesQuery) {
  const filter = status ? { verificationStatus: status } : {}
  const [businesses, total] = await Promise.all([
    Business.find(filter)
      .sort({ updatedAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('owner', OWNER_FIELDS),
    Business.countDocuments(filter),
  ])
  return { businesses, pagination: { page, limit, total } }
}

export async function getBusiness(businessId: string) {
  const business = isValidObjectId(businessId)
    ? await Business.findById(businessId).populate('owner', OWNER_FIELDS)
    : null
  if (!business) throw new NotFoundError(BUSINESS_NOT_FOUND_MESSAGE)
  return business
}

// Solo se decide sobre negocios en `pending`. El filtro por estado hace la decisión atómica:
// si dos admins actúan a la vez sobre el mismo negocio, solo uno la aplica y el otro recibe 409.
async function decide(
  businessId: string,
  update: { $set: Record<string, unknown>; $unset?: Record<string, 1> },
) {
  const business = isValidObjectId(businessId)
    ? await Business.findOneAndUpdate({ _id: businessId, verificationStatus: 'pending' }, update, {
        returnDocument: 'after',
        runValidators: true,
      }).populate('owner', OWNER_FIELDS)
    : null
  if (business) return business

  const current = await getBusiness(businessId)
  throw new ConflictError(
    ALREADY_DECIDED_MESSAGE[current.verificationStatus as Exclude<VerificationStatus, 'pending'>],
  )
}

export function approveBusiness(adminId: string, businessId: string) {
  return decide(businessId, {
    $set: { verificationStatus: 'approved', verifiedAt: new Date(), verifiedBy: adminId },
    $unset: { rejectionReason: 1 },
  })
}

// RN-22: el gestor ve el motivo en GET /me/business, corrige y vuelve a pending con review-request.
export function rejectBusiness(adminId: string, businessId: string, reason: string) {
  return decide(businessId, {
    $set: {
      verificationStatus: 'rejected',
      rejectionReason: reason,
      verifiedAt: new Date(),
      verifiedBy: adminId,
    },
  })
}
