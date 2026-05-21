export function parseKMLToGeoJSON(kmlText: string): any {
  const parser = new DOMParser();
  const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
  const features: any[] = [];

  // Parse Points, LineStrings, and Polygons within Placemarks
  const placemarks = kmlDoc.getElementsByTagName('Placemark');
  for (let i = 0; i < placemarks.length; i++) {
    const placemark = placemarks[i];
    const nameEl = placemark.getElementsByTagName('name')[0];
    const name = nameEl ? nameEl.textContent || 'Sem nome' : 'Sem nome';
    const descriptionEl = placemark.getElementsByTagName('description')[0];
    const description = descriptionEl ? descriptionEl.textContent || '' : '';

    // 1. Points
    const points = placemark.getElementsByTagName('Point');
    if (points.length > 0) {
      const coordEl = points[0].getElementsByTagName('coordinates')[0];
      if (coordEl && coordEl.textContent) {
        const parts = coordEl.textContent.trim().split(',');
        if (parts.length >= 2) {
          const lng = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lng)) {
            features.push({
              type: 'Feature',
              properties: { name, description, type: 'Point' },
              geometry: {
                type: 'Point',
                coordinates: [lng, lat]
              }
            });
          }
        }
      }
    }

    // 2. LineStrings (Paths)
    const lineStrings = placemark.getElementsByTagName('LineString');
    if (lineStrings.length > 0) {
      const coordEl = lineStrings[0].getElementsByTagName('coordinates')[0];
      if (coordEl && coordEl.textContent) {
        const coordsStr = coordEl.textContent.trim();
        const coords = coordsStr.split(/\s+/).map(p => {
          const parts = p.split(',');
          return [parseFloat(parts[0]), parseFloat(parts[1])];
        }).filter(c => c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1]));

        if (coords.length > 0) {
          features.push({
            type: 'Feature',
            properties: { name, description, type: 'LineString' },
            geometry: {
              type: 'LineString',
              coordinates: coords
            }
          });
        }
      }
    }

    // 3. Polygons
    const polygons = placemark.getElementsByTagName('Polygon');
    if (polygons.length > 0) {
      const coordEls = polygons[0].getElementsByTagName('coordinates');
      if (coordEls.length > 0) {
        const coordsStr = coordEls[0].textContent?.trim() || '';
        const coords = coordsStr.split(/\s+/).map(p => {
          const parts = p.split(',');
          return [parseFloat(parts[0]), parseFloat(parts[1])];
        }).filter(c => c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1]));

        if (coords.length > 0) {
          features.push({
            type: 'Feature',
            properties: { name, description, type: 'Polygon' },
            geometry: {
              type: 'Polygon',
              coordinates: [coords]
            }
          });
        }
      }
    }
  }

  return {
    type: 'FeatureCollection',
    features: features
  };
}
