import type { RequestHandler } from 'express'
import type { ReverseQuery, SearchQuery } from './geocoding.schemas'
import { geocoder } from './geocoding.service'

export const search: RequestHandler = async (req, res) => {
  const { q } = req.query as SearchQuery
  res.json({ data: { results: await geocoder.search(q) } })
}

export const reverse: RequestHandler = async (req, res) => {
  const { lat, lng } = req.query as unknown as ReverseQuery
  res.json({ data: { place: await geocoder.reverse(lat, lng) } })
}
