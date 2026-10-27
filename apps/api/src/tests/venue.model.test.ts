import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { Venue } from '../modules/venues/venue.model'

const LAURELES = [-75.5906, 6.2447]

function buildVenue(overrides: Record<string, unknown> = {}) {
  return new Venue({
    business: new Types.ObjectId(),
    name: 'Sede Laureles',
    address: 'Cra. 70 #44-35',
    neighborhood: 'Laureles',
    comuna: '11',
    location: { type: 'Point', coordinates: LAURELES },
    ...overrides,
  })
}

function errorsOf(venue: InstanceType<typeof Venue>) {
  return venue.validateSync()?.errors ?? {}
}

describe('Venue', () => {
  it('es válida con los campos obligatorios y aplica los valores por defecto', () => {
    const venue = buildVenue()

    expect(venue.validateSync()).toBeUndefined()
    expect(venue.municipality).toBe('medellin')
    expect(venue.isActive).toBe(true)
    expect(venue.location?.type).toBe('Point')
  })

  it('exige todos los campos obligatorios', () => {
    const venue = new Venue({})

    expect(Object.keys(errorsOf(venue))).toEqual(
      expect.arrayContaining(['business', 'name', 'address', 'neighborhood', 'comuna', 'location']),
    )
  })

  it('recorta espacios en los textos', () => {
    const venue = buildVenue({ name: '  Sede Laureles  ', neighborhood: ' Laureles ' })

    expect(venue.name).toBe('Sede Laureles')
    expect(venue.neighborhood).toBe('Laureles')
  })

  it.each([
    ['name', 'A'],
    ['name', 'A'.repeat(81)],
    ['address', 'Cra'],
    ['address', 'A'.repeat(161)],
    ['neighborhood', 'L'],
    ['neighborhood', 'L'.repeat(61)],
    ['referenceNotes', 'R'.repeat(201)],
  ])('rechaza %s con longitud inválida', (field, value) => {
    expect(errorsOf(buildVenue({ [field]: value }))).toHaveProperty(field)
  })

  it('acepta referenceNotes de hasta 200 caracteres y es opcional', () => {
    expect(buildVenue({ referenceNotes: 'R'.repeat(200) }).validateSync()).toBeUndefined()
    expect(buildVenue({ referenceNotes: undefined }).validateSync()).toBeUndefined()
  })

  it.each(['01', '16', '50', '90'])('acepta la comuna o corregimiento %s', (comuna) => {
    expect(buildVenue({ comuna }).validateSync()).toBeUndefined()
  })

  it.each(['00', '17', '1', 'Laureles'])('rechaza la comuna %s', (comuna) => {
    expect(errorsOf(buildVenue({ comuna }))).toHaveProperty('comuna')
  })

  it('rechaza un municipio fuera del catálogo', () => {
    expect(errorsOf(buildVenue({ municipality: 'bogota' }))).toHaveProperty('municipality')
  })

  describe('location (GeoJSON Point)', () => {
    it('rechaza un tipo distinto a Point', () => {
      const venue = buildVenue({ location: { type: 'Polygon', coordinates: LAURELES } })

      expect(errorsOf(venue)).toHaveProperty(['location.type'])
    })

    it.each([
      ['vacías', []],
      ['con un solo valor', [-75.59]],
      ['con tres valores', [-75.59, 6.24, 1500]],
    ])('rechaza coordenadas %s', (_case, coordinates) => {
      const errors = errorsOf(buildVenue({ location: { type: 'Point', coordinates } }))

      expect(errors['location.coordinates']?.message).toBe(
        'Las coordenadas deben ser [longitud, latitud]',
      )
    })

    it.each([
      ['en Bogotá', [-74.0721, 4.711]],
      ['en el océano (0, 0)', [0, 0]],
      ['con lat y lng invertidas', [6.2447, -75.5906]],
    ])('rechaza una ubicación fuera del área de servicio (RN-23): %s', (_case, coordinates) => {
      const errors = errorsOf(buildVenue({ location: { type: 'Point', coordinates } }))

      expect(errors['location.coordinates']?.message).toBe(
        'La ubicación está fuera del área de servicio',
      )
    })

    it.each([
      ['Envigado', [-75.5917, 6.1719]],
      ['Bello', [-75.5583, 6.3373]],
      ['Santa Elena', [-75.4996, 6.2096]],
    ])('acepta una ubicación dentro del área de servicio: %s', (_case, coordinates) => {
      expect(
        buildVenue({ location: { type: 'Point', coordinates } }).validateSync(),
      ).toBeUndefined()
    })
  })

  it('serializa con id y sin _id ni __v', () => {
    const json = buildVenue().toJSON()

    expect(json).toHaveProperty('id')
    expect(json).not.toHaveProperty('_id')
    expect(json).not.toHaveProperty('__v')
    expect(json.location).toEqual({ type: 'Point', coordinates: LAURELES })
  })
})
