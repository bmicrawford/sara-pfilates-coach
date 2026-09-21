import { readJson, writeJson } from './storage.ts'
import type { DrinkVolumeUnit } from './types.ts'

/** Slider ends. 36 US fl oz is the top of the drink control. */
export const DRINK_OZ_MIN = 1
export const DRINK_OZ_MAX = 36
/** A typical glass, used as the slider’s starting point. */
export const DRINK_OZ_DEFAULT = 8

/**
 * US fluid ounce in milliliters.
 * 1 oz ≈ 30 ml and 36 oz ≈ 1,065 ml once rounded for the slider.
 */
export const ML_PER_OZ = 29.5735295625

export const DRINK_UNIT_STORAGE_KEY = 'drinkUnit'

export function ozToMl(oz: number): number {
  return Math.round(oz * ML_PER_OZ)
}

export function clampOz(oz: number): number {
  if (!Number.isFinite(oz)) return DRINK_OZ_MIN
  return Math.min(DRINK_OZ_MAX, Math.max(DRINK_OZ_MIN, Math.round(oz)))
}

export function clampMl(ml: number): number {
  const min = ozToMl(DRINK_OZ_MIN)
  const max = ozToMl(DRINK_OZ_MAX)
  if (!Number.isFinite(ml)) return min
  return Math.min(max, Math.max(min, Math.round(ml)))
}

/** Nearest ounce inside 1–36. Used when switching the slider back from ml. */
export function mlToOz(ml: number): number {
  return clampOz(clampMl(ml) / ML_PER_OZ)
}

export function sliderBounds(unit: DrinkVolumeUnit): { min: number; max: number; step: number } {
  if (unit === 'ml') {
    return { min: ozToMl(DRINK_OZ_MIN), max: ozToMl(DRINK_OZ_MAX), step: 1 }
  }
  return { min: DRINK_OZ_MIN, max: DRINK_OZ_MAX, step: 1 }
}

/** Fields written onto a drink event. `amount` is what summaries and the PDF already print. */
export function drinkEventVolume(
  value: number,
  unit: DrinkVolumeUnit,
): { amount: string; volumeOz: number; volumeUnit: DrinkVolumeUnit } {
  if (unit === 'ml') {
    const ml = clampMl(value)
    return {
      amount: `${ml} ml`,
      volumeOz: ml / ML_PER_OZ,
      volumeUnit: 'ml',
    }
  }
  const oz = clampOz(value)
  return {
    amount: `${oz} oz`,
    volumeOz: oz,
    volumeUnit: 'oz',
  }
}

export function readDrinkUnit(): DrinkVolumeUnit {
  const raw = readJson<unknown>(DRINK_UNIT_STORAGE_KEY, 'oz')
  return raw === 'ml' ? 'ml' : 'oz'
}

export function writeDrinkUnit(unit: DrinkVolumeUnit): void {
  writeJson(DRINK_UNIT_STORAGE_KEY, unit)
}
