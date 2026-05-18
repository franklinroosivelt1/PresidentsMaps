import { POI } from '../types';

export function exportToKML(pois: POI[]) {
  const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>NaviTerra Markers</name>`;

  const kmlFooter = `
  </Document>
</kml>`;

  const kmlBody = pois.map(poi => `
    <Placemark>
      <name>${poi.name}</name>
      <description>${poi.description}</description>
      <Point>
        <coordinates>${poi.lng},${poi.lat},0</coordinates>
      </Point>
      <Style>
        <IconStyle>
          <color>${poi.color.replace('#', 'ff')}</color>
        </IconStyle>
      </Style>
    </Placemark>`).join('');

  const kml = kmlHeader + kmlBody + kmlFooter;
  
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `naviterra_markers_${new Date().getTime()}.kml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
