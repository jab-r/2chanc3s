# H3 Cell + Accuracy Circle Map Display Plan

## Overview

Add per-post expandable maps to the web client that visualize the post's H3 cell (hexagon) and accuracy circle using Leaflet.

## Current State

### Data Available
- [`PublicPost.geolocatorH3`](../api/src/types.ts:35): H3 resolution 7 cell (~5 km², ~3km edge length)
- [`PublicPost.accuracyM`](../api/src/types.ts:36): GPS accuracy in meters (optional)

### Existing Dependencies
- [`h3-js@4.1.0`](../web/public/index.html:74): Already loaded via importmap
- Currently imports: `latLngToCell`, `gridDisk`

---

## Implementation Plan

### 1. Add Leaflet to index.html

```html
<!-- Leaflet CSS - add in <head> -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" 
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" 
      crossorigin="" />

<!-- Leaflet JS - add before app.js -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" 
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" 
        crossorigin=""></script>
```

### 2. Update h3-js imports in app.js

```javascript
import { latLngToCell, gridDisk, cellToBoundary, cellToLatLng } from 'h3-js';
```

### 3. Add CSS for Map Container

```css
/* In style.css */
.post-map-container {
  margin: 0.75rem 0;
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.3s ease-out;
}

.post-map-container.expanded {
  max-height: 300px;
}

.post-map {
  height: 250px;
  width: 100%;
  border-radius: 8px;
  background: #e0e0e0;
}

.btn-map {
  font-size: 0.85rem;
  padding: 0.3rem 0.6rem;
}
```

### 4. Create Map Rendering Function

```javascript
/**
 * Initialize and render a map showing H3 cell and accuracy circle
 * @param {HTMLElement} container - The map container element
 * @param {string} h3Cell - H3 cell index (resolution 7)
 * @param {number|undefined} accuracyM - Accuracy in meters
 */
function initPostMap(container, h3Cell, accuracyM) {
  // Get cell center for map centering
  const [lat, lng] = cellToLatLng(h3Cell);
  
  // Get hexagon boundary vertices
  // cellToBoundary returns [[lat, lng], ...] - array of vertex coordinates
  const boundary = cellToBoundary(h3Cell);
  // Leaflet expects [lat, lng] which h3-js already provides
  
  // Create map centered on cell
  const map = L.map(container).setView([lat, lng], 13);
  
  // Add OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  
  // Draw H3 hexagon
  const hexagonStyle = {
    color: '#007aff',
    weight: 2,
    fillColor: '#007aff',
    fillOpacity: 0.15
  };
  const hexagon = L.polygon(boundary, hexagonStyle).addTo(map);
  
  // Draw accuracy circle if available
  if (accuracyM && accuracyM > 0) {
    const circleStyle = {
      color: '#ff6b6b',
      weight: 2,
      fillColor: '#ff6b6b',
      fillOpacity: 0.1,
      dashArray: '5, 5'
    };
    L.circle([lat, lng], {
      radius: accuracyM,
      ...circleStyle
    }).addTo(map);
  }
  
  // Fit bounds to show both hexagon and circle
  const bounds = hexagon.getBounds();
  if (accuracyM && accuracyM > 0) {
    // Extend bounds to include accuracy circle
    bounds.extend(L.latLng(lat, lng).toBounds(accuracyM * 2));
  }
  map.fitBounds(bounds, { padding: [20, 20] });
  
  return map;
}
```

### 5. Update renderPosts Function

In [`renderPosts()`](../web/public/app.js:235), add the map button and container:

```javascript
// Inside the for loop, after building the post element
const hasLocation = p.geolocatorH3;

el.innerHTML = `
  <div class="meta">
    <div>@${escapeText(username)}</div>
    <div>${escapeText(fmtTime(p.time))}</div>
    <div class="mono">id: ${escapeText(messageId)}</div>
  </div>
  ${renderMedia(p.media)}
  <div class="content" data-full="${escapeText(full)}" data-snippet="${escapeText(snippet)}">${escapeText(snippet)}</div>
  <div class="actions">
    <a class="btn" href="${isIOS ? replyUrlIOS(username, messageId) : replyUrl(username, messageId)}">Reply (in app)</a>
    ${hasMore && !hasMedia ? '<button class="btn toggle">Show full</button>' : ''}
    ${hasLocation ? `<button class="btn btn-map" data-h3="${escapeText(p.geolocatorH3)}" data-accuracy="${p.accuracyM || ''}">Show on map</button>` : ''}
  </div>
  ${hasLocation ? '<div class="post-map-container"><div class="post-map"></div></div>' : ''}
`;

// Add map toggle handler
const mapBtn = el.querySelector('.btn-map');
if (mapBtn) {
  mapBtn.addEventListener('click', () => {
    const container = el.querySelector('.post-map-container');
    const mapDiv = el.querySelector('.post-map');
    const isExpanded = container.classList.contains('expanded');
    
    if (isExpanded) {
      container.classList.remove('expanded');
      mapBtn.textContent = 'Show on map';
    } else {
      container.classList.add('expanded');
      mapBtn.textContent = 'Hide map';
      
      // Lazy init map on first expand
      if (!mapDiv.dataset.initialized) {
        const h3Cell = mapBtn.dataset.h3;
        const accuracy = mapBtn.dataset.accuracy ? parseFloat(mapBtn.dataset.accuracy) : undefined;
        
        // Small delay to let CSS transition start
        setTimeout(() => {
          initPostMap(mapDiv, h3Cell, accuracy);
          mapDiv.dataset.initialized = 'true';
        }, 50);
      }
    }
  });
}
```

---

## Visual Design

```
┌─────────────────────────────────────────┐
│ @username                               │
│ Jan 15, 2026, 10:30 AM                  │
│ id: abc123                              │
├─────────────────────────────────────────┤
│ [Post content here...]                  │
├─────────────────────────────────────────┤
│ [Reply] [Show on map]                   │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ │    ⬡ H3 Hexagon (blue, 15% fill)   │ │
│ │      ○ Accuracy circle (red dash)  │ │
│ │                                     │ │
│ │           OSM Map Tiles            │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Legend on Map

Consider adding a simple legend:
- Blue hexagon: "Location area (~5km²)"
- Red dashed circle: "GPS accuracy (±Xm)"

---

## H3 Resolution 7 Properties

| Property | Value |
|----------|-------|
| Average area | ~5.16 km² |
| Average edge length | ~1.22 km |
| Average diameter | ~2.6 km |

At resolution 7, the hexagon is large enough to preserve privacy while still providing useful context about where the post was made.

---

## Edge Cases

### No Location Data
- Posts without `geolocatorH3` will not show the "Show on map" button
- No changes needed to existing post display

### Missing Accuracy
- If `accuracyM` is undefined or 0, only show the hexagon (no circle)
- This is valid - some posts may not have accuracy data

### Very Large Accuracy Values
- If `accuracyM` is very large (e.g., IP-based location with 10km+ accuracy), the circle will dwarf the hexagon
- Consider capping displayed accuracy at h3r7 edge length (~3km) with a note

### Map Resize Issues
- Leaflet requires the container to have dimensions when initialized
- Using lazy init with setTimeout ensures CSS transition has started
- Call `map.invalidateSize()` if map appears with tiles not loaded

---

## Files to Modify

| File | Changes |
|------|---------|
| [`web/public/index.html`](../web/public/index.html) | Add Leaflet CSS and JS |
| [`web/public/style.css`](../web/public/style.css) | Add map container styles |
| [`web/public/app.js`](../web/public/app.js) | Add h3 imports, initPostMap function, update renderPosts |

---

## Testing

1. **Posts with location + accuracy**: Should show hexagon and circle
2. **Posts with location only**: Should show hexagon only
3. **Posts without location**: Should not show map button
4. **Map toggle**: Should smoothly expand/collapse
5. **Multiple maps**: Each post should have independent map state
6. **Zoom levels**: Verify hexagon and circle are both visible at initial zoom

---

## Future Enhancements

1. **Cluster view**: Single map showing all visible posts' hexagons
2. **Your location**: Overlay viewer's current location on the map
3. **Distance indicator**: Show distance from viewer to post location
4. **Different tile providers**: Allow light/dark theme map tiles
