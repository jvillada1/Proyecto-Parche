import type { RequestHandler } from 'express'
import { currentUserId } from '../../utils/current-user'
import * as adminBusinessService from './admin-business.service'
import type { ListBusinessesQuery, RejectBusinessInput } from './business.schemas'

export const listBusinesses: RequestHandler = async (req, res) => {
  const result = await adminBusinessService.listBusinesses(
    req.query as unknown as ListBusinessesQuery,
  )
  res.json({ data: result })
}

export const getBusiness: RequestHandler<{ id: string }> = async (req, res) => {
  res.json({ data: { business: await adminBusinessService.getBusiness(req.params.id) } })
}

export const approveBusiness: RequestHandler<{ id: string }> = async (req, res) => {
  const business = await adminBusinessService.approveBusiness(currentUserId(req), req.params.id)
  res.json({ data: { business } })
}

export const rejectBusiness: RequestHandler<{ id: string }> = async (req, res) => {
  const { reason } = req.body as RejectBusinessInput
  const business = await adminBusinessService.rejectBusiness(
    currentUserId(req),
    req.params.id,
    reason,
  )
  res.json({ data: { business } })
}
