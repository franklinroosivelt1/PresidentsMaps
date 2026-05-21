import UtmConverter from 'utm-latlng';

const utmObj = new UtmConverter();

export interface DMSCoordinate {
  degrees: number;
  minutes: number;
  seconds: number;
  direction: 'N' | 'S' | 'E' | 'W';
}

// Convert decimal degrees, minutes, seconds to decimal coordinate
export function dmsToDecimal(degrees: number, minutes: number, seconds: number, direction: 'N' | 'S' | 'E' | 'W'): number {
  let decimal = Math.abs(degrees) + (Math.abs(minutes) / 60) + (Math.abs(seconds) / 3600);
  if (direction === 'S' || direction === 'W') {
    decimal = -decimal;
  }
  return decimal;
}

// Convert decimal coordinate to DMS
export function decimalToDMS(coord: number, isLat: boolean): DMSCoordinate {
  const abs = Math.abs(coord);
  const degrees = Math.floor(abs);
  const minutesDec = (abs - degrees) * 60;
  const minutes = Math.floor(minutesDec);
  const seconds = Math.round((minutesDec - minutes) * 6000) / 100; // 2 decimal precision
  const direction = isLat ? (coord >= 0 ? 'N' : 'S') : (coord >= 0 ? 'E' : 'W');
  return { degrees, minutes, seconds, direction };
}

// Convert LatLng to UTM
export function latLngToUTM(lat: number, lng: number) {
  try {
    const utm = (utmObj as any).convertLatLngToUtm(lat, lng, 1);
    return {
      zoneNumber: Math.round(utm.ZoneNumber),
      zoneLetter: utm.ZoneLetter as string,
      easting: Math.round(utm.Easting),
      northing: Math.round(utm.Northing)
    };
  } catch (e) {
    console.error("UTM conversion error:", e);
    return {
      zoneNumber: 23,
      zoneLetter: 'K',
      easting: 0,
      northing: 0
    };
  }
}

// Convert UTM to LatLng
export function utmToLatLng(easting: number, northing: number, zoneNumber: number, zoneLetter: string): { lat: number; lng: number } | null {
  try {
    const res = utmObj.convertUtmToLatLng(easting, northing, zoneNumber, zoneLetter) as any;
    const lat = res.lat ?? res.latitude ?? res.Latitude;
    const lng = res.lng ?? res.longitude ?? res.Longitude;
    if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
    return null;
  } catch (e) {
    console.error("LatLng conversion error:", e);
    return null;
  }
}
