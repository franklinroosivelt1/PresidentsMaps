import * as pdfjs from 'pdfjs-dist';

// Initialize PDF.js worker - Use unpkg for reliability with specific version
const PDFJS_VERSION = '5.7.284';
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

export interface GeoPDFMetadata {
  bounds: [[number, number], [number, number]]; // [sw, ne]
  image: string; // Base64
}

export async function processGeoPDF(file: File): Promise<GeoPDFMetadata> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    
    // Try to find GeoPDF metadata in the binary if possible (best effort)
    const bounds = await findBoundsInPDF(data);
    
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
      bounds: bounds || [[-9.9, -69.5], [-8.8, -68.4]], 
      image
    };
  } catch (error) {
    console.error("GeoPDF processing error:", error);
    throw error;
  }
}

async function findBoundsInPDF(data: Uint8Array): Promise<[[number, number], [number, number]] | null> {
  const decoder = new TextDecoder('ascii');
  const text = decoder.decode(data.slice(0, 500000)); 
  
  // Look for /Measure dictionary or common GeoPDF patterns
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
