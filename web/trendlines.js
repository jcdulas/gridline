const trendlineTypes = [["", "None"], ["linear", "Linear"], ["poly", "Polynomial"], ["exp", "Exponential"],
  ["log", "Logarithmic"], ["power", "Power"]];
const trendlineCharts = new Set(["line", "smoothline", "column", "area", "scatter", "curve"]);

// Fit a small polynomial by QR decomposition on X normalized to [-1, 1].
// A second orthogonalization pass protects fits with unevenly spaced samples.
function fitPolynomial(x, y, degree) {
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const basis = [], upper = [], projected = [];
  for (let k = 0; k <= degree; k++) {
    const column = x.map((value) => value ** k);
    const factors = new Array(k + 1).fill(0);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < k; j++) {
        const component = dot(basis[j], column);
        factors[j] += component;
        for (let i = 0; i < column.length; i++) column[i] -= component * basis[j][i];
      }
    }
    factors[k] = Math.sqrt(dot(column, column));
    if (factors[k] <= 1e-12 * Math.sqrt(x.length)) return null;
    basis.push(column.map((value) => value / factors[k]));
    upper.push(factors);
    projected.push(dot(basis[k], y));
  }
  const result = new Array(degree + 1);
  for (let i = degree; i >= 0; i--) {
    let value = projected[i];
    for (let j = i + 1; j <= degree; j++) value -= upper[j][i] * result[j];
    result[i] = value / upper[i][i];
  }
  return result;
}

function polynomialText(coefficients, variable) {
  const text = [];
  const powers = ["", "", "²", "³", "⁴", "⁵", "⁶"];
  for (let exponent = coefficients.length - 1; exponent >= 0; exponent--) {
    const coefficient = coefficients[exponent];
    if (!coefficient) continue;
    const term = chartNumber(Math.abs(coefficient)) + (exponent ? ` ${variable}${powers[exponent]}` : "");
    text.push(text.length ? (coefficient < 0 ? " − " : " + ") + term : (coefficient < 0 ? "−" : "") + term);
  }
  return text.join("") || "0";
}

function trendlineEquation(type, normalized, center, span) {
  const noise = 8 * Number.EPSILON * Math.max(...normalized.map(Math.abs));
  normalized = normalized.map((value) => Math.abs(value) <= noise ? 0 : value);
  const slope = normalized[1] / span;
  const intercept = normalized[0] - slope * center;
  const offset = Math.abs(center / span);
  if (type === "exp" || type === "power") {
    const multiplier = Math.exp(intercept);
    if (offset <= 1_000 && Number.isFinite(multiplier) && multiplier > 0) return type === "exp"
      ? `y = ${chartNumber(multiplier)} × exp(${chartNumber(slope)} x)`
      : `y = ${chartNumber(multiplier)} × x^(${chartNumber(slope)})`;
    const variable = type === "exp" ? "x" : "ln(x)";
    return `y = exp(${polynomialText(normalized, "u")}), u = (${variable} − (${chartNumber(center)})) / ${chartNumber(span)}`;
  }
  const variable = type === "log" ? "ln(x)" : "x";
  if (normalized.length === 2 && offset <= 1_000 && Number.isFinite(slope) && Number.isFinite(intercept)) {
    return "y = " + polynomialText([intercept, slope], variable);
  }
  if (normalized.length > 2 && offset <= 8) {
    // Expand in the original X units when cancellation stays small enough
    // for the displayed coefficients to remain useful.
    const coefficients = normalized.reduceRight((terms, value) => {
      const expanded = new Array(terms.length + 1).fill(0);
      expanded[0] = value;
      for (let i = 0; i < terms.length; i++) {
        expanded[i] -= terms[i] * (center / span);
        expanded[i + 1] += terms[i] / span;
      }
      return expanded;
    }, []);
    if (coefficients.every(Number.isFinite)) {
      const magnitude = Math.max(Math.abs(center) + span, 1);
      return "y = " + polynomialText(coefficients.map((value, degree) =>
        Math.abs(value) * magnitude ** degree <= noise ? 0 : value), variable);
    }
  }
  return `y = ${polynomialText(normalized, "u")}, u = (${variable} − (${chartNumber(center)})) / ${chartNumber(span)}`;
}

function estimateTrendline(samples, { type, order }) {
  const degree = type === "poly" ? order : 1;
  const logX = type === "log" || type === "power";
  const logY = type === "exp" || type === "power";
  if (samples.length <= degree) throw new Error(`The trendline needs at least ${degree + 1} points.`);
  if (samples.some(([x, y]) => (logX && x <= 0) || (logY && y <= 0))) {
    throw new Error("This trendline requires positive " + (logX && logY ? "X and Y values." : logX ? "X values." : "Y values."));
  }
  const xs = samples.map(([x]) => logX ? Math.log(x) : x);
  const ys = samples.map(([, y]) => logY ? Math.log(y) : y);
  const low = Math.min(...xs), high = Math.max(...xs);
  if (new Set(xs).size <= degree) throw new Error(`The trendline needs at least ${degree + 1} distinct X values.`);
  const center = low / 2 + high / 2;
  const span = Math.max(high - center, center - low);
  const yScale = Math.max(...ys.map(Math.abs)) || 1;
  const x = xs.map((value) => (value - center) / span);
  const y = ys.map((value) => value / yScale);
  const fitted = fitPolynomial(x, y, degree);
  if (!fitted) throw new Error("The X values are too close for this trendline order.");
  const evaluate = (value) => fitted.reduceRight((sum, coefficient) => sum * value + coefficient, 0);
  const mean = y.reduce((sum, value) => sum + value, 0) / y.length;
  const total = y.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const error = y.reduce((sum, value, index) => sum + (value - evaluate(x[index])) ** 2, 0);
  const rSquared = total ? clamp(1 - error / total, 0, 1) : 1;
  const predict = (x) => {
    const value = evaluate(((logX ? Math.log(x) : x) - center) / span) * yScale;
    return logY ? Math.exp(value) : value;
  };
  return { equation: trendlineEquation(type, fitted.map((coefficient) => coefficient * yScale), center, span),
    rSquared, predict };
}

// Monotone cubic interpolation keeps the curve between adjacent sample values.
function smoothChartLine(marks, color, points) {
  if (points.length < 2) return;
  const slopes = points.slice(1).map(([x, y], index) => (y - points[index][1]) / (x - points[index][0]));
  const tangent = (left, right) => Number.isFinite(left) && Number.isFinite(right) && left * right > 0
    ? 2 / (1 / left + 1 / right) : 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const dx = x1 - x0;
    if (dx <= 0) { marks.segment(color, points[i - 1], points[i]); continue; }
    const slope = slopes[i - 1];
    const start = tangent(slopes[i - 2] ?? slope, slope), end = tangent(slope, slopes[i] ?? slope);
    const steps = clamp(Math.ceil(dx / 5), 2, 32);
    let previous = points[i - 1];
    for (let step = 1; step <= steps; step++) {
      const t = step / steps, s = 1 - t;
      const y = s * s * ((1 + 2 * t) * y0 + t * dx * start) +
        t * t * ((3 - 2 * t) * y1 - s * dx * end);
      const point = [x0 + t * dx, clamp(y, Math.min(y0, y1), Math.max(y0, y1))];
      marks.segment(color, previous, point);
      previous = point;
    }
  }
}
