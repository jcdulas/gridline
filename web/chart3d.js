const chart3dTypes = new Set(["scatter3d", "columns3d", "surface3d"]);
const chartPaletteGroups = [
  ["Sequential", ["Viridis", "Cividis", "Turbo", "Plasma", "Inferno", "Magma", "Warm", "Cool", "CubehelixDefault",
    "Blues", "Greens", "Greys", "Oranges", "Purples", "Reds", "BuGn", "BuPu", "GnBu", "OrRd",
    "PuBu", "PuBuGn", "PuRd", "RdPu", "YlGn", "YlGnBu", "YlOrBr", "YlOrRd"]],
  ["Diverging", ["BrBG", "PRGn", "PiYG", "PuOr", "RdBu", "RdGy", "RdYlBu", "RdYlGn", "Spectral"]],
  ["Cyclic", ["Rainbow", "Sinebow"]]
];
const chartPaletteNames = new Set(chartPaletteGroups.flatMap(([, names]) => names));

function chart3dData(data, config, colorField = -1) {
  const { categories, series } = data;
  const fields = [categories.map(({ x }) => x), ...series.map(({ values }) => values)];
  const chosen = config.axes || [0, 1, 2];
  const points = [];
  for (let index = 0; index < categories.length; index++) {
    const values = chosen.map((field) => fields[field]?.[index]);
    if (!values.every(Number.isFinite)) continue;
    if (colorField >= 0) values.push(fields[colorField][index]);
    points.push(values);
  }
  if (!points.length) throw new Error("The three selected fields need numeric values on the same rows.");
  return points;
}

function surfaceMesh(points) {
  const unique = new Map();
  for (const [x, y, z, quantity] of points) {
    const key = `${x}:${z}`;
    if (!unique.has(key)) unique.set(key, { x, y: 0, z, count: 0, quantity: 0, quantityCount: 0 });
    const entry = unique.get(key);
    entry.y += (y - entry.y) / ++entry.count;
    if (Number.isFinite(quantity)) entry.quantity += (quantity - entry.quantity) / ++entry.quantityCount;
  }
  const vertices = Array.from(unique.values());
  const index = gridSurfaceTriangles(vertices) ?? scatteredSurfaceTriangles(vertices);
  if (!index.length) throw new Error("A surface needs at least three nearby, non-collinear X–Z points.");
  // In X–Z coordinates this winding gives the upper surface upward normals.
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [vertices[index[i]], vertices[index[i + 1]], vertices[index[i + 2]]];
    if (surfaceArea(a, b, c) > 0) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  }
  return { vertices, index };
}

function surfaceArea(a, b, c) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function gridSurfaceTriangles(vertices) {
  const axis = (name) => Array.from(new Set(vertices.map((point) => point[name]))).sort((a, b) => a - b);
  const x = axis("x"), z = axis("z");
  if (x.length < 2 || z.length < 2 || x.length === vertices.length || z.length === vertices.length ||
      x.length * z.length > vertices.length * 3) return null;
  const positions = new Map(vertices.map(({ x, z }, index) => [`${x}:${z}`, index]));
  const maxStep = (values) => {
    const steps = values.slice(1).map((value, i) => value - values[i]).sort((a, b) => a - b);
    return 2.5 * steps[Math.floor((steps.length - 1) / 2)];
  };
  const maxX = maxStep(x), maxZ = maxStep(z);
  const triangles = [];
  for (let row = 1; row < z.length; row++) {
    if (z[row] - z[row - 1] > maxZ) continue;
    for (let col = 1; col < x.length; col++) {
      if (x[col] - x[col - 1] > maxX) continue;
      const [a, b, c, d] = [[x[col - 1], z[row - 1]], [x[col], z[row - 1]], [x[col], z[row]],
        [x[col - 1], z[row]]].map(([x, z]) => positions.get(`${x}:${z}`));
      const present = [a, b, c, d].filter((index) => index !== undefined);
      if (present.length === 3) triangles.push(...present);
      if (present.length !== 4) continue;
      const heightGap = (first, second) => Math.abs(vertices[first].y - vertices[second].y);
      if (heightGap(a, c) <= heightGap(b, d)) triangles.push(a, b, c, a, c, d);
      else triangles.push(a, b, d, b, c, d);
    }
  }
  return triangles;
}

function scatteredSurfaceTriangles(vertices) {
  const { triangles, halfedges } = GridlineThree.Delaunator.from(vertices, ({ x }) => x, ({ z }) => z);
  if (vertices.length <= 3) return triangles;
  const nextEdge = (edge) => edge % 3 === 2 ? edge - 2 : edge + 1;
  const nearest = vertices.map(() => []);
  const lengths = new Float64Array(triangles.length);
  for (let edge = 0; edge < triangles.length; edge++) {
    const opposite = halfedges[edge];
    if (opposite >= 0 && opposite < edge) continue;
    const a = triangles[edge], b = triangles[nextEdge(edge)];
    const distance = Math.hypot(vertices[a].x - vertices[b].x, vertices[a].z - vertices[b].z);
    nearest[a].push(distance);
    nearest[b].push(distance);
    lengths[edge] = distance;
    if (opposite >= 0) lengths[opposite] = distance;
  }
  // Base the edge cutoff on each end's nearby samples so distant outliers
  // cannot set the scale for a densely sampled region.
  const spacing = nearest.map((edges) => {
    edges.sort((a, b) => a - b);
    return Math.min(edges[1] ?? edges[0], 2 * edges[0]);
  });
  const result = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
    if (lengths[i] > 2.8 * Math.min(spacing[a], spacing[b]) ||
        lengths[i + 1] > 2.8 * Math.min(spacing[b], spacing[c]) ||
        lengths[i + 2] > 2.8 * Math.min(spacing[c], spacing[a])) continue;
    const longest = Math.max(lengths[i], lengths[i + 1], lengths[i + 2]);
    if (Math.abs(surfaceArea(vertices[a], vertices[b], vertices[c])) < 0.025 * longest ** 2) continue;
    result.push(a, b, c);
  }
  return result;
}

function chart3dGeometry(data, config) {
  const colorField = config.colorBy ?? (config.type === "surface3d" ? (config.axes || [0, 1, 2])[1] : -1);
  const points = chart3dData(data, config, colorField);
  const domain = [0, 1, 2].map((axis) => {
    const values = points.map((point) => point[axis]);
    const low = Math.min(...values), high = Math.max(...values);
    return axis === 1 && config.type === "columns3d" ? chartTicks(Math.min(0, low), Math.max(0, high)) : chartTicks(low, high);
  });
  const positions = points.map(([x, y, z, quantity]) => [
    chartRatio(x, domain[0]) - 0.5, chartRatio(y, domain[1]) - 0.5, chartRatio(z, domain[2]) - 0.5, quantity
  ]);
  const surface = config.type === "surface3d" ? surfaceMesh(positions) : null;
  const values = surface ? Array.from(new Set(surface.index), (index) => surface.vertices[index])
    .filter(({ quantityCount }) => quantityCount).map(({ quantity }) => quantity)
    : points.map((point) => point[3]).filter(Number.isFinite);
  if (config.colorBy >= 0 && !values.length) throw new Error("The selected color field needs numeric values on the plotted rows.");
  const name = [data.xName, ...data.series.map(({ name }) => name)][colorField];
  const scale = values.length ? chartColorScale(values, config.colorPalette || "Viridis", name) : null;
  return { domain, points, positions, surface, scale };
}

function chartColorScale(values, palette, name) {
  const low = Math.min(...values), high = Math.max(...values);
  const centered = chartPaletteGroups[1][1].includes(palette) && low < 0 && high > 0;
  const interpolate = GridlineThree.ChartPalettes["interpolate" + palette];
  const color = (value) => {
    if (!Number.isFinite(value)) return "#a3b0bf";
    if (low === high) return interpolate(0.5);
    if (!centered) return interpolate(clamp(chartRatio(value, { low, high }), 0, 1));
    return value < 0 ? interpolate(0.5 * chartRatio(value, { low, high: 0 }))
      : interpolate(0.5 + 0.5 * chartRatio(value, { low: 0, high }));
  };
  return { name, low, high, midpoint: centered ? 0 : undefined, palette, interpolate, color };
}

function surfacePaletteTexture(geometry, vertices, scale, material) {
  const { Color, DataTexture, Float32BufferAttribute, LinearFilter, SRGBColorSpace } = GridlineThree;
  const samples = new Uint8Array(256 * 4);
  const color = new Color();
  for (let index = 0; index < 256; index++) {
    const rgb = color.set(scale.interpolate(index / 255)).getHex();
    samples.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255], index * 4);
  }
  const texture = new DataTexture(samples, 256, 1);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  const quantities = vertices.flatMap(({ quantity, quantityCount }) => {
    if (!quantityCount) return [0, 0];
    return [scale.low === scale.high ? 0.5 : chartRatio(quantity, scale), 1];
  });
  geometry.setAttribute("surfaceQuantity", new Float32BufferAttribute(quantities, 2));
  // Interpolate the scalar before applying the palette. Interpolating RGB
  // would put the wrong colors between samples on nonlinear ramps.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.surfaceRamp = { value: texture };
    shader.uniforms.surfaceZero = { value: scale.midpoint === undefined ? -1 : chartRatio(scale.midpoint, scale) };
    shader.uniforms.surfaceMissing = { value: new Color("#a3b0bf") };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
      attribute vec2 surfaceQuantity;
      varying vec2 vSurfaceQuantity;`).replace("#include <color_vertex>", `#include <color_vertex>
      vSurfaceQuantity = surfaceQuantity;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
      uniform sampler2D surfaceRamp;
      uniform float surfaceZero;
      uniform vec3 surfaceMissing;
      varying vec2 vSurfaceQuantity;`).replace("#include <color_fragment>", `#include <color_fragment>
      float quantity = clamp(vSurfaceQuantity.x / max(vSurfaceQuantity.y, 0.001), 0.0, 1.0);
      float rampPosition = quantity;
      if (surfaceZero > 0.0 && surfaceZero < 1.0) {
        rampPosition = quantity < surfaceZero ? 0.5 * quantity / surfaceZero
          : 0.5 + 0.5 * (quantity - surfaceZero) / (1.0 - surfaceZero);
      }
      vec3 rampColor = texture2D(surfaceRamp, vec2((0.5 + 255.0 * rampPosition) / 256.0, 0.5)).rgb;
      diffuseColor.rgb *= vSurfaceQuantity.y >= 0.999 ? rampColor : surfaceMissing;`);
  };
  return texture;
}

function surfaceContourSegments({ vertices, index }, levels) {
  const segments = [];
  const levelEdges = new Set();
  for (let i = 0; i < index.length; i += 3) {
    const corners = [index[i], index[i + 1], index[i + 2]];
    const triangle = corners.map((vertex) => vertices[vertex]);
    const heights = triangle.map(({ y }) => y);
    const min = Math.min(...heights), max = Math.max(...heights);
    if (min === max) continue;
    for (const level of levels) {
      if (level < min || level > max) continue;
      const edge = corners.filter((vertex) => vertices[vertex].y === level);
      if (edge.length === 2) {
        const key = `${Math.min(...edge)}:${Math.max(...edge)}`;
        if (levelEdges.has(key)) continue;
        levelEdges.add(key);
      }
      const points = [];
      for (let side = 0; side < 3; side++) {
        const a = triangle[side], b = triangle[(side + 1) % 3];
        if (a.y === level) points.push([a.x, level, a.z]);
        else if (level > Math.min(a.y, b.y) && level < Math.max(a.y, b.y)) {
          const t = (level - a.y) / (b.y - a.y);
          points.push([a.x + (b.x - a.x) * t, level, a.z + (b.z - a.z) * t]);
        }
      }
      if (points.length === 2) segments.push(...points[0], ...points[1]);
    }
  }
  return segments;
}

function surfaceQuantityAt(vertices, barycoord) {
  let weight = 0, value = 0;
  for (const [index, part] of barycoord.toArray().entries()) {
    if (!vertices[index].quantityCount) continue;
    weight += part;
    value += part * vertices[index].quantity;
  }
  return weight >= 0.999 ? value / weight : null;
}

function chart3dAxisTitles(data, config) {
  const names = [data.xName, ...data.series.map(({ name }) => name)];
  return [config.xTitle, config.yTitle, config.zTitle].map((title, axis) =>
    title || names[(config.axes || [0, 1, 2])[axis]]);
}

function chart3dLabel(text, title) {
  const { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } = GridlineThree;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const font = `${title ? "650" : "400"} 22px "Segoe UI", sans-serif`;
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + 8;
  canvas.height = 34;
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = title ? "#25445a" : "#51677c";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  // Test each label pixel against the same depth buffer as the data geometry.
  return new Sprite(new SpriteMaterial({ map, depthTest: true, depthWrite: false, toneMapped: false }));
}

class Chart3D {
  constructor(view, interactive = true, showLabels = true) {
    this.view = view;
    this.showLabels = showLabels;
    this.setCamera();
    this.canvas = view.canvas;
    if (!interactive) return;
    this.canvas.addEventListener("pointerdown", (event) => {
      if (!this.scene || !this.isActive() || (event.button !== 0 && event.button !== 1)) return;
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.focus();
      this.drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, pan: event.shiftKey || event.button === 1 };
      event.preventDefault();
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.drag?.pointer !== event.pointerId) return;
      const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
      if (this.drag.pan) this.pan(dx, dy);
      else this.orbit(-dx * 0.009, dy * 0.009);
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
    });
    this.canvas.addEventListener("lostpointercapture", () => { this.drag = null; });
    this.canvas.addEventListener("wheel", (event) => {
      if (!this.isActive()) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1);
      this.changeZoom(Math.exp(-delta * 0.0015));
    }, { passive: false });
    this.canvas.addEventListener("keydown", (event) => {
      if (!this.isActive()) return;
      const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (Object.hasOwn(moves, event.key)) {
        const [x, y] = moves[event.key];
        if (event.shiftKey) this.pan(x * 24, -y * 24);
        else this.orbit(x * 0.13, y * 0.13);
      } else if (event.key === "+" || event.key === "=") this.changeZoom(1.25);
      else if (event.key === "-") this.changeZoom(0.8);
      else if (event.key === "0" || event.key === "Home") this.reset();
      else return;
      event.preventDefault();
    });
  }

  isActive() { return chart3dTypes.has(this.view.config?.type); }

  orbit(yaw, pitch) {
    this.yaw += yaw;
    this.pitch = clamp(this.pitch + pitch, -1.35, 1.35);
    this.cameraMoved();
  }

  pan(x, y) {
    const pixels = Math.max(1, Math.min(this.canvas.clientWidth, this.canvas.clientHeight));
    const step = 1.84 / (pixels * this.zoom);
    this.panX = clamp(this.panX - x * step, -2, 2);
    this.panY = clamp(this.panY + y * step, -2, 2);
    this.cameraMoved();
  }

  changeZoom(factor) {
    this.zoom = clamp(this.zoom * factor, 0.6, 4);
    this.cameraMoved();
  }

  reset() {
    this.setCamera();
    this.cameraMoved();
  }

  getCamera() {
    const { yaw, pitch, zoom, panX, panY } = this;
    return { yaw, pitch, zoom, panX, panY };
  }

  setCamera({ yaw = 0.72, pitch = 0.51, zoom = 1, panX = 0, panY = 0 } = {}) {
    Object.assign(this, { yaw, pitch, zoom, panX, panY });
  }

  cameraMoved() {
    this.view.cameraChanged?.(this.getCamera());
    this.view.schedule();
  }

  dispose() {
    this.clearAxisLabels();
    for (const object of this.scene?.children || []) {
      object.geometry?.dispose();
      object.material?.dispose();
      object.dispose?.();
    }
    this.surfaceTexture?.dispose();
    this.surfaceTexture = null;
    this.dataMesh = null;
    this.scene = null;
    this.data = null;
  }

  geometrySignature(config) {
    return JSON.stringify([config.type, config.axes, config.colorBy, config.colorPalette, config.contours]);
  }

  rebuild(data, config) {
    const { Scene, OrthographicCamera, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial,
      MeshPhongMaterial, HemisphereLight, DirectionalLight, DoubleSide, LineSegments, LineBasicMaterial,
      BoxGeometry, SphereGeometry, InstancedMesh, Matrix4, Color, Group } = GridlineThree;
    const { domain, points, positions, surface, scale } = chart3dGeometry(data, config);
    const normalize = (value, axis) => chartRatio(value, domain[axis]) - 0.5;
    this.dispose();
    this.scene = new Scene();
    this.labelGroup = new Group();
    this.scene.add(this.labelGroup);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    this.domain = domain;
    this.colorScale = scale;
    this.points = points;
    this.surface = surface;
    this.contourLevels = [];
    this.data = data;
    this.signature = this.geometrySignature(config);
    const geo = (positions) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
      return geometry;
    };
    const keyLight = new DirectionalLight("#fff6e8", 1.9);
    keyLight.position.set(2, 4, 3);
    const fillLight = new DirectionalLight("#cfe2ff", 0.65);
    fillLight.position.set(-3, 2, -2);
    this.scene.add(new HemisphereLight("#f4f8ff", "#9aaac2", 1.15), keyLight, fillLight);

    const floor = geo([-0.5, -0.502, -0.5, -0.5, -0.502, 0.5, 0.5, -0.502, 0.5,
      -0.5, -0.502, -0.5, 0.5, -0.502, 0.5, 0.5, -0.502, -0.5]);
    this.scene.add(new Mesh(floor, new MeshBasicMaterial({ color: "#edf2f8" })));
    const grid = [];
    for (const x of domain[0].values.map((value) => normalize(value, 0))) grid.push(x, -0.5, -0.5, x, -0.5, 0.5);
    for (const z of domain[2].values.map((value) => normalize(value, 2))) grid.push(-0.5, -0.5, z, 0.5, -0.5, z);
    for (const y of domain[1].values.map((value) => normalize(value, 1))) {
      grid.push(-0.5, y, 0.5, -0.5, y, -0.5, -0.5, y, -0.5, 0.5, y, -0.5);
    }
    const axes = [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,
      -0.5, -0.5, -0.5, -0.5, -0.5, 0.5];
    this.scene.add(new LineSegments(geo(grid), new LineBasicMaterial({ color: "#c9d6e5" })),
      new LineSegments(geo(axes), new LineBasicMaterial({ color: "#657991" })));

    const material = (settings) => new MeshPhongMaterial({ shininess: 22, specular: "#364452", ...settings });
    if (config.type === "scatter3d") {
      const radius = clamp(0.12 / Math.sqrt(positions.length), 0.006, 0.024);
      const markers = new InstancedMesh(new SphereGeometry(radius, 8, 6),
        material({ color: scale ? "#ffffff" : "#287aab" }), positions.length);
      const matrix = new Matrix4();
      const color = new Color();
      for (const [index, [x, y, z, quantity]] of positions.entries()) {
        markers.setMatrixAt(index, matrix.makeTranslation(x, y, z));
        if (scale) markers.setColorAt(index, color.set(scale.color(quantity)));
      }
      this.dataMesh = markers;
    } else if (config.type === "columns3d") {
      const bars = new InstancedMesh(new BoxGeometry(1, 1, 1), material(), positions.length);
      const base = normalize(0, 1);
      const size = clamp(0.65 / Math.sqrt(positions.length), 0.006, 0.12);
      const matrix = new Matrix4();
      const color = new Color();
      for (const [index, [x, y, z, quantity]] of positions.entries()) {
        matrix.makeScale(size, Math.max(0.001, Math.abs(y - base)), size);
        matrix.setPosition(x, (base + y) / 2, z);
        bars.setMatrixAt(index, matrix);
        bars.setColorAt(index, color.set(scale ? scale.color(quantity) : y >= base ? "#287aab" : "#c35d40"));
      }
      this.dataMesh = bars;
    } else {
      const { vertices, index } = surface;
      const geometry = geo(vertices.flatMap(({ x, y, z }) => [x, y, z]));
      geometry.setIndex(Array.from(index));
      geometry.computeVertexNormals();
      const phong = material({ color: scale ? "#ffffff" : "#287aab", side: DoubleSide });
      if (scale) this.surfaceTexture = surfacePaletteTexture(geometry, vertices, scale, phong);
      this.dataMesh = new Mesh(geometry, phong);
      if (config.contours) {
        const heights = Array.from(new Set(index), (vertex) => vertices[vertex].y);
        const low = Math.min(...heights), high = Math.max(...heights);
        const levels = config.contours === "auto" ? domain[1].values : config.contours;
        this.contourLevels = levels.filter((value) => normalize(value, 1) > low && normalize(value, 1) < high);
        const segments = surfaceContourSegments(surface, this.contourLevels.map((value) => normalize(value, 1)));
        const lines = new LineSegments(geo(segments), new LineBasicMaterial({ color: "#223346", opacity: 0.75, transparent: true }));
        lines.position.y = 0.001;
        this.scene.add(lines);
      }
    }
    this.scene.add(this.dataMesh);
  }

  clearAxisLabels() {
    for (const label of this.labelGroup?.children || []) {
      label.material.map.dispose();
      label.material.dispose();
    }
    this.labelGroup?.clear();
    this.labelTitles = null;
  }

  updateAxisLabels(data, config, unit) {
    if (!this.showLabels) return;
    const titles = chart3dAxisTitles(data, config);
    const key = JSON.stringify(titles);
    if (key !== this.labelTitles) {
      this.clearAxisLabels();
      this.labelTitles = key;
      for (const [axis, scale] of this.domain.entries()) {
        const add = (fraction, text, title) => {
          const xyz = [-0.5, -0.5, -0.5];
          xyz[axis] = fraction - 0.5;
          if (axis === 0) xyz[2] -= 0.07;
          if (axis === 1) xyz[0] -= 0.09;
          if (axis === 2) xyz[0] -= 0.07;
          const sprite = chart3dLabel(text, title);
          sprite.position.set(...xyz);
          this.labelGroup.add(sprite);
        };
        for (const value of scale.values) add(chartRatio(value, scale), chartNumber(value), false);
        add(1.17, `${["X", "Y", "Z"][axis]} · ${titles[axis]}`, true);
      }
    }
    for (const label of this.labelGroup.children) {
      const { width, height } = label.material.map.image;
      label.scale.set(width * unit / 2, height * unit / 2, 1);
    }
  }

  hitTest(x, y, width, height, config) {
    if (!this.dataMesh || !width || !height) return null;
    const { Raycaster, Vector2 } = GridlineThree;
    this.raycaster ??= new Raycaster();
    this.raycaster.setFromCamera(new Vector2(2 * x / width - 1, 1 - 2 * y / height), this.camera);
    const hit = this.raycaster.intersectObject(this.dataMesh, false)[0];
    if (!hit) return null;
    let values, quantity;
    if (this.surface) {
      values = hit.point.toArray().map((position, axis) => {
        const { low, high } = this.domain[axis];
        const t = position + 0.5;
        return low * (1 - t) + high * t;
      });
      const { a, b, c } = hit.face;
      quantity = surfaceQuantityAt([a, b, c].map((index) => this.surface.vertices[index]), hit.barycoord);
    } else {
      values = this.points[hit.instanceId];
      quantity = values[3];
    }
    const lines = chart3dAxisTitles(this.data, config).map((title, axis) => {
      const coordinate = ["X", "Y", "Z"][axis];
      const label = title === coordinate ? coordinate : `${coordinate} · ${title}`;
      return `${label}: ${chartNumber(values[axis])}`;
    });
    if (this.colorScale) lines.push(`Color · ${this.colorScale.name}: ${Number.isFinite(quantity) ? chartNumber(quantity) : "No value"}`);
    return lines.join("\n");
  }

  render(data, config, width, height) {
    const renderer = this.view.ensureRenderer();
    if (!renderer) throw new Error("3D charts need WebGL 2. Enable hardware acceleration or choose a 2D chart.");
    const signature = this.geometrySignature(config);
    if (data !== this.data || signature !== this.signature) this.rebuild(data, config);
    const aspect = width / height;
    const half = 0.92 / this.zoom;
    const halfWidth = half * Math.max(1, aspect);
    const halfHeight = half * Math.max(1, 1 / aspect);
    Object.assign(this.camera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight });
    this.camera.position.set(3 * Math.sin(this.yaw) * Math.cos(this.pitch), 3 * Math.sin(this.pitch),
      3 * Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.lookAt(0, 0, 0);
    this.camera.translateX(this.panX);
    this.camera.translateY(this.panY);
    this.camera.updateProjectionMatrix();
    const ratio = this.view.pixelRatio ?? Math.min(2, window.devicePixelRatio || 1);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    if (this.canvas.width !== Math.floor(width * ratio) || this.canvas.height !== Math.floor(height * ratio)) {
      renderer.setSize(width, height, false);
    }
    this.updateAxisLabels(data, config, 2 * halfHeight / height);
    renderer.render(this.scene, this.camera);
    this.view.renderLabels({ labels: [], lines: [] }, width, height);
  }
}
