# SLA Support Generator

Web-App zum automatischen Erzeugen von Supports für SLA-/Resin-3D-Drucke. Läuft komplett im Browser, es wird nichts hochgeladen.

## Stand: Etappe 1 – Import & 3D-Ansicht

- **Import** per Datei-Dialog oder Drag & Drop, mehrere Dateien gleichzeitig:
  STL, OBJ, 3MF, PLY, glTF/GLB, AMF, FBX sowie die CAD-Formate STEP, IGES und BREP
  (über OpenCascade als WebAssembly, wird erst beim ersten CAD-Import geladen).
- Alle Modelle werden in das Koordinatensystem des Druckers umgerechnet (Z oben, Millimeter).
  Y-up-Formate (OBJ, glTF, FBX) werden gedreht, Einheiten aus glTF, FBX, 3MF und AMF übernommen.
- **3D-Ansicht** mit Bauplatte und Bauvolumen (frei einstellbar), Ansichten Iso/Vorne/Seite/Oben/Unten.
- **Bearbeiten**: Verschieben, Drehen, Skalieren per Gizmo oder Zahleneingabe, Einheit korrigieren
  (cm/Zoll/m → mm), auf die Platte einpassen, auf Platte legen, zentrieren, duplizieren, anordnen.
- Modelle außerhalb des Bauvolumens werden rot markiert. Harzverbrauch (ml) und Dreiecksanzahl werden angezeigt.
- **Export** der ganzen Platte als binäres STL oder 3MF.

Tastenkürzel: `T` Verschieben, `R` Drehen, `S` Skalieren, `F` Zoom auf Auswahl, `Entf` Löschen,
`Esc` Auswahl aufheben, `Strg+O` Öffnen, `Strg+D` Duplizieren.

## Geplant

2. Gerade Supports: Überhang- und Inselerkennung, Stützen mit Kegelspitze, Raft, einstellbare Parameter
3. Supports manuell setzen/löschen
4. Auto-Ausrichtung
5. Baum-Supports
6. Aushöhlen + Ablauflöcher

## Entwickeln

```bash
npm install
npm run dev      # Entwicklungsserver auf http://localhost:5173
npm test         # Unit-Tests (Vitest)
npm run build    # Produktions-Build nach dist/
```

Jeder Push auf `main` baut die App und veröffentlicht sie über GitHub Pages
(Einstellungen → Pages → Source: „GitHub Actions“).

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/main.js` | Oberfläche und Bedienlogik |
| `src/viewer/viewer.js` | Three.js-Szene, Kamera, Bauplatte, Auswahl und Gizmo |
| `src/io/importers.js` | Einlesen aller Formate, Achsen- und Einheitenumrechnung |
| `src/io/occt.js` | STEP/IGES/BREP über OpenCascade (Web Worker) |
| `src/io/exporters.js` | STL- und 3MF-Export |
| `src/core/geometry.js` | Geometrie-Hilfen (Zusammenführen, Volumen, Bounding Box) |
| `src/core/model.js` | Modelle auf der Platte (Ablegen, Zentrieren, Anordnen) |
| `scripts/copy-occt.mjs` | kopiert OpenCascade-WASM (occt-import-js, LGPL-2.1) nach `public/vendor/occt/` |
