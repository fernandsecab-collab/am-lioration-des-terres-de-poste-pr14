export const EARTH_RADIUS_M = 6378137;

/** Distance orthodromique entre deux coordonnées WGS84, en mètres. */
export function distanceMeters(aLng, aLat, bLng, bLat) {
  const lat1 = Number(aLat) * Math.PI / 180;
  const lat2 = Number(bLat) * Math.PI / 180;
  const dLat = (Number(bLat) - Number(aLat)) * Math.PI / 180;
  const dLng = (Number(bLng) - Number(aLng)) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
