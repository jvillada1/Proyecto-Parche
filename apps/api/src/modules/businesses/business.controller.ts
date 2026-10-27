import type { RequestHandler } from 'express'
import { currentUserId } from '../../utils/current-user'
import * as businessService from './business.service'

export const getMyBusiness: RequestHandler = async (req, res) => {
  res.json({ data: { business: await businessService.getMyBusiness(currentUserId(req)) } })
}

export const updateMyBusiness: RequestHandler = async (req, res) => {
  const business = await businessService.updateMyBusiness(currentUserId(req), req.body)
  res.json({ data: { business } })
}

export const requestReview: RequestHandler = async (req, res) => {
  const business = await businessService.requestReview(currentUserId(req))
  res.json({ data: { business } })
}
