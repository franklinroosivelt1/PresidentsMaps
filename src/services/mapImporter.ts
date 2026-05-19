import * as pdfjs from 'pdfjs-dist';

// Initialize PDF.js worker - Use unpkg for reliability with specific version
const PDFJS_VERSION = '5.7.284';
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

export interface GeoPDFMetadata {
  bounds: [[number, number], [number, number]]; // [sw, ne] fallback
  coordinates?: [[number, number], [number, number], [number, number], [number, number]]; // [tl, tr, br, bl]
  image: string; // Base64
}

export async function processGeoPDF(file: File): Promise<GeoPDFMetadata> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Try to find GeoPDF metadata in the binary if possible (best effort)
    const result = await findGeoMetadata(data);
    
    // Render first page to image
    const loadingTask = pdfjs.getDocument({ 
      data,
      useSystemFonts: true,
      disableFontFace: true
    });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    
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

async function findGeoMetadata(data: Uint8Array): Promise<{ bounds: [[number, number], [number, number]], coordinates?: [[number, number], [number, number], [number, number], [number, number]] } | null> {
  const decoder = new TextDecoder('ascii');
  const text = decoder.decode(data.slice(0, 1000000)); // Scan first 1MB
  
  // 1. Try to find GPTS (Ground Points) and LPTS (Local Points) from GeoPDF standard
  const gptsMatch = text.match(/\/GPTS\s*\[(.*?)\]/);
  const lptsMatch = text.match(/\/LPTS\s*\[(.*?)\]/);
  
  if (gptsMatch) {
    try {
      const gpts = gptsMatch[1].split(/[,\s]+/).filter(Boolean).map(Number);
      // GPTS is usually [lat1, lon1, lat2, lon2, ...]
      if (gpts.length >= 4) {
        let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
        const points: [number, number][] = [];
        for (let i = 0; i < gpts.length; i += 2) {
          minLat = Math.min(minLat, gpts[i]);
          maxLat = Math.max(maxLat, gpts[i]);
          minLon = Math.min(minLon, gpts[i+1]);
          maxLon = Math.max(maxLon, gpts[i+1]);
          points.push([gpts[i], gpts[i+1]]);
        }

        // If we also have LPTS, we can estimate how much of the page the map covers
        if (lptsMatch) {
          const lpts = lptsMatch[1].split(/[,\s]+/).filter(Boolean).map(Number);
          if (lpts.length === gpts.length) {
            // LPTS are mapping points on the page. Assuming 4 points [P1, P2, P3, P4]
            // We want to extrapolate these coordinates to the full page [0,0, 1,0, 1,1, 0,1]
            // This is quite complex for general quadrilaterals, but for QGIS it's mostly rectangular viewports
            
            let minX = Math.min(...lpts.filter((_, i) => i % 2 === 0));
            let maxX = Math.max(...lpts.filter((_, i) => i % 2 === 0));
            let minY = Math.min(...lpts.filter((_, i) => i % 2 === 1));
            let maxY = Math.max(...lpts.filter((_, i) => i % 2 === 1));

            const dLat = maxLat - minLat;
            const dLon = maxLon - minLon;
            const dX = maxX - minX;
            const dY = maxY - minY;

            if (dX > 0 && dY > 0) {
              const fullMinLat = minLat - (minY * (dLat / dY));
              const fullMaxLat = maxLat + ((1 - maxY) * (dLat / dY));
              const fullMinLon = minLon - (minX * (dLon / dX));
              const fullMaxLon = maxLon + ((1 - maxX) * (dLon / dX));
              
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
    } catch (e) {}
  }

  // 2. Fallback to /Bounds search
  const boundsMatch = text.match(/\/Bounds\s*\[(.*?)\]/);
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

  // 2. Fallback to /Bounds search
  const boundsMatch = text.match(/\/Bounds\s*\[(.*?)\]/);
  if (boundsMatch) {
    try {
      const parts = boundsMatch[1].split(/[,\s]+/).filter(Boolean).map(Number);
      if (parts.length === 4) {
        if (parts[1] < parts[3] && parts[0] < parts[2]) {
           return [[parts[1], parts[0]], [parts[3], parts[2]]];
        } else if (parts[0] < parts[1] && parts[2] < parts[3]) {
           return [[parts[0], parts[1]], [parts[2], parts[3]]];
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
      const isPossibleLat = (v) => v < 10 && v > -40;
      const isPossibleLon = (v) => v < -30 && v > -85;
      
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
      return [[minLat, minLon], [maxLat, maxLon]];
    }
  }
  
  return null; 
}
