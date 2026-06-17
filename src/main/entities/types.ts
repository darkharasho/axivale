// src/main/entities/types.ts
export type EntityType = 'skill' | 'trait' | 'item'

export interface EntityFact {
  label: string
  value?: string
}

export interface EntityCard {
  type: EntityType
  name: string
  icon?: string
  subtitle?: string
  description?: string
  facts: EntityFact[]
  wikiUrl: string
}
