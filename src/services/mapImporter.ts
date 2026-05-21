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

    // Try to find GeoPDF metadata in the binary if possible (best effort)
    const result = await findGeoMetadata(data, pageWidth, pageHeight);
    
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

async function findGeoMetadata(
  data: Uint8Array, 
  pageWidth: number, 
  pageHeight: number
): Promise<{ bounds: [[number, number], [number, number]], coordinates?: [[number, number], [number, number], [number, number], [number, number]] } | null> {
  const decoder = new TextDecoder('ascii');
  const text = decoder.decode(data.slice(0, 1000000)); // Scan first 1MB
  
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
