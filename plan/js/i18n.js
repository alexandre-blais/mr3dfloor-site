// Minimal bilingual (fr-CA / en) strings. t('key') returns the string for the current language;
// unknown keys fall back to English, then to the key itself.

import { store } from './store.js';

const STR = {
  en: {
    appName: 'MR 3D Floor Studio', summary: 'Summary', plan: 'Plan', model: 'Model', photo: 'Photo',
    undo: 'Undo', redo: 'Redo', fit: 'Fit', zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    select: 'Select', wall: 'Wall', virtualWall: 'Divider', door: 'Door', double: 'Double door', sliding: 'Sliding door', pocket: 'Pocket door',
    window: 'Window', opening: 'Opening', object: 'Object', room: 'Room', note: 'Note', measure: 'Measure', photoPin: 'Photo',
    library: 'Objects', search: 'Search…', properties: 'Properties', nothingSelected: 'Tap an element to edit it. Pinch or scroll to zoom, drag to pan.',
    width: 'Width', depth: 'Depth', height: 'Height', length: 'Length', thickness: 'Thickness', sill: 'Sill height', offset: 'From corner',
    rotation: 'Rotation', elevation: 'Elevation', name: 'Name', type: 'Type', swing: 'Swing', hinge: 'Hinge', flip: 'Flip', delete: 'Delete', duplicate: 'Duplicate',
    area: 'Area', perimeter: 'Perimeter', baseboard: 'Baseboard', doorTrim: 'Door trim', windowTrim: 'Window trim', openingTrim: 'Opening trim',
    wallArea: 'Wall area (paint)', volume: 'Volume', rooms: 'Rooms', openings: 'Doors & windows', objects: 'Objects', walls: 'Walls',
    units: 'Units', metric: 'Metric', imperial: 'Imperial', insideDims: 'Inside dims', centerDims: 'Centreline dims', language: 'Language',
    showDims: 'Dimensions', showChains: 'Opening positions', showFurniture: 'Furniture', showGrid: 'Grid', showPhotos: 'Photo pins', snap: 'Snap',
    export: 'Export', import: 'Import', newPlan: 'New plan', sample: 'Load sample', exportJSON: 'Plan file (.json)', exportSVG: 'Plan drawing (.svg)',
    exportPNG: 'Plan image (.png)', exportCSV: 'Schedule (.csv)', print: 'Print', settings: 'View',
    wallHeight: 'Wall height', kind: 'Kind', solid: 'Wall', virtual: 'Divider (no wall)', split: 'Split', addPhoto: 'Add photos',
    photos: 'Photos', noPhotos: 'No photos yet. Add photos and pin them on the plan.', direction: 'Direction', addNote: 'Add note', text: 'Text',
    tipWall: 'Tap to start a wall, tap again to continue. Double-tap or Esc to finish.', tipOpening: 'Tap a wall to place it.',
    tipObject: 'Tap on the plan to place the object.', tipMeasure: 'Tap two points to measure.', tipRoom: 'Tap inside a closed area to name the room.',
    tipNote: 'Tap to place a note.', tipPhoto: 'Tap to place the camera, then drag to aim.',
    total: 'Total', floor: 'Floor', count: 'Count', wallOf: 'Wall', position: 'Position', size: 'Size', schedule: 'Schedule',
    estimateNote: 'Estimates from a LiDAR survey. Verify critical measurements before cutting or ordering.',
    confirmNew: 'Start a new empty plan? (Undo is available.)', rename: 'Rename', untitledRoom: 'Room',
    view3dTop: 'Top', view3dPersp: '3D', view3dWalk: 'Walk', resetView: 'Reset view', wallsCut: 'Cut walls',
    open: 'Open', close: 'Close', prev: 'Previous', next: 'Next', annotate: 'Annotate', showOnPlan: 'Show on plan', info: 'Info',
    fullscreen: 'Fullscreen', rotateL: 'Rotate', compare: 'Compare', zoom: 'Zoom',
  },
  fr: {
    appName: 'MR 3D Floor Studio', summary: 'Résumé', plan: 'Plan', model: 'Modèle', photo: 'Photo',
    undo: 'Annuler', redo: 'Rétablir', fit: 'Ajuster', zoomIn: 'Zoom avant', zoomOut: 'Zoom arrière',
    select: 'Sélection', wall: 'Mur', virtualWall: 'Séparation', door: 'Porte', double: 'Porte double', sliding: 'Porte coulissante', pocket: 'Porte escamotable',
    window: 'Fenêtre', opening: 'Ouverture', object: 'Objet', room: 'Pièce', note: 'Note', measure: 'Mesurer', photoPin: 'Photo',
    library: 'Objets', search: 'Rechercher…', properties: 'Propriétés', nothingSelected: 'Touchez un élément pour le modifier. Pincez ou défilez pour zoomer, glissez pour déplacer.',
    width: 'Largeur', depth: 'Profondeur', height: 'Hauteur', length: 'Longueur', thickness: 'Épaisseur', sill: 'Hauteur d’allège', offset: 'Depuis le coin',
    rotation: 'Rotation', elevation: 'Élévation', name: 'Nom', type: 'Type', swing: 'Ouverture', hinge: 'Pentures', flip: 'Inverser', delete: 'Supprimer', duplicate: 'Dupliquer',
    area: 'Superficie', perimeter: 'Périmètre', baseboard: 'Plinthes', doorTrim: 'Moulures de portes', windowTrim: 'Moulures de fenêtres', openingTrim: 'Moulures d’ouvertures',
    wallArea: 'Surface murale (peinture)', volume: 'Volume', rooms: 'Pièces', openings: 'Portes et fenêtres', objects: 'Objets', walls: 'Murs',
    units: 'Unités', metric: 'Métrique', imperial: 'Impérial', insideDims: 'Cotes intérieures', centerDims: 'Cotes d’axe', language: 'Langue',
    showDims: 'Cotes', showChains: 'Position des ouvertures', showFurniture: 'Mobilier', showGrid: 'Grille', showPhotos: 'Photos', snap: 'Aimanter',
    export: 'Exporter', import: 'Importer', newPlan: 'Nouveau plan', sample: 'Charger l’exemple', exportJSON: 'Fichier plan (.json)', exportSVG: 'Dessin (.svg)',
    exportPNG: 'Image (.png)', exportCSV: 'Bordereau (.csv)', print: 'Imprimer', settings: 'Affichage',
    wallHeight: 'Hauteur des murs', kind: 'Genre', solid: 'Mur', virtual: 'Séparation (sans mur)', split: 'Scinder', addPhoto: 'Ajouter des photos',
    photos: 'Photos', noPhotos: 'Aucune photo. Ajoutez des photos et épinglez-les sur le plan.', direction: 'Direction', addNote: 'Ajouter une note', text: 'Texte',
    tipWall: 'Touchez pour commencer un mur, puis pour continuer. Double-touchez ou Échap pour terminer.', tipOpening: 'Touchez un mur pour la placer.',
    tipObject: 'Touchez le plan pour placer l’objet.', tipMeasure: 'Touchez deux points pour mesurer.', tipRoom: 'Touchez l’intérieur d’une zone fermée pour nommer la pièce.',
    tipNote: 'Touchez pour placer une note.', tipPhoto: 'Touchez pour placer la caméra, puis glissez pour l’orienter.',
    total: 'Total', floor: 'Étage', count: 'Nombre', wallOf: 'Mur', position: 'Position', size: 'Dimensions', schedule: 'Bordereau',
    estimateNote: 'Estimations issues d’un relevé LiDAR. Vérifiez toute mesure critique avant de couper ou de commander.',
    confirmNew: 'Commencer un nouveau plan vide ? (Annuler reste possible.)', rename: 'Renommer', untitledRoom: 'Pièce',
    view3dTop: 'Dessus', view3dPersp: '3D', view3dWalk: 'Visite', resetView: 'Réinitialiser', wallsCut: 'Murs coupés',
    open: 'Ouvrir', close: 'Fermer', prev: 'Précédente', next: 'Suivante', annotate: 'Annoter', showOnPlan: 'Voir sur le plan', info: 'Infos',
    fullscreen: 'Plein écran', rotateL: 'Pivoter', compare: 'Comparer', zoom: 'Zoom',
  },
};

export function t(key) {
  const lang = store.settings.lang === 'fr' ? 'fr' : 'en';
  return STR[lang][key] ?? STR.en[key] ?? key;
}
export const lang = () => (store.settings.lang === 'fr' ? 'fr' : 'en');
