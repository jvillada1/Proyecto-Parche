import type { RequestHandler } from 'express'
import { currentUserId } from '../../utils/current-user'
import * as eventService from './event.service'
import type { ListMyEventsQuery } from './event.schemas'

export const listMyEvents: RequestHandler = async (req, res) => {
  const result = await eventService.listMyEvents(
    currentUserId(req),
    req.query as unknown as ListMyEventsQuery,
  )
  res.json({ data: result })
}

export const getMyEventsSummary: RequestHandler = async (req, res) => {
  const summary = await eventService.getMyEventsSummary(currentUserId(req))
  res.json({ data: { summary } })
}

export const createMyEventDraft: RequestHandler = async (req, res) => {
  const event = await eventService.createMyEventDraft(currentUserId(req), req.body)
  res.status(201).json({ data: { event } })
}

export const publishMyEvent: RequestHandler<{ id: string }> = async (req, res) => {
  const event = await eventService.publishMyEvent(currentUserId(req), req.params.id)
  res.json({ data: { event } })
}

export const updateMyEvent: RequestHandler<{ id: string }> = async (req, res) => {
  const event = await eventService.updateMyEvent(currentUserId(req), req.params.id, req.body)
  res.json({ data: { event } })
}

export const duplicateMyEvent: RequestHandler<{ id: string }> = async (req, res) => {
  const event = await eventService.duplicateMyEvent(currentUserId(req), req.params.id)
  res.status(201).json({ data: { event } })
}

export const cancelMyEvent: RequestHandler<{ id: string }> = async (req, res) => {
  const event = await eventService.cancelMyEvent(currentUserId(req), req.params.id, req.body)
  res.json({ data: { event } })
}

export const deleteMyEvent: RequestHandler<{ id: string }> = async (req, res) => {
  await eventService.deleteMyEvent(currentUserId(req), req.params.id)
  res.status(204).end()
}
