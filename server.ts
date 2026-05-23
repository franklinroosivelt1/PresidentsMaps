import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

// Ensure Gemini setup matches skills guidelines
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Set generous limits for base64 map pages rendering
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ limit: '25mb', extended: true }));

  // API Route: Healthcheck
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API Route: Gemini map image semantic extraction
  app.post("/api/parse-map-image", async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ error: "No image provided" });
      }

      if (!process.env.GEMINI_API_KEY) {
        console.warn("GEMINI_API_KEY environment variable is not defined");
        return res.status(500).json({ error: "Gemini API key is not configured in secrets." });
      }

      // Extract base64 details
      const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: "Invalid base64 image data structure." });
      }
      const mimeType = match[1];
      const base64Data = match[2];

      const prompt = `Você é um leitor especialista em mapas georreferenciados e monitoramento ambiental no Acre, Brasil.
Dada a imagem deste mapa geográfico, identifique a tabela impressa que contém as coordenadas dos alvos de monitoramento.
A tabela possui colunas semelhantes a: id_BPA | area_ha | lat_centro | long_centr
Exemplo:
254 | 12,2996260000 | 8°44'23.7"S | 69°22'51.6"W

Extraia individualmente cada uma das linhas da tabela encontrada no mapa.
Para cada item detectado, capture:
- id: o identificador exato da coluna id_BPA (ex: "264", "263", "262", "260", etc)
- area_ha: o valor numérico exato em hectares da área do polígono (ex: 2.758895)
- lat_centro_dms: a coordenada lat_centro exatamente como consta (ex: "8°50'25.3\"S")
- long_centr_dms: a coordenada long_centr exatamente como consta (ex: "69°26'24.1\"W")

Mapeie-os e retorne estritamente um JSON estruturado seguindo o modelo. Se houver múltiplos alvos listados na tabela, retorne todos eles.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          { text: prompt }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              targets: {
                type: Type.ARRAY,
                description: "Lista de alvos de monitoramento ambiental extraídos do mapa",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: "Código d_BPA da tabela" },
                    area_ha: { type: Type.NUMBER, description: "Área em hectares" },
                    lat_centro_dms: { type: Type.STRING, description: "Latitude no formato DMS original" },
                    long_centr_dms: { type: Type.STRING, description: "Longitude no formato DMS original" }
                  },
                  required: ["id", "area_ha", "lat_centro_dms", "long_centr_dms"]
                }
              }
            },
            required: ["targets"]
          }
        }
      });

      const responseText = response.text || "{}";
      const parsedData = JSON.parse(responseText.trim());
      console.log(`Success: Extracted ${parsedData.targets?.length || 0} targets via Gemini OCR fallback`);
      return res.json(parsedData);
    } catch (error: any) {
      console.error("Error in server map-parser endpoint:", error);
      return res.status(500).json({ error: error.message || "Interpretação via IA falhou, tente novamente." });
    }
  });

  // API Route: Gemini map text layer semantic extraction (QGIS PDF standard)
  app.post("/api/parse-map-text", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Nenhum texto do mapa foi fornecido." });
      }

      if (!process.env.GEMINI_API_KEY) {
        console.warn("GEMINI_API_KEY environment variable is not defined");
        return res.status(500).json({ error: "Chave API do Gemini não configurada nos segredos." });
      }

      const prompt = `Você é um leitor especialista em relatórios e mapas georreferenciados gerados no QGIS para o Acre, Brasil.
Dada a lista de textos de um arquivo PDF de mapa do QGIS, identifique e extraia todos os pontos ou alvos de monitoramento ambiental com as respectivas coordenadas e áreas.

Analise cuidadosamente todo o texto extraído do mapa:
---
${text}
---

Extraia cada alvo de monitoramento/ponto de interesse individualmente.
Cada registro na tabela costuma ter:
- Um identificador numérico ou texto (ex: "255", "261", "259", "254", etc) que representa o ponto/lote/alvo.
- Área em hectares (ex: 12.2996 ou similar, se houver).
- Par de coordenadas, que podem estar formatadas como DMS (ex: "9°13'25.51\\"S", "68°52'46.71\\"W") ou decimais (ex: -9.3245, -68.9512).

Retorne estritamente um JSON estruturado seguindo o modelo abaixo. Adicione apenas os alvos identificados com coordenadas válidas.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              targets: {
                type: Type.ARRAY,
                description: "Lista de alvos de monitoramento ambiental identificados",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: "Código d_BPA da tabela ou número/ID do alvo" },
                    area_ha: { type: Type.NUMBER, description: "Área em hectares se existente na tabela, ou null se não houver" },
                    lat_centro_dms: { type: Type.STRING, description: "Latitude no formato DMS original ou Decimal original" },
                    long_centr_dms: { type: Type.STRING, description: "Longitude no formato DMS original ou Decimal original" }
                  },
                  required: ["id", "lat_centro_dms", "long_centr_dms"]
                }
              }
            },
            required: ["targets"]
          }
        }
      });

      const responseText = response.text || "{}";
      const parsedData = JSON.parse(responseText.trim());
      console.log(`Success: Extracted ${parsedData.targets?.length || 0} targets via Gemini Text parser`);
      return res.json(parsedData);
    } catch (error: any) {
      console.error("Error in server map-parser text endpoint:", error);
      return res.status(500).json({ error: error.message || "Interpretação de texto via IA falhou." });
    }
  });

  // Serve static assets / fallback to SPA
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] running on http://localhost:${PORT} with Node ${process.version}`);
  });
}

startServer();
