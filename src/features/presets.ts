/**
 * Ready-made building blocks.
 *
 * The hard part of Overpass is not the syntax, it is knowing that a pharmacy
 * is `amenity=pharmacy` and a cycle path is `highway=cycleway`. This catalogue
 * covers the common ground so a first query takes a click instead of a trip to
 * the wiki; taginfo autocompletion handles everything beyond it.
 */

import type { QueryType } from '../core/ast'

export interface PresetTag {
  key: string
  value?: string
}

export interface Preset {
  id: string
  label: string
  category: string
  /** Element types this feature is normally mapped as. */
  type: QueryType
  tags: PresetTag[]
  /** Extra words people might search for, beyond the label. */
  keywords?: string[]
}

export const CATEGORIES = [
  'Food & drink',
  'Shops',
  'Health',
  'Transport',
  'Cycling & walking',
  'Tourism',
  'Leisure',
  'Education',
  'Money & post',
  'Public services',
  'Infrastructure',
  'Nature & land',
  'Buildings & addresses',
] as const

export const PRESETS: Preset[] = [
  // Food & drink
  { id: 'restaurant', label: 'Restaurants', category: 'Food & drink', type: 'nwr', tags: [{ key: 'amenity', value: 'restaurant' }] },
  { id: 'cafe', label: 'Cafes', category: 'Food & drink', type: 'nwr', tags: [{ key: 'amenity', value: 'cafe' }], keywords: ['coffee'] },
  { id: 'bar', label: 'Bars', category: 'Food & drink', type: 'nwr', tags: [{ key: 'amenity', value: 'bar' }] },
  { id: 'pub', label: 'Pubs', category: 'Food & drink', type: 'nwr', tags: [{ key: 'amenity', value: 'pub' }] },
  { id: 'fast-food', label: 'Fast food', category: 'Food & drink', type: 'nwr', tags: [{ key: 'amenity', value: 'fast_food' }], keywords: ['takeaway', 'burger'] },
  { id: 'bakery', label: 'Bakeries', category: 'Food & drink', type: 'nwr', tags: [{ key: 'shop', value: 'bakery' }], keywords: ['bread'] },
  { id: 'ice-cream', label: 'Ice cream', category: 'Food & drink', type: 'nwr', tags: [{ key: 'amenity', value: 'ice_cream' }], keywords: ['gelato'] },
  { id: 'drinking-water', label: 'Drinking water', category: 'Food & drink', type: 'nwr', tags: [{ key: 'amenity', value: 'drinking_water' }], keywords: ['fountain', 'tap'] },
  { id: 'biergarten', label: 'Beer gardens', category: 'Food & drink', type: 'nwr', tags: [{ key: 'amenity', value: 'biergarten' }] },

  // Shops
  { id: 'supermarket', label: 'Supermarkets', category: 'Shops', type: 'nwr', tags: [{ key: 'shop', value: 'supermarket' }], keywords: ['grocery'] },
  { id: 'convenience', label: 'Convenience stores', category: 'Shops', type: 'nwr', tags: [{ key: 'shop', value: 'convenience' }] },
  { id: 'any-shop', label: 'Any shop', category: 'Shops', type: 'nwr', tags: [{ key: 'shop' }], keywords: ['retail', 'store'] },
  { id: 'clothes', label: 'Clothing shops', category: 'Shops', type: 'nwr', tags: [{ key: 'shop', value: 'clothes' }] },
  { id: 'hairdresser', label: 'Hairdressers', category: 'Shops', type: 'nwr', tags: [{ key: 'shop', value: 'hairdresser' }], keywords: ['barber', 'salon'] },
  { id: 'bookshop', label: 'Bookshops', category: 'Shops', type: 'nwr', tags: [{ key: 'shop', value: 'books' }] },
  { id: 'butcher', label: 'Butchers', category: 'Shops', type: 'nwr', tags: [{ key: 'shop', value: 'butcher' }] },
  { id: 'marketplace', label: 'Marketplaces', category: 'Shops', type: 'nwr', tags: [{ key: 'amenity', value: 'marketplace' }], keywords: ['market'] },

  // Health
  { id: 'pharmacy', label: 'Pharmacies', category: 'Health', type: 'nwr', tags: [{ key: 'amenity', value: 'pharmacy' }], keywords: ['chemist', 'drugstore'] },
  { id: 'hospital', label: 'Hospitals', category: 'Health', type: 'nwr', tags: [{ key: 'amenity', value: 'hospital' }] },
  { id: 'doctors', label: 'Doctors', category: 'Health', type: 'nwr', tags: [{ key: 'amenity', value: 'doctors' }], keywords: ['gp', 'surgery'] },
  { id: 'dentist', label: 'Dentists', category: 'Health', type: 'nwr', tags: [{ key: 'amenity', value: 'dentist' }] },
  { id: 'clinic', label: 'Clinics', category: 'Health', type: 'nwr', tags: [{ key: 'amenity', value: 'clinic' }] },
  { id: 'veterinary', label: 'Vets', category: 'Health', type: 'nwr', tags: [{ key: 'amenity', value: 'veterinary' }], keywords: ['animal'] },
  { id: 'defibrillator', label: 'Defibrillators', category: 'Health', type: 'nwr', tags: [{ key: 'emergency', value: 'defibrillator' }], keywords: ['aed'] },

  // Transport
  { id: 'bus-stop', label: 'Bus stops', category: 'Transport', type: 'node', tags: [{ key: 'highway', value: 'bus_stop' }] },
  { id: 'station', label: 'Stations', category: 'Transport', type: 'nwr', tags: [{ key: 'public_transport', value: 'station' }], keywords: ['train', 'metro'] },
  { id: 'railway-station', label: 'Railway stations', category: 'Transport', type: 'nwr', tags: [{ key: 'railway', value: 'station' }] },
  { id: 'tram-stop', label: 'Tram stops', category: 'Transport', type: 'node', tags: [{ key: 'railway', value: 'tram_stop' }] },
  { id: 'subway-entrance', label: 'Subway entrances', category: 'Transport', type: 'node', tags: [{ key: 'railway', value: 'subway_entrance' }], keywords: ['metro'] },
  { id: 'parking', label: 'Car parks', category: 'Transport', type: 'nwr', tags: [{ key: 'amenity', value: 'parking' }], keywords: ['parking'] },
  { id: 'fuel', label: 'Petrol stations', category: 'Transport', type: 'nwr', tags: [{ key: 'amenity', value: 'fuel' }], keywords: ['gas', 'petrol'] },
  { id: 'charging', label: 'EV charging', category: 'Transport', type: 'nwr', tags: [{ key: 'amenity', value: 'charging_station' }], keywords: ['electric', 'car'] },
  { id: 'taxi', label: 'Taxi ranks', category: 'Transport', type: 'nwr', tags: [{ key: 'amenity', value: 'taxi' }] },
  { id: 'airport', label: 'Airports', category: 'Transport', type: 'nwr', tags: [{ key: 'aeroway', value: 'aerodrome' }] },

  // Cycling & walking
  { id: 'cycleway', label: 'Cycle paths', category: 'Cycling & walking', type: 'way', tags: [{ key: 'highway', value: 'cycleway' }], keywords: ['bike'] },
  { id: 'bicycle-parking', label: 'Bike parking', category: 'Cycling & walking', type: 'nwr', tags: [{ key: 'amenity', value: 'bicycle_parking' }] },
  { id: 'bicycle-rental', label: 'Bike rental', category: 'Cycling & walking', type: 'nwr', tags: [{ key: 'amenity', value: 'bicycle_rental' }], keywords: ['share'] },
  { id: 'bicycle-repair', label: 'Bike repair stations', category: 'Cycling & walking', type: 'nwr', tags: [{ key: 'amenity', value: 'bicycle_repair_station' }] },
  { id: 'footway', label: 'Footpaths', category: 'Cycling & walking', type: 'way', tags: [{ key: 'highway', value: 'footway' }], keywords: ['pavement', 'sidewalk'] },
  { id: 'hiking-path', label: 'Hiking paths', category: 'Cycling & walking', type: 'way', tags: [{ key: 'highway', value: 'path' }] },
  { id: 'bench', label: 'Benches', category: 'Cycling & walking', type: 'node', tags: [{ key: 'amenity', value: 'bench' }] },

  // Tourism
  { id: 'hotel', label: 'Hotels', category: 'Tourism', type: 'nwr', tags: [{ key: 'tourism', value: 'hotel' }] },
  { id: 'guest-house', label: 'Guest houses', category: 'Tourism', type: 'nwr', tags: [{ key: 'tourism', value: 'guest_house' }], keywords: ['bnb'] },
  { id: 'museum', label: 'Museums', category: 'Tourism', type: 'nwr', tags: [{ key: 'tourism', value: 'museum' }] },
  { id: 'viewpoint', label: 'Viewpoints', category: 'Tourism', type: 'nwr', tags: [{ key: 'tourism', value: 'viewpoint' }] },
  { id: 'attraction', label: 'Attractions', category: 'Tourism', type: 'nwr', tags: [{ key: 'tourism', value: 'attraction' }] },
  { id: 'artwork', label: 'Public artwork', category: 'Tourism', type: 'nwr', tags: [{ key: 'tourism', value: 'artwork' }], keywords: ['statue', 'mural'] },
  { id: 'camp-site', label: 'Campsites', category: 'Tourism', type: 'nwr', tags: [{ key: 'tourism', value: 'camp_site' }] },
  { id: 'historic', label: 'Historic sites', category: 'Tourism', type: 'nwr', tags: [{ key: 'historic' }], keywords: ['heritage', 'monument'] },

  // Leisure
  { id: 'park', label: 'Parks', category: 'Leisure', type: 'nwr', tags: [{ key: 'leisure', value: 'park' }] },
  { id: 'playground', label: 'Playgrounds', category: 'Leisure', type: 'nwr', tags: [{ key: 'leisure', value: 'playground' }] },
  { id: 'sports-pitch', label: 'Sports pitches', category: 'Leisure', type: 'nwr', tags: [{ key: 'leisure', value: 'pitch' }], keywords: ['football', 'court'] },
  { id: 'swimming-pool', label: 'Swimming pools', category: 'Leisure', type: 'nwr', tags: [{ key: 'leisure', value: 'swimming_pool' }] },
  { id: 'fitness', label: 'Gyms', category: 'Leisure', type: 'nwr', tags: [{ key: 'leisure', value: 'fitness_centre' }], keywords: ['fitness'] },
  { id: 'garden', label: 'Gardens', category: 'Leisure', type: 'nwr', tags: [{ key: 'leisure', value: 'garden' }] },
  { id: 'dog-park', label: 'Dog parks', category: 'Leisure', type: 'nwr', tags: [{ key: 'leisure', value: 'dog_park' }] },

  // Education
  { id: 'school', label: 'Schools', category: 'Education', type: 'nwr', tags: [{ key: 'amenity', value: 'school' }] },
  { id: 'kindergarten', label: 'Kindergartens', category: 'Education', type: 'nwr', tags: [{ key: 'amenity', value: 'kindergarten' }], keywords: ['nursery', 'creche'] },
  { id: 'university', label: 'Universities', category: 'Education', type: 'nwr', tags: [{ key: 'amenity', value: 'university' }] },
  { id: 'library', label: 'Libraries', category: 'Education', type: 'nwr', tags: [{ key: 'amenity', value: 'library' }] },
  { id: 'college', label: 'Colleges', category: 'Education', type: 'nwr', tags: [{ key: 'amenity', value: 'college' }] },

  // Money & post
  { id: 'atm', label: 'Cash machines', category: 'Money & post', type: 'nwr', tags: [{ key: 'amenity', value: 'atm' }], keywords: ['atm', 'cash'] },
  { id: 'bank', label: 'Banks', category: 'Money & post', type: 'nwr', tags: [{ key: 'amenity', value: 'bank' }] },
  { id: 'post-office', label: 'Post offices', category: 'Money & post', type: 'nwr', tags: [{ key: 'amenity', value: 'post_office' }] },
  { id: 'post-box', label: 'Post boxes', category: 'Money & post', type: 'node', tags: [{ key: 'amenity', value: 'post_box' }], keywords: ['mailbox'] },
  { id: 'parcel-locker', label: 'Parcel lockers', category: 'Money & post', type: 'nwr', tags: [{ key: 'amenity', value: 'parcel_locker' }] },

  // Public services
  { id: 'toilets', label: 'Public toilets', category: 'Public services', type: 'nwr', tags: [{ key: 'amenity', value: 'toilets' }], keywords: ['wc', 'restroom'] },
  { id: 'police', label: 'Police stations', category: 'Public services', type: 'nwr', tags: [{ key: 'amenity', value: 'police' }] },
  { id: 'fire-station', label: 'Fire stations', category: 'Public services', type: 'nwr', tags: [{ key: 'amenity', value: 'fire_station' }] },
  { id: 'townhall', label: 'Town halls', category: 'Public services', type: 'nwr', tags: [{ key: 'amenity', value: 'townhall' }], keywords: ['mairie', 'city hall'] },
  { id: 'recycling', label: 'Recycling points', category: 'Public services', type: 'nwr', tags: [{ key: 'amenity', value: 'recycling' }] },
  { id: 'waste-basket', label: 'Waste baskets', category: 'Public services', type: 'node', tags: [{ key: 'amenity', value: 'waste_basket' }], keywords: ['bin', 'trash'] },
  { id: 'place-of-worship', label: 'Places of worship', category: 'Public services', type: 'nwr', tags: [{ key: 'amenity', value: 'place_of_worship' }], keywords: ['church', 'mosque', 'temple'] },

  // Infrastructure
  { id: 'street-lamp', label: 'Street lamps', category: 'Infrastructure', type: 'node', tags: [{ key: 'highway', value: 'street_lamp' }] },
  { id: 'power-tower', label: 'Power towers', category: 'Infrastructure', type: 'node', tags: [{ key: 'power', value: 'tower' }], keywords: ['pylon'] },
  { id: 'power-line', label: 'Power lines', category: 'Infrastructure', type: 'way', tags: [{ key: 'power', value: 'line' }] },
  { id: 'substation', label: 'Substations', category: 'Infrastructure', type: 'nwr', tags: [{ key: 'power', value: 'substation' }] },
  { id: 'wind-turbine', label: 'Wind turbines', category: 'Infrastructure', type: 'nwr', tags: [{ key: 'generator:source', value: 'wind' }] },
  { id: 'surveillance', label: 'Surveillance cameras', category: 'Infrastructure', type: 'nwr', tags: [{ key: 'man_made', value: 'surveillance' }], keywords: ['cctv', 'camera'] },

  // Nature & land
  { id: 'tree', label: 'Trees', category: 'Nature & land', type: 'node', tags: [{ key: 'natural', value: 'tree' }] },
  { id: 'wood', label: 'Woods', category: 'Nature & land', type: 'nwr', tags: [{ key: 'natural', value: 'wood' }], keywords: ['forest'] },
  { id: 'water', label: 'Water bodies', category: 'Nature & land', type: 'nwr', tags: [{ key: 'natural', value: 'water' }], keywords: ['lake', 'pond'] },
  { id: 'river', label: 'Rivers', category: 'Nature & land', type: 'way', tags: [{ key: 'waterway', value: 'river' }] },
  { id: 'peak', label: 'Peaks', category: 'Nature & land', type: 'node', tags: [{ key: 'natural', value: 'peak' }], keywords: ['summit', 'mountain'] },
  { id: 'beach', label: 'Beaches', category: 'Nature & land', type: 'nwr', tags: [{ key: 'natural', value: 'beach' }] },
  { id: 'farmland', label: 'Farmland', category: 'Nature & land', type: 'nwr', tags: [{ key: 'landuse', value: 'farmland' }] },
  { id: 'protected-area', label: 'Protected areas', category: 'Nature & land', type: 'nwr', tags: [{ key: 'boundary', value: 'protected_area' }], keywords: ['nature reserve'] },

  // Buildings & addresses
  { id: 'building', label: 'Buildings', category: 'Buildings & addresses', type: 'way', tags: [{ key: 'building' }] },
  { id: 'address', label: 'Addresses', category: 'Buildings & addresses', type: 'nwr', tags: [{ key: 'addr:housenumber' }], keywords: ['house number'] },
  { id: 'entrance', label: 'Entrances', category: 'Buildings & addresses', type: 'node', tags: [{ key: 'entrance' }], keywords: ['door'] },
  { id: 'ruins', label: 'Ruins', category: 'Buildings & addresses', type: 'nwr', tags: [{ key: 'ruins' }] },
  { id: 'construction', label: 'Construction sites', category: 'Buildings & addresses', type: 'nwr', tags: [{ key: 'landuse', value: 'construction' }] },
]

/** Case-insensitive search over labels, tags and keywords. */
export function searchPresets(query: string, limit = 40): Preset[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return PRESETS.slice(0, limit)

  const scored: Array<{ preset: Preset; score: number }> = []

  for (const preset of PRESETS) {
    const label = preset.label.toLowerCase()
    let score = 0

    if (label === needle) score = 100
    else if (label.startsWith(needle)) score = 80
    else if (label.includes(needle)) score = 60
    else if (preset.keywords?.some((k) => k.includes(needle))) score = 50
    else if (preset.tags.some((t) => t.key.includes(needle) || t.value?.includes(needle))) score = 40
    else if (preset.category.toLowerCase().includes(needle)) score = 20

    if (score > 0) scored.push({ preset, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.preset.label.localeCompare(b.preset.label))
    .slice(0, limit)
    .map((entry) => entry.preset)
}

export function presetsByCategory(): Map<string, Preset[]> {
  const map = new Map<string, Preset[]>()
  for (const preset of PRESETS) {
    const list = map.get(preset.category) ?? []
    list.push(preset)
    map.set(preset.category, list)
  }
  return map
}
