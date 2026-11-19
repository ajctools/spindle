const radians = Math.PI / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function direction(lon, lat) {
  const phi = lon * radians;
  const theta = lat * radians;
  return [Math.cos(theta) * Math.sin(phi), Math.sin(theta), Math.cos(theta) * Math.cos(phi)];
}

function orientation(lon, lat) {
  const phi = lon * radians;
  return [[Math.cos(phi), 0, -Math.sin(phi)], direction(lon + 180, 90 - lat), direction(lon, lat)];
}

async function loadTexture() {
  const image = new Image();
  image.src = new URL('./earth.jpg', import.meta.url);
  await image.decode();
  const texture = document.createElement('canvas');
  texture.width = 2048;
  texture.height = 1024;
  const context = texture.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, texture.width, texture.height);
  return context.getImageData(0, 0, texture.width, texture.height);
}

export function createGlobe(canvas, onProject, onError) {
  const context = canvas.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let texture;
  let lon = -36;
  let lat = 20;
  let zoom = 1;
  let frame;
  let flight;
  let geometry;
  let drag;

  function measure() {
    const { width, height } = canvas.getBoundingClientRect();
    return { width, height, x: width * .5, y: height * .5, radius: Math.min(width * .43, height * .445) * zoom };
  }

  function draw() {
    frame = null;
    const shape = measure();
    if (!shape.radius) return;
    const [side, up, front] = orientation(lon, lat);
    onProject((lng, latitude) => {
      const location = direction(lng, latitude);
      return {
        x: shape.x + shape.radius * dot(location, side),
        y: shape.y - shape.radius * dot(location, up),
        visible: dot(location, front) > .13,
      };
    });

    if (!texture) return;
    const scale = Math.min(devicePixelRatio || 1, 1.35, 780 / Math.max(shape.width, shape.height));
    const width = Math.round(shape.width * scale);
    const height = Math.round(shape.height * scale);
    const radius = shape.radius * scale;
    if (!geometry || geometry.width !== width || geometry.height !== height || geometry.radius !== radius) {
      canvas.width = width;
      canvas.height = height;
      const image = context.createImageData(width, height);
      const points = [];
      const left = Math.max(0, Math.floor(width / 2 - radius - 1));
      const top = Math.max(0, Math.floor(height / 2 - radius - 1));
      const right = Math.min(width, Math.ceil(width / 2 + radius + 1));
      const bottom = Math.min(height, Math.ceil(height / 2 + radius + 1));
      for (let row = top; row < bottom; row++) {
        const y = (height / 2 - row - .5) / radius;
        for (let col = left; col < right; col++) {
          const x = (col + .5 - width / 2) / radius;
          const rr = x * x + y * y;
          if (rr >= 1) continue;
          const z = Math.sqrt(1 - rr);
          const shade = .43 + .7 * Math.max(0, -.39 * x + .65 * y + .68 * z);
          const edge = Math.pow(1 - z, 3);
          const opacity = Math.min(255, (1 - rr) * radius * 160);
          points.push((row * width + col) * 4, x, y, z, shade, edge, opacity);
        }
      }
      geometry = { width, height, radius, points: Float32Array.from(points), image };
    }

    const { points, image } = geometry;
    const source = texture.data;
    const output = image.data;
    const texWidth = texture.width;
    const texHeight = texture.height;
    for (let i = 0; i < points.length; i += 7) {
      const [x, y, z] = [points[i + 1], points[i + 2], points[i + 3]];
      const wx = x * side[0] + y * up[0] + z * front[0];
      const wy = y * up[1] + z * front[1];
      const wz = x * side[2] + y * up[2] + z * front[2];
      const u = (Math.atan2(wx, wz) / (2 * Math.PI) + .5) * texWidth;
      const v = (.5 - Math.asin(clamp(wy, -1, 1)) / Math.PI) * texHeight;
      const texel = ((Math.min(texHeight - 1, v | 0) * texWidth) + ((u | 0) % texWidth)) * 4;
      const red = source[texel];
      const green = source[texel + 1];
      const blue = source[texel + 2];
      const brightness = (red * .30 + green * .60 + blue * .10) / 255;
      const land = clamp((green - blue + 20) / 57, 0, 1);
      const relief = Math.pow(brightness, .64) * land;
      const gridX = Math.abs(u / texWidth * 24 - Math.round(u / texWidth * 24)) * Math.sqrt(1 - wy * wy);
      const gridY = Math.abs(v / texHeight * 12 - Math.round(v / texHeight * 12));
      const grid = 1 - clamp(Math.min(gridX, gridY) * radius * .15, 0, 1);
      const shade = points[i + 4];
      const rim = points[i + 5];
      const index = points[i];
      output[index] = (11 + brightness * 22 + relief * 48 + grid * 10) * shade + rim * 51;
      output[index + 1] = (32 + brightness * 46 + relief * 130 + grid * 21) * shade + rim * 113;
      output[index + 2] = (58 + brightness * 75 + relief * 124 + grid * 29) * shade + rim * 146;
      output[index + 3] = points[i + 6];
    }
    context.putImageData(image, 0, 0);
  }

  function queue() {
    frame ??= requestAnimationFrame(draw);
  }

  function aim(nextLon, nextLat, nextZoom = zoom) {
    cancelAnimationFrame(flight);
    const fromLon = lon;
    const fromLat = lat;
    const fromZoom = zoom;
    const delta = (((nextLon - fromLon + 180) % 360) + 360) % 360 - 180;
    const start = performance.now();
    function animate(now) {
      const phase = reduceMotion.matches ? 1 : Math.min((now - start) / 540, 1);
      const ease = 1 - (1 - phase) ** 3;
      lon = fromLon + delta * ease;
      lat = fromLat + (clamp(nextLat, -70, 70) - fromLat) * ease;
      zoom = fromZoom + (nextZoom - fromZoom) * ease;
      queue();
      if (phase < 1) flight = requestAnimationFrame(animate);
    }
    flight = requestAnimationFrame(animate);
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    cancelAnimationFrame(flight);
    drag = { x: event.clientX, y: event.clientY, lon, lat };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    const sensitivity = 100 / Math.max(measure().radius, 1);
    lon = ((drag.lon - (event.clientX - drag.x) * sensitivity) % 360 + 360) % 360;
    lat = clamp(drag.lat + (event.clientY - drag.y) * sensitivity, -70, 70);
    queue();
  });
  canvas.addEventListener('lostpointercapture', () => { drag = null; });
  canvas.addEventListener('keydown', event => {
    const shift = { ArrowLeft: [-14, 0], ArrowRight: [14, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] }[event.key];
    if (!shift) return;
    event.preventDefault();
    aim(lon + shift[0], lat + shift[1]);
  });
  new ResizeObserver(queue).observe(canvas);
  loadTexture().then(value => {
    texture = value;
    queue();
  }).catch(onError);

  return {
    redraw: queue,
    locate: (lng, latitude) => aim(lng, latitude * .72),
    reset: () => aim(-36, 20, 1),
    zoom: change => aim(lon, lat, clamp(zoom + change, .8, 1.35)),
  };
}
