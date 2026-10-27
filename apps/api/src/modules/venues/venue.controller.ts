import type { RequestHandler } from 'express'
import { currentUserId } from '../../utils/current-user'
import * as venueService from './venue.service'

export const listMyVenues: RequestHandler = async (req, res) => {
  res.json({ data: { venues: await venueService.listMyVenues(currentUserId(req)) } })
}

export const getMyVenue: RequestHandler<{ id: string }> = async (req, res) => {
  res.json({ data: { venue: await venueService.getMyVenue(currentUserId(req), req.params.id) } })
}

export const createMyVenue: RequestHandler = async (req, res) => {
  const venue = await venueService.createMyVenue(currentUserId(req), req.body)
  res.status(201).json({ data: { venue } })
}

export const updateMyVenue: RequestHandler<{ id: string }> = async (req, res) => {
  const venue = await venueService.updateMyVenue(currentUserId(req), req.params.id, req.body)
  res.json({ data: { venue } })
}
