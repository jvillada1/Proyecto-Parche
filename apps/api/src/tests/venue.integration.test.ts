import mongoose, { Types } from 'mongoose'
import type { ComunaCode } from '@parche/shared'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Venue } from '../modules/venues/venue.model'

const business = new Types.ObjectId()

interface VenueOverrides {
  neighborhood?: string
  comuna?: ComunaCode
  isActive?: boolean
}

function venueAt(name: string, coordinates: [number, number], overrides: VenueOverrides = {}) {
  return {
    business,
    name,
    address: 'Cra. 70 #44-35',
    neighborhood: 'Laureles',
    comuna: '11' as ComunaCode,
    location: { type: 'Point' as const, coordinates },
    ...overrides,
  }
}

beforeAll(async () => {
  await Venue.syncIndexes()
})

beforeEach(async () => {
  await Venue.deleteMany({})
})

describe('Venue en MongoDB real', () => {
  it('crea el índice 2dsphere en location y el índice de business', async () => {
    const indexes = await Venue.collection.indexes()

    expect(indexes.find((index) => index.key.location)?.key).toEqual({ location: '2dsphere' })
    expect(indexes.find((index) => index.key.business)?.key).toEqual({ business: 1 })
  })

  it('busca sedes cercanas ordenadas por distancia con $near', async () => {
    await Venue.create([
      venueAt('Sede Envigado', [-75.5917, 6.1719], { neighborhood: 'Zona Centro', comuna: '14' }),
      venueAt('Sede Laureles', [-75.5906, 6.2447]),
      venueAt('Sede Provenza', [-75.5664, 6.2087], { neighborhood: 'Provenza', comuna: '14' }),
    ])
    const estadio = { type: 'Point', coordinates: [-75.5878, 6.2569] }

    const nearby = await Venue.find({
      location: mongoose.trusted({ $near: { $geometry: estadio, $maxDistance: 7000 } }),
    })

    expect(nearby.map((venue) => venue.name)).toEqual(['Sede Laureles', 'Sede Provenza'])
  })

  it('las sedes inactivas se pueden excluir de la búsqueda geográfica', async () => {
    await Venue.create([
      venueAt('Sede Laureles', [-75.5906, 6.2447]),
      venueAt('Sede Cerrada', [-75.5905, 6.2448], { isActive: false }),
    ])

    const nearby = await Venue.find({
      isActive: true,
      location: mongoose.trusted({
        $near: { $geometry: { type: 'Point', coordinates: [-75.59, 6.245] } },
      }),
    })

    expect(nearby.map((venue) => venue.name)).toEqual(['Sede Laureles'])
  })

  it('no guarda una sede fuera del área de servicio', async () => {
    await expect(Venue.create(venueAt('Sede Bogotá', [-74.0721, 4.711]))).rejects.toThrow(
      'La ubicación está fuera del área de servicio',
    )
    expect(await Venue.countDocuments()).toBe(0)
  })
})
