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

    // 3. Extract any specific targets, coordinates, and attributes from the text layer
    const targets = await extractTableTargets(page);
    
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) throw new Error("Could not create canvas context");
    
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas
    }).promise;
    
    const image = canvas.toDataURL('image/jpeg', 0.8);
    
    return {
      bounds: result?.bounds || [[-9.9, -69.5], [-8.8, -68.4]], 
      coordinates: result?.coordinates,
      image,
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
  const clean = str.replace(/,/g, '.').trim();
  
  // Matches DMS like: 8°50'25.3"S, -69°30'36,000", -8°49'12", 9°36'00"
  const dmsMatch = clean.match(/(-?\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*["”]?)?)?\s*([NSWEOO])?/i);
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
      
      if (str.includes('°')) {
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
    
    // Group into rows based on Y coordinate with tolerance of 6 points
    const rows: TextItem[][] = [];
    const sortedByY = [...parsedItems].sort((a, b) => b.y - a.y);
    
    for (const item of sortedByY) {
      let foundRow = false;
      for (const r of rows) {
        if (Math.abs(r[0].y - item.y) < 6.0) {
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
    
    // Merge cell items horizontally if their horizontal gap is tiny
    const mergedRows: string[][] = [];
    for (const r of rows) {
      const mergedCells: string[] = [];
      if (r.length === 0) continue;
      
      let currentCell = r[0].text;
      let lastXEnd = r[0].x + r[0].width;
      
      for (let i = 1; i < r.length; i++) {
        const item = r[i];
        const gap = item.x - lastXEnd;
        
        if (gap < 8.0) {
          currentCell += " " + item.text;
          currentCell = currentCell.replace(/\s+/g, ' ');
          lastXEnd = Math.max(lastXEnd, item.x + item.width);
        } else {
          mergedCells.push(currentCell.trim());
          currentCell = item.text;
          lastXEnd = item.x + item.width;
        }
      }
      mergedCells.push(currentCell.trim());
      mergedRows.push(mergedCells);
    }
    
    const isLatitude = (v: number) => v >= -40.0 && v <= 10.0;
    const isLongitude = (v: number) => v >= -85.0 && v <= -30.0;
    
    const rowsWithCoords: {
      lat: number;
      lng: number;
      potentialArea?: number;
      potentialId?: string;
    }[] = [];
    
    let anonymousCounter = 1;
    
    for (const row of mergedRows) {
      let parsedLat: number | null = null;
      let parsedLng: number | null = null;
      const otherCells: string[] = [];
      
      for (const cellRaw of row) {
        const cell = cellRaw.trim();
        if (!cell) continue;
        
        // Try parsing as DMS or float decimal
        let val = parseDMSToDecimal(cell);
        if (val === null) {
          const cleanFloat = cell.replace(/,/g, '.').replace(/[^\d.-]/g, '');
          const parsed = parseFloat(cleanFloat);
          if (!isNaN(parsed)) {
            val = parsed;
          }
        }
        
        if (val !== null && !isNaN(val)) {
          if (isLatitude(val) && parsedLat === null) {
            parsedLat = val;
          } else if (isLongitude(val) && parsedLng === null) {
            parsedLng = val;
          } else {
            otherCells.push(cell);
          }
        } else {
          otherCells.push(cell);
        }
      }
      
      if (parsedLat !== null && parsedLng !== null) {
        let area: number | undefined = undefined;
        let id: string | undefined = undefined;
        
        for (const cell of otherCells) {
          const clean = cell.toLowerCase().trim();
          
          if (clean.includes('ha') || clean.includes('hec') || clean.includes('área') || clean.includes('area')) {
            const match = clean.match(/(\d+(?:[.,]\d+)?)/);
            if (match) {
              area = parseFloat(match[1].replace(',', '.'));
            }
          } else if (/^\d+(?:[.,]\d+)?$/.test(clean)) {
            const numVal = parseFloat(clean.replace(',', '.'));
            if (numVal > 0 && numVal < 10000) {
              if (clean.includes('.') || clean.includes(',')) {
                area = numVal;
              } else if (!id) {
                id = cell;
              }
            }
          } else if (clean.length > 0 && clean.length < 20) {
            id = cell;
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
          polygonArea: areaVal
        });
      } else {
        // Point POI (center/marker)
        for (const v of vertices) {
          finalPOIs.push({
            id: crypto.randomUUID(),
            name: id.startsWith('Alvo_') ? `Ponto (${id})` : `Alvo ${id}`,
            description: `Ponto de interesse extraído do GeoPDF.\nÁrea informada: ${v.potentialArea ? v.potentialArea.toFixed(4) + ' ha' : 'Não informada'}`,
            lat: v.lat,
            lng: v.lng,
            color,
            createdAt: Date.now(),
            type: 'point',
            visible: true,
            polygonArea: v.potentialArea
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
