import * as pdfjs from 'pdfjs-dist';

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

    // 1. Try to extract grid coordinates printed in the PDF's text layer (super precise!)
    let result = await extractCoordsFromText(page, pageWidth, pageHeight);

    // 2. Fallback to finding GeoPDF metadata in the binary if text layer grids are not found
    if (!result) {
      result = await findGeoMetadata(data, pageWidth, pageHeight);
    }
    
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
      image
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
        return Math.abs(p.val - expectedVal) < 0.001; // tight tolerance
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

async function findGeoMetadata(
  data: Uint8Array, 
  pageWidth: number, 
  pageHeight: number
): Promise<{ bounds: [[number, number], [number, number]], coordinates?: [[number, number], [number, number], [number, number], [number, number]] } | null> {
  // Only decode the metadata segments (first 500KB and last 500KB of binary)
  // Georeference dictionary objects are loaded at the startup or trailer tables, skips giant compressed image blobs.
  let dataToDecode = data;
  if (data.length > 1000000) {
    const head = data.slice(0, 500000);
    const tail = data.slice(data.length - 500000);
    dataToDecode = new Uint8Array(head.length + tail.length);
    dataToDecode.set(head, 0);
    dataToDecode.set(tail, head.length);
  }

  const decoder = new TextDecoder('ascii');
  const text = decoder.decode(dataToDecode);
  
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
              
              const fullBounds: [[number, number], [number, number]] = [[fullMinLat, fullMinLon], [fullMaxLat, fullMaxLon]];
              const fullCoords: [[number, number], [number, number], [number, number], [number, number]] = [
                [fullMinLon, fullMaxLat], // tl
                [fullMaxLon, fullMaxLat], // tr
                [fullMaxLon, fullMinLat], // br
                [fullMinLon, fullMinLat]  // bl
              ];
              return { bounds: fullBounds, coordinates: fullCoords };
            }
          }
        }

        return { bounds: [[minLat, minLon], [maxLat, maxLon]] };
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
        if (parts[1] < parts[3] && parts[0] < parts[2]) {
           return { bounds: [[parts[1], parts[0]], [parts[3], parts[2]]] };
        } else if (parts[0] < parts[1] && parts[2] < parts[3]) {
           return { bounds: [[parts[0], parts[1]], [parts[2], parts[3]]] };
        }
      }
    } catch (e) {}
  }

  // 3. Fallback to coordinate harvesting (last resort)
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
    
    if (found && (maxLat - minLat > 0.01) && (maxLon - minLon > 0.01)) {
      return { bounds: [[minLat, minLon], [maxLat, maxLon]] };
    }
  }
  
  return null; 
}
