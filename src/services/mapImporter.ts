import * as pdfjs from 'pdfjs-dist';
import { POI } from '../types';

// Since some browsers in sandboxed iframes block cross-origin Web Workers, 
// we configure the PDF.js worker using a local same-origin URL built by Vite.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface GeoPDFMetadata {
  bounds: [[number, number], [number, number]]; // [sw, ne] fallback
  coordinates?: [[number, number], [number, number], [number, number], [number, number]]; // [tl, tr, br, bl]
  image: string; // Base64
  targets?: POI[];
}

export async function processGeoPDF(file: File): Promise<GeoPDFMetadata> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Render first page to image and read dimensions
    const loadingTask = pdfjs.getDocument({ 
      data,
      useSystemFonts: true,
      disableFontFace: true
    });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    
    const originalViewport = page.getViewport({ scale: 1.0 });
    const pageWidth = originalViewport.width;
    const pageHeight = originalViewport.height;

    // 1. Try to find precise embedded GeoPDF metadata in the binary first (ArcMap/ArcGIS/QGIS mathematically exact metadata!)
    let result = await findGeoMetadata(data, pageWidth, pageHeight);

    // 2. Fallback to extracting coordinates from the text layer if no embedded binary metadata is present
    if (!result) {
      result = await extractCoordsFromText(page, pageWidth, pageHeight);
    }

    // 3. Extract any specific targets, coordinates, and attributes from the text layer from ALL pages
    const targets: POI[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        const p = await pdf.getPage(pageNum);
        const pageTargets = await extractTableTargets(p);
        if (pageTargets && pageTargets.length > 0) {
          targets.push(...pageTargets);
        }
      } catch (pageErr) {
        console.error(`Error searching page ${pageNum} for targets:`, pageErr);
      }
    }
    
    return {
      bounds: result?.bounds || [[-9.9, -69.5], [-8.8, -68.4]], 
      coordinates: result?.coordinates,
      image: "",
      targets
    };
  } catch (error) {
    console.error("GeoPDF processing error:", error);
    throw error;
  }
}

function linearRegression(points: { key: number; val: number }[]) {
  if (points.length < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  const n = points.length;
  for (const p of points) {
    sumX += p.key;
    sumY += p.val;
    sumXY += p.key * p.val;
    sumXX += p.key * p.key;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-8) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function parseDMSToDecimal(str: string): number | null {
  // Normalize commas to points
  let clean = str.replace(/,/g, '.').trim();
  
  // Replace alternative symbols for degrees with standard °
  clean = clean.replace(/[ººoOª•*·\^]/g, '°');
  // Replace curly or double single quotes with "
  clean = clean.replace(/['’`´]{2}/g, '"');
  clean = clean.replace(/''/g, '"');
  clean = clean.replace(/[”"“«»]/g, '"');
  // Normalize minutes symbols
  clean = clean.replace(/['’`´]/g, "'");

  // Matches DMS like: 8°50'25.3"S, -69°30'36"
  const dmsMatch = clean.match(/(-?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*['\s]\s*(?:(\d+(?:\.\d+)?)\s*["\s]?)?)?\s*([NSWEOO])?/i);
  if (!dmsMatch) return null;
  
  const degVal = parseFloat(dmsMatch[1]);
  const minVal = dmsMatch[2] ? parseFloat(dmsMatch[2]) : 0;
  const secVal = dmsMatch[3] ? parseFloat(dmsMatch[3]) : 0;
  const hemi = dmsMatch[4]?.toUpperCase();
  
  let val = Math.abs(degVal) + minVal / 60 + secVal / 3600;
  if (degVal < 0 || hemi === 'S' || hemi === 'W' || hemi === 'O') {
    val = -val;
  } else {
    // If we have an unsigned coordinate label typical of Brazilian state map layouts,
    // we can infer the hemisphere based on standard South American (Brazil/Acre) limits:
    // Longitude typically between [30, 85] => Oeste (West) => negative
    // Latitude typically between [3, 25] => Sul (South) => negative
    if (val >= 30 && val <= 85) {
      val = -val;
    } else if (val >= 3 && val <= 25) {
      val = -val;
    }
  }
  return val;
}

function isLikelyCoordinateString(str: string): boolean {
  const clean = str.trim();
  if (clean.includes('°') || clean.includes('º') || clean.includes('\'') || clean.includes('"') || /[SWEO]$/i.test(clean)) {
    return true;
  }
  
  const parsed = parseFloat(clean.replace(',', '.'));
  if (!isNaN(parsed)) {
    // Broad coordinate ranges in Acre, Brazil:
    // Longitude ~ [-76, -64] or [64, 76]
    if (parsed <= -64 && parsed >= -76) return true;
    if (parsed >= 64 && parsed <= 76) return true;
    // Latitude ~ [-12, -6] or [6, 12]
    if (parsed <= -6 && parsed >= -12) return true;
    if (parsed >= 6 && parsed <= 12) return true;
  }
  return false;
}

function fitRobustLine(points: { key: number; val: number }[]) {
  if (points.length < 2) return null;
  
  // RANSAC consensus to find collinear grid labels and discard any table cells or text noise
  let bestSlope = 0;
  let bestIntercept = 0;
  let maxInliers = 0;
  let bestInliers: { key: number; val: number }[] = [];
  
  // Check all pairs to find the line with the maximum number of inliers
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const p1 = points[i];
      const p2 = points[j];
      
      const dk = p2.key - p1.key;
      if (Math.abs(dk) < 5) continue; // skip points too close vertically/horizontally
      
      const slope = (p2.val - p1.val) / dk;
      const intercept = p1.val - slope * p1.key;
      
      // Count inliers (points close to this line)
      const inliers = points.filter(p => {
        const expectedVal = slope * p.key + intercept;
        return Math.abs(p.val - expectedVal) < 0.01; // generous tolerance for minor layout offsets
      });
      
      if (inliers.length > maxInliers) {
        maxInliers = inliers.length;
        bestSlope = slope;
        bestIntercept = intercept;
        bestInliers = inliers;
      }
    }
  }
  
  if (maxInliers >= 2) {
    return linearRegression(bestInliers);
  }
  
  // Fallback to simple regression if consensus fails
  return linearRegression(points);
}

async function extractCoordsFromText(
  page: any, 
  pageWidth: number, 
  pageHeight: number
): Promise<{ bounds: [[number, number], [number, number]], coordinates?: [[number, number], [number, number], [number, number], [number, number]] } | null> {
  try {
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];
    
    const candidates: { val: number; x: number; y: number; str: string }[] = [];
    
    for (const item of items) {
      if (!item.str || !item.transform) continue;
      const str = item.str.trim();
      
      if (isLikelyCoordinateString(str)) {
        const val = parseDMSToDecimal(str);
        if (val !== null && !isNaN(val)) {
          const x = item.transform[4];
          const y = item.transform[5];
          candidates.push({ val, x, y, str });
        }
      }
    }
    
    if (candidates.length === 0) return null;
    
    // Classify into Latitude and Longitude candidates (generous South America / Acre bounds)
    // Latitude is typically between -40.0 and +10.0
    // Longitude is typically between -85.0 and -30.0
    const latCandidates = candidates.filter(c => c.val >= -40.0 && c.val <= 10.0);
    const lngCandidates = candidates.filter(c => c.val >= -85.0 && c.val <= -30.0);
    
    const latRegression = fitRobustLine(latCandidates.map(c => ({ key: c.y, val: c.val })));
    const lngRegression = fitRobustLine(lngCandidates.map(c => ({ key: c.x, val: c.val })));
    
    if (latRegression && lngRegression) {
      const LatY = (y: number) => latRegression.slope * y + latRegression.intercept;
      const LngX = (x: number) => lngRegression.slope * x + lngRegression.intercept;
      
      const fullMinLat = LatY(0);
      const fullMaxLat = LatY(pageHeight);
      const fullMinLon = LngX(0);
      const fullMaxLon = LngX(pageWidth);
      
      // Safety and sanity validation check
      const isValid = 
        !isNaN(fullMinLat) && !isNaN(fullMaxLat) &&
        !isNaN(fullMinLon) && !isNaN(fullMaxLon) &&
        fullMinLat >= -50.0 && fullMaxLat <= 15.0 &&
        fullMinLon >= -90.0 && fullMaxLon <= -20.0 &&
        Math.abs(fullMaxLat - fullMinLat) < 8.0 && // limit a single layout to 8 deg width
        Math.abs(fullMaxLon - fullMinLon) < 8.0;

      if (!isValid) {
        console.warn("Text extraction returned out-of-bound / unrealistic coordinates. Discarding.", fullMinLat, fullMaxLat, fullMinLon, fullMaxLon);
        return null;
      }

      console.log("Robust georeferenced bounds:", fullMinLat, fullMaxLat, fullMinLon, fullMaxLon);
      
      return {
        bounds: [[fullMinLat, fullMinLon], [fullMaxLat, fullMaxLon]],
        coordinates: [
          [fullMinLon, fullMaxLat], // tl
          [fullMaxLon, fullMaxLat], // tr
          [fullMaxLon, fullMinLat], // br
          [fullMinLon, fullMinLat]  // bl
        ]
      };
    }
  } catch (err) {
    console.error("Error in text coordinate extraction:", err);
  }
  return null;
}

function extractMetadataText(data: Uint8Array): string {
  const keys = ['/GPTS', '/LPTS', '/Bounds', '/Measure', '/LGIDict', '/Viewport'];
  const ranges: { start: number; end: number }[] = [];
  
  // Find occurrences of key terms in binary
  for (const key of keys) {
    const keyBytes = key.split('').map(c => c.charCodeAt(0));
    let lastIndex = 0;
    while (true) {
      const idx = data.indexOf(keyBytes[0], lastIndex);
      if (idx === -1) break;
      
      // Verify match
      let match = true;
      for (let j = 1; j < keyBytes.length; j++) {
        if (data[idx + j] !== keyBytes[j]) {
          match = false;
          break;
        }
      }
      
      if (match) {
        // Core dictionary key found, slice a substantial contextual lookup window around it (10KB before, 80KB after)
        const start = Math.max(0, idx - 10000);
        const end = Math.min(data.length, idx + 80000);
        ranges.push({ start, end });
        lastIndex = idx + keyBytes.length;
      } else {
        lastIndex = idx + 1;
      }
      
      // Cap matches to prevent infinite loops or giant text buffer layouts
      if (ranges.length > 80) break;
    }
  }
  
  // Also include the first 500KB and last 500KB as fallback envelopes
  ranges.push({ start: 0, end: Math.min(data.length, 500000) });
  ranges.push({ start: Math.max(0, data.length - 500000), end: data.length });
  
  // Merge ranges
  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    if (merged.length === 0) {
      merged.push(r);
    } else {
      const last = merged[merged.length - 1];
      if (r.start <= last.end) {
        last.end = Math.max(last.end, r.end);
      } else {
        merged.push(r);
      }
    }
  }
  
  // Decode only these specific segments
  const decoder = new TextDecoder('ascii');
  let resultText = '';
  for (const r of merged) {
    resultText += decoder.decode(data.subarray(r.start, r.end)) + "\n";
  }
  return resultText;
}

async function findGeoMetadata(
  data: Uint8Array, 
  pageWidth: number, 
  pageHeight: number
): Promise<{ bounds: [[number, number], [number, number]], coordinates?: [[number, number], [number, number], [number, number], [number, number]] } | null> {
  try {
    const text = extractMetadataText(data);
    
    // 1. Try to find GPTS (Ground Points) and LPTS (Local Points) from GeoPDF standard with multiline support
    const gptsMatch = text.match(/\/GPTS\s*\[([\s\S]*?)\]/);
    const lptsMatch = text.match(/\/LPTS\s*\[([\s\S]*?)\]/);
    
    if (gptsMatch) {
      try {
        const gpts = gptsMatch[1].split(/[,\s]+/).filter(Boolean).map(Number);
        // GPTS is usually [lat1, lon1, lat2, lon2, ...]
        if (gpts.length >= 4) {
          // Detect if GPTS is in lat,lon or lon,lat order
          let isLatLon = true;
          if (gpts.length >= 2) {
            const v1 = gpts[0];
            const v2 = gpts[1];
            // Longitude is always more negative in South America (e.g., v1 = -68, v2 = -9 implies first element is longitude)
            if (v1 < v2) {
              isLatLon = false;
            }
          }

          let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
          for (let i = 0; i < gpts.length; i += 2) {
            const lat = isLatLon ? gpts[i] : gpts[i+1];
            const lon = isLatLon ? gpts[i+1] : gpts[i];
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLon = Math.min(minLon, lon);
            maxLon = Math.max(maxLon, lon);
          }

          // If we also have LPTS, we can estimate how much of the page the map covers
          if (lptsMatch) {
            const lpts = lptsMatch[1].split(/[,\s]+/).filter(Boolean).map(Number);
            if (lpts.length === gpts.length) {
              // LPTS are mapping points on the page. Assuming coordinate pairs [x, y]
              let minX = Math.min(...lpts.filter((_, i) => i % 2 === 0));
              let maxX = Math.max(...lpts.filter((_, i) => i % 2 === 0));
              let minY = Math.min(...lpts.filter((_, i) => i % 2 === 1));
              let maxY = Math.max(...lpts.filter((_, i) => i % 2 === 1));

              // Auto-detect if raw PDF points or normalized page coordinates
              const maxLptsVal = Math.max(...lpts);
              const isRawPoints = maxLptsVal > 1.5;

              const scaleX = isRawPoints ? pageWidth : 1;
              const scaleY = isRawPoints ? pageHeight : 1;

              const normMinX = minX / scaleX;
              const normMaxX = maxX / scaleX;
              const normMinY = minY / scaleY;
              const normMaxY = maxY / scaleY;

              const dLat = maxLat - minLat;
              const dLon = maxLon - minLon;
              const dX = normMaxX - normMinX;
              const dY = normMaxY - normMinY;

              if (dX > 0 && dY > 0) {
                const fullMinLat = minLat - (normMinY * (dLat / dY));
                const fullMaxLat = maxLat + ((1 - normMaxY) * (dLat / dY));
                const fullMinLon = minLon - (normMinX * (dLon / dX));
                const fullMaxLon = maxLon + ((1 - normMaxX) * (dLon / dX));
                
                // Final validation guard
                const isValid = 
                  !isNaN(fullMinLat) && !isNaN(fullMaxLat) &&
                  !isNaN(fullMinLon) && !isNaN(fullMaxLon) &&
                  fullMinLat >= -50.0 && fullMaxLat <= 15.0 &&
                  fullMinLon >= -90.0 && fullMaxLon <= -20.0;

                if (isValid) {
                  const fullBounds: [[number, number], [number, number]] = [[fullMinLat, fullMinLon], [fullMaxLat, fullMaxLon]];
                  const fullCoords: [[number, number], [number, number], [number, number], [number, number]] = [
                    [fullMinLon, fullMaxLat], // tl
                    [fullMaxLon, fullMaxLat], // tr
                    [fullMaxLon, fullMinLat], // br
                    [fullMinLon, fullMinLat]  // bl
                  ];
                  console.log("Successfully extracted binary GPTS/LPTS georeference details");
                  return { bounds: fullBounds, coordinates: fullCoords };
                }
              }
            }
          }

          // Fallback bounds
          if (minLat >= -50 && maxLat <= 15 && minLon >= -90 && maxLon <= -20) {
            return { bounds: [[minLat, minLon], [maxLat, maxLon]] };
          }
        }
      } catch (e) {
        console.error("Error processing GPTS/LPTS:", e);
      }
    }

    // 2. Fallback to /Bounds search with multiline support
    const boundsMatch = text.match(/\/Bounds\s*\[([\s\S]*?)\]/);
    if (boundsMatch) {
      try {
        const parts = boundsMatch[1].split(/[,\s]+/).filter(Boolean).map(Number);
        if (parts.length === 4) {
          let b1 = parts[1];
          let b0 = parts[0];
          let b3 = parts[3];
          let b2 = parts[2];
          
          if (b1 < b3 && b0 < b2) {
             const bounds: [[number, number], [number, number]] = [[b1, b0], [b3, b2]];
             if (b1 >= -50 && b3 <= 15 && b0 >= -90 && b2 <= -20) return { bounds };
          } else if (b0 < b1 && b2 < b3) {
             const bounds: [[number, number], [number, number]] = [[b0, b1], [b2, b3]];
             if (b0 >= -50 && b2 <= 15 && b1 >= -90 && b3 <= -20) return { bounds };
          }
        }
      } catch (e) {}
    }

    // 3. Fallback to coordinate harvesting (last resort, with tight South America limits)
    const coordRegex = /(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/g;
    const matches = [...text.matchAll(coordRegex)];
    
    if (matches.length > 10) {
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      let found = false;
      
      matches.forEach(m => {
        const v1 = parseFloat(m[1]);
        const v2 = parseFloat(m[2]);
        const isPossibleLat = (v: number) => v < 10 && v > -40;
        const isPossibleLon = (v: number) => v < -30 && v > -85;
        
        if (isPossibleLat(v1) && isPossibleLon(v2)) {
          minLat = Math.min(minLat, v1);
          maxLat = Math.max(maxLat, v1);
          minLon = Math.min(minLon, v2);
          maxLon = Math.max(maxLon, v2);
          found = true;
        } else if (isPossibleLat(v2) && isPossibleLon(v1)) {
          minLat = Math.min(minLat, v2);
          maxLat = Math.max(maxLat, v2);
          minLon = Math.min(minLon, v1);
          maxLon = Math.max(maxLon, v1);
          found = true;
        }
      });
      
      if (found && (maxLat - minLat > 0.01) && (maxLon - minLon > 0.01) && (maxLat - minLat < 8) && (maxLon - minLon < 8)) {
        return { bounds: [[minLat, minLon], [maxLat, maxLon]] };
      }
    }
  } catch (err) {
    console.error("Error in binary findGeoMetadata:", err);
  }
  
  return null; 
}

interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function generateCircleVertices(centerLat: number, centerLng: number, areaHa: number, numPoints = 16): { lat: number; lng: number }[] {
  // Area in m^2 = areaHa * 10000
  // pi * r^2 = areaHa * 10000 => r = sqrt((areaHa * 10000) / pi)
  const radiusMeters = Math.sqrt((areaHa * 10000) / Math.PI);
  
  // Earth radius in meters
  const earthRadius = 6378137;
  const points: { lat: number; lng: number }[] = [];
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i * 2 * Math.PI) / numPoints;
    
    // Offset in meters
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);
    
    // Coordinate offsets in radians
    const dLat = dy / earthRadius;
    const dLng = dx / (earthRadius * Math.cos((centerLat * Math.PI) / 180));
    
    // New coordinates in degrees
    const lat = centerLat + (dLat * 180) / Math.PI;
    const lng = centerLng + (dLng * 180) / Math.PI;
    
    points.push({ lat, lng });
  }
  
  return points;
}

// Reconstruct text rows and columns using Y vertical alignment tolerance with X horizontal order
async function extractTableTargets(page: any): Promise<POI[]> {
  try {
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];
    
    const parsedItems: TextItem[] = items
      .filter(item => item.str && item.str.trim().length > 0)
      .map(item => ({
        text: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        height: item.height || 0
      }));
      
    if (parsedItems.length === 0) return [];
    
    // Group into rows based on Y coordinate with tolerance of 8.0 points
    const rows: TextItem[][] = [];
    const sortedByY = [...parsedItems].sort((a, b) => b.y - a.y);
    
    for (const item of sortedByY) {
      let foundRow = false;
      for (const r of rows) {
        if (Math.abs(r[0].y - item.y) < 8.0) {
          r.push(item);
          foundRow = true;
          break;
        }
      }
      if (!foundRow) {
        rows.push([item]);
      }
    }
    
    // Sort each row left to right
    for (const r of rows) {
      r.sort((a, b) => a.x - b.x);
    }
    
    const rowsWithCoords: {
      lat: number;
      lng: number;
      potentialArea?: number;
      potentialId?: string;
    }[] = [];
    
    let anonymousCounter = 1;
    
    for (const r of rows) {
      if (r.length === 0) continue;
      
      const rowText = r.map(item => item.text).join(' ');
      
      let normalized = rowText
        .replace(/,/g, '.') // replace comma with point
        .replace(/[ººoOª•*·\^]/g, '°')
        .replace(/['’`´]{2}/g, '"')
        .replace(/''/g, '"')
        .replace(/[”"“«»]/g, '"')
        .replace(/['’`´]/g, "'");

      // 1. Scan for DMS strings
      const dmsMatches: { val: number; matchesLat: boolean }[] = [];
      const dmsRegex = /(\d+)\s*°?\s*(\d+)\s*'\s*(\d+(?:\.\d+)?)\s*"?\s*([NSWEOO])/gi;
      let dmsMatch;
      while ((dmsMatch = dmsRegex.exec(normalized)) !== null) {
        const deg = parseFloat(dmsMatch[1]);
        const min = parseFloat(dmsMatch[2]);
        const sec = parseFloat(dmsMatch[3]);
        const hemi = dmsMatch[4].toUpperCase();
        
        let val = deg + min / 60 + sec / 3600;
        if (hemi === 'S' || hemi === 'W' || hemi === 'O') {
          val = -val;
        }
        const matchesLat = (hemi === 'S' || hemi === 'N');
        dmsMatches.push({ val, matchesLat });
      }

      let parsedLat: number | null = null;
      let parsedLng: number | null = null;

      if (dmsMatches.length >= 2) {
        const latObj = dmsMatches.find(m => m.matchesLat);
        const lngObj = dmsMatches.find(m => !m.matchesLat);
        if (latObj && lngObj) {
          parsedLat = latObj.val;
          parsedLng = lngObj.val;
        } else {
          // Classify by Brazilian coordinate magnitudes
          const first = dmsMatches[0].val;
          const second = dmsMatches[1].val;
          if (Math.abs(first) <= 35 && Math.abs(second) > 30) {
            parsedLat = first;
            parsedLng = second;
          } else if (Math.abs(second) <= 35 && Math.abs(first) > 30) {
            parsedLat = second;
            parsedLng = first;
          }
        }
      }

      // 2. Scan for decimals
      if (parsedLat === null || parsedLng === null) {
        const decimalMatches: number[] = [];
        const decimalRegex = /(-?\d+\.\d+)/g;
        let decMatch;
        while ((decMatch = decimalRegex.exec(normalized)) !== null) {
          const val = parseFloat(decMatch[1]);
          decimalMatches.push(val);
        }

        if (decimalMatches.length >= 2) {
          const first = decimalMatches[0];
          const second = decimalMatches[1];
          const firstAbs = Math.abs(first);
          const secondAbs = Math.abs(second);

          let latVal: number | null = null;
          let lngVal: number | null = null;

          if (firstAbs <= 35 && secondAbs > 30 && secondAbs <= 85) {
            latVal = first;
            lngVal = second;
          } else if (secondAbs <= 35 && firstAbs > 30 && firstAbs <= 85) {
            latVal = second;
            lngVal = first;
          }

          if (latVal !== null && lngVal !== null) {
            if (latVal > 0 && latVal >= 3 && latVal <= 35) latVal = -latVal;
            if (lngVal > 0 && lngVal >= 30 && lngVal <= 85) lngVal = -lngVal;
            parsedLat = latVal;
            parsedLng = lngVal;
          }
        }
      }

      if (parsedLat !== null && parsedLng !== null) {
        // Extract Area
        let area: number | undefined = undefined;
        const areaPatterns = [
          /(\d+(?:[.,]\d+)?)\s*(?:ha|hectares?|hec|área|area)/i,
          /(?:área|area|hec|ha):?\s*(\d+(?:[.,]\d+)?)/i
        ];
        for (const pattern of areaPatterns) {
          const areaMatch = rowText.match(pattern);
          if (areaMatch) {
            area = parseFloat(areaMatch[1].replace(',', '.'));
            break;
          }
        }

        // Extract ID Ponto
        let id: string | undefined = undefined;
        const idMatch = rowText.match(/(?:alvo|ponto|id|lote|talhão|ponto_id)\s*#?\s*([a-f0-9_-]+)/i);
        if (idMatch) {
          id = idMatch[1];
        } else {
          const words = r.map(item => item.text).filter(word => {
            const w = word.toLowerCase().trim();
            if (w.includes('°') || w.includes('\'') || w.includes('"') || w.includes('lat') || w.includes('lon') || w.includes('alt') || w.includes('dec')) {
              return false;
            }
            if (/^(?:ha|área|area|coordenadas|leitura|tabela|ponto|alvo)$/i.test(w)) {
              return false;
            }
            const num = parseFloat(w.replace(',', '.'));
            if (!isNaN(num) && (Math.abs(num) > 2.0 && Math.abs(num) < 180.0)) {
              return false;
            }
            return w.length > 0;
          });

          if (words.length > 0) {
            id = words[0];
          }
        }

        rowsWithCoords.push({
          lat: parsedLat,
          lng: parsedLng,
          potentialArea: area,
          potentialId: id
        });
      }
    }
    
    // Group values by parent ID to construct polygons if there are multiple vertices sharing an ID
    const finalPOIs: POI[] = [];
    const groups: { [id: string]: typeof rowsWithCoords } = {};
    
    for (const item of rowsWithCoords) {
      const id = item.potentialId || `Alvo_${anonymousCounter++}`;
      if (!groups[id]) {
        groups[id] = [];
      }
      groups[id].push(item);
    }
    
    for (const [id, vertices] of Object.entries(groups)) {
      const color = '#facc15'; // Yellow like target highlight shapes in the screenshot
      
      if (vertices.length >= 3) {
        // Build Area Polygon POI
        const latSum = vertices.reduce((sum, v) => sum + v.lat, 0);
        const lngSum = vertices.reduce((sum, v) => sum + v.lng, 0);
        const centerLat = latSum / vertices.length;
        const centerLng = lngSum / vertices.length;
        
        const areaVal = vertices[0].potentialArea || vertices.find(v => v.potentialArea !== undefined)?.potentialArea;
        
        finalPOIs.push({
          id: crypto.randomUUID(),
          name: id.startsWith('Alvo_') ? `Polígono (${id})` : `Alvo ${id}`,
          description: `Polígono de interesse extraído do GeoPDF.\nÁrea estimada: ${areaVal ? areaVal.toFixed(4) + ' ha' : 'Não especificada'}`,
          lat: centerLat,
          lng: centerLng,
          color,
          createdAt: Date.now(),
          type: 'area',
          visible: true,
          pathPoints: vertices.map(v => ({ lat: v.lat, lng: v.lng })),
          polygonArea: areaVal,
          pdfTargetId: id
        });
      } else {
        // Point POI (center/marker)
        for (const v of vertices) {
          const hasArea = v.potentialArea && v.potentialArea > 0;
          finalPOIs.push({
            id: crypto.randomUUID(),
            name: id.startsWith('Alvo_') ? `Ponto (${id})` : `Alvo ${id}`,
            description: `Área informada: ${v.potentialArea ? v.potentialArea.toFixed(4) + ' ha' : 'Não informada'}`,
            lat: v.lat,
            lng: v.lng,
            color,
            createdAt: Date.now(),
            type: hasArea ? 'area' : 'point',
            visible: true,
            polygonArea: v.potentialArea,
            pdfTargetId: id,
            pathPoints: hasArea ? generateCircleVertices(v.lat, v.lng, v.potentialArea!) : undefined
          });
        }
      }
    }
    
    console.log(`Extracted ${finalPOIs.length} targets/POIs from PDF text layer.`);
    return finalPOIs;
  } catch (err) {
    console.error("Error extracting table targets from PDF text layer:", err);
    return [];
  }
}
